/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import {
  Connection,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { createSupabaseServiceClient } from "../lib/supabase";

const db = createSupabaseServiceClient();

const CONF_TARGET = (process.env.CONFIRMATION_TARGET || "finalized") as
  | "processed"
  | "confirmed"
  | "finalized";
const GET_TX_FINALITY: "confirmed" | "finalized" =
  CONF_TARGET === "finalized" ? "finalized" : "confirmed";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 8000);
const MEMO_PID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SOL_DECIMALS = 9;

function must(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
}
function getConnection() {
  const url = must("SOLANA_RPC_URL");
  return new Connection(url, { commitment: "confirmed" });
}

async function loadTreasuryPubkey(): Promise<string> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("key", "treasury_pubkey")
    .maybeSingle();

  if (data?.value) return data.value as string;
  const fallback = process.env.TREASURY_ADDRESS;
  if (!fallback) throw new Error("Missing treasury_pubkey (DB) and TREASURY_ADDRESS (env)");
  return fallback;
}

async function getCursor(addr: string) {
  const { data, error } = await db
    .from("deposit_cursors")
    .select("last_seen_sig")
    .eq("address", addr)
    .maybeSingle();
  if (error) throw error;
  return data?.last_seen_sig ?? null;
}
async function setCursor(addr: string, sig: string) {
  const { error } = await db
    .from("deposit_cursors")
    .upsert(
      { address: addr, last_seen_sig: sig, updated_at: new Date().toISOString() },
      { onConflict: "address" }
    );
  if (error) throw error;
}

async function findUserIdByAddress(address?: string | null) {
  if (!address) return null;
  const { data, error } = await db
    .from("users")
    .select("id")
    .eq("wallet_address", address)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

function extractMemos(tx: any): string[] {
  const memos: string[] = [];
  try {
    const msg: any = tx?.transaction?.message;
    const accountKeys: string[] =
      (msg?.staticAccountKeys?.map((k: any) => k.toBase58?.() ?? String(k)) ??
        msg?.accountKeys?.map((k: any) => (typeof k === "string" ? k : k.toBase58?.() ?? String(k))) ??
        []).map(String);
    const ixList: any[] = msg?.compiledInstructions ?? msg?.instructions ?? [];
    for (const ix of ixList) {
      const pidIndex = typeof ix.programIdIndex === "number" ? ix.programIdIndex : undefined;
      const pid = pidIndex != null ? accountKeys[pidIndex] : undefined;
      if (pid === MEMO_PID && ix.data) {
        try {
          const buf = Buffer.from(ix.data, "base64");
          const memo = buf.toString("utf8");
          if (memo && memo.length <= 256) memos.push(memo);
        } catch {}
      }
    }
  } catch {}
  try {
    const logs: string[] = tx?.meta?.logMessages ?? [];
    for (const line of logs) {
      const m = line.replace(/^Program log:\s*/i, "");
      if (m && m.length > 0 && m.length <= 256) memos.push(m);
    }
  } catch {}
  return Array.from(new Set(memos));
}
function extractReferenceCode(tx: any): string | null {
  const memos = extractMemos(tx);
  for (const memo of memos) {
    const m = /ref:([A-Za-z0-9_-]{3,64})/.exec(memo);
    if (m) return m[1];
  }
  return null;
}
async function resolveContractByRefCode(referenceCode: string | null): Promise<{ contract_id: string | null; user_id_hint: string | null }> {
  if (!referenceCode) return { contract_id: null, user_id_hint: null };
  const { data, error } = await db
    .from("contract_refs")
    .select("contract_id, user_id, status, expires_at")
    .eq("ref_code", referenceCode)
    .maybeSingle();
  if (error || !data) return { contract_id: null, user_id_hint: null };
  // optional: enforce status/expiry here if you want
  return { contract_id: data.contract_id as string, user_id_hint: data.user_id as string };
}

// Inbound extraction
function bigintGtZero(x: bigint) { return x > BigInt(0); }
function bigintLtZero(x: bigint) { return x < BigInt(0); }

function extractInboundTransfers(
  tx: VersionedTransactionResponse,
  target: PublicKey
) {
  const results: Array<{
    mint: string | null;
    amount_base_units: bigint;
    decimals: number;
    fromAddress?: string;
    toAddress?: string;
  }> = [];
  if (!tx.meta) return results;

  const keys: PublicKey[] =
    (tx.transaction.message as any).staticAccountKeys ??
    tx.transaction.message.getAccountKeys().staticAccountKeys;

  const pre = tx.meta.preBalances || [];
  const post = tx.meta.postBalances || [];
  const lamportDeltas: bigint[] = keys.map((_, i) => {
    const before = BigInt(pre[i] ?? 0);
    const after = BigInt(post[i] ?? 0);
    return after - before;
  });

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key.equals(target)) continue;
    const delta = lamportDeltas[i];
    if (bigintGtZero(delta)) {
      const negatives = lamportDeltas
        .map((d, idx) => ({ d, idx }))
        .filter((x) => bigintLtZero(x.d) && x.idx !== i);
      const fromAddress =
        negatives.length === 1 ? keys[negatives[0].idx].toBase58() : undefined;

      results.push({
        mint: null,
        amount_base_units: delta,
        decimals: SOL_DECIMALS,
        toAddress: key.toBase58(),
        fromAddress,
      });
    }
  }

  const postTokens = tx.meta.postTokenBalances ?? [];
  const preTokens = tx.meta.preTokenBalances ?? [];

  type Rec = {
    pre?: string;
    post?: string;
    mint: string;
    owner?: string;
    decimals: number;
    accountIndex: number;
  };
  const beforeMap: Record<string, Rec> = {};
  const afterMap: Record<string, Rec> = {};

  for (const p of preTokens) {
    const k = `${p.accountIndex}:${p.mint}`;
    beforeMap[k] = {
      pre: p.uiTokenAmount.amount,
      mint: p.mint,
      decimals: p.uiTokenAmount.decimals,
      owner: p.owner,
      accountIndex: p.accountIndex,
    };
  }
  for (const p of postTokens) {
    const k = `${p.accountIndex}:${p.mint}`;
    afterMap[k] = {
      post: p.uiTokenAmount.amount,
      mint: p.mint,
      decimals: p.uiTokenAmount.decimals,
      owner: p.owner,
      accountIndex: p.accountIndex,
    };
  }

  const byMintOwnersDelta: Record<string, { owner: string; delta: bigint; decimals: number }[]> = {};
  const allKeys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
  for (const k of allKeys) {
    const preRec = beforeMap[k];
    const postRec = afterMap[k];
    const mint = (preRec?.mint ?? postRec?.mint)!;
    const decimals = preRec?.decimals ?? postRec?.decimals ?? 0;
    const owner = preRec?.owner ?? postRec?.owner;
    if (!owner) continue;

    const preAmt = preRec?.pre ? BigInt(preRec.pre) : BigInt(0);
    const postAmt = postRec?.post ? BigInt(postRec.post) : BigInt(0);
    const delta = postAmt - preAmt;

    (byMintOwnersDelta[mint] ||= []).push({ owner, delta, decimals });
  }

  for (const [mint, ownerDeltas] of Object.entries(byMintOwnersDelta)) {
    const toRow = ownerDeltas.find((r) => {
      try { return new PublicKey(r.owner).equals(target) && r.delta > BigInt(0); }
      catch { return false; }
    });
    if (!toRow) continue;
    const negatives = ownerDeltas.filter((r) => r.delta < BigInt(0));
    const fromAddress = negatives.length === 1 ? negatives[0].owner : undefined;

    results.push({
      mint,
      amount_base_units: toRow.delta,
      decimals: toRow.decimals,
      toAddress: target.toBase58(),
      fromAddress,
    });
  }

  return results;
}

// Ingest & poll
async function ingest(signature: string, tx: any, treasury: string) {
  const transfers = extractInboundTransfers(tx as VersionedTransactionResponse, new PublicKey(treasury));
  if (transfers.length === 0) return;

  const when = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  const status =
    ((tx.meta?.confirmationStatus as any) || (CONF_TARGET as any) || "confirmed") as
      | "processed" | "confirmed" | "finalized";

  const refCode = extractReferenceCode(tx);
  const { contract_id, user_id_hint } = await resolveContractByRefCode(refCode);

  for (const t of transfers) {
    // prefer user from ref mapping; otherwise fallback to sender lookup
    const userId = user_id_hint ?? (await findUserIdByAddress(t.fromAddress ?? null));
    if (!userId) {
      console.warn(`[deposit] skip ${signature} (asset=${t.mint ?? "SOL"}): cannot resolve user`);
      continue; // deposits.user_id is NOT NULL in your schema
    }

    const uiAmount = Number(t.amount_base_units) / Math.pow(10, t.decimals);

    const row = {
      user_id: userId,
      contract_id: contract_id,              // may be null if no ref
      reference_code: refCode,              // store memo code for audit
      to_address: treasury,
      from_address: t.fromAddress ?? null,
      tx_sig: signature,
      slot: tx.slot,
      block_time: when,
      mint: t.mint,                          // null => SOL
      amount_base_units: t.amount_base_units.toString(),
      decimals: t.decimals,
      ui_amount: uiAmount,
      status,
      source: "rpc" as const,
      memo: refCode ?? null,
    };

    const { error } = await db
      .from("deposits")
      .upsert(row, { onConflict: "tx_sig,to_address,asset_key" });
    if (error) console.error("[deposit] upsert error:", error);
  }
}

async function run() {
  const treasury = await loadTreasuryPubkey();
  const conn = getConnection();
  const treasuryKey = new PublicKey(treasury);

  console.log("[deposit] watcher up", { rpc: process.env.SOLANA_RPC_URL, treasury });

  for (;;) {
    try {
      const cursor = await getCursor(treasury);
      const sigs = await conn.getSignaturesForAddress(treasuryKey, { limit: 50 });
      const idx = cursor ? sigs.findIndex((s) => s.signature === cursor) : -1;
      const newOnes = cursor && idx >= 0 ? sigs.slice(0, idx) : sigs;

      if (newOnes.length === 0) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }

      for (const info of newOnes) {
        try {
          const tx = await conn.getTransaction(info.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: GET_TX_FINALITY,
          });
          if (tx) await ingest(info.signature, tx, treasury);
        } catch (e) {
          console.error("[deposit] fetch/ingest error", info.signature, e);
        }
        await setCursor(treasury, info.signature);
      }
    } catch (e) {
      console.error("[deposit] loop error:", e);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
