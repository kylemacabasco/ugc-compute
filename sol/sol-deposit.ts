/* eslint-disable @typescript-eslint/no-explicit-any */
import "dotenv/config";
import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { createSupabaseServiceClient } from "../lib/supabase";

const db = createSupabaseServiceClient();

const RPC = process.env.SOLANA_RPC_URL;
const TREASURY = process.env.TREASURY_ADDRESS;
if (!RPC) throw new Error("SOLANA_RPC_URL is required");
if (!TREASURY) throw new Error("TREASURY_ADDRESS is required");

const GET_TX_FINALITY: "confirmed" | "finalized" = "finalized";
const POLL_MS = 8000;
const SIGNATURE_BATCH_LIMIT = 50;
const INITIAL_BACKFILL_CAP = 500;
const SOL_DECIMALS = 9;
const MEMO_PID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const conn = new Connection(RPC, { commitment: "confirmed" });
const tKey = new PublicKey(TREASURY);

function formatUiAmount(amount: bigint, decimals: number) {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const s = abs.toString();
  if (decimals === 0) return `${neg ? "-" : ""}${s}`;
  const padded = s.padStart(decimals + 1, "0");
  const split = padded.length - decimals;
  const intPart = padded.slice(0, split);
  const frac = padded.slice(split).replace(/0+$/, "");
  return `${neg ? "-" : ""}${intPart}${frac ? "." + frac : ""}`;
}

// extract inbound SOL + SPL transfers to target
function extractInbound(tx: VersionedTransactionResponse, target: PublicKey) {
  const out: Array<{ mint: string | null; amount: bigint; dec: number; from?: string }> = [];
  if (!tx.meta) return out;

  // get account keys robustly
  const msg: any = tx.transaction.message;
  const keys: PublicKey[] =
    (msg.staticAccountKeys as PublicKey[]) ??
    msg.getAccountKeys?.({ accountKeysFromLookups: tx.meta.loadedAddresses })?.staticAccountKeys ??
    msg.getAccountKeys?.().staticAccountKeys ??
    [];

  // SOL via pre/post balance delta
  const pre = tx.meta.preBalances || [];
  const post = tx.meta.postBalances || [];
  const deltas = keys.map((_, i) => BigInt(post[i] ?? 0) - BigInt(pre[i] ?? 0));
  keys.forEach((k, i) => {
    if (!k.equals(target)) return;
    const d = deltas[i];
    if (d > 0n) {
      const senders = deltas.map((v, j) => ({ v, j })).filter((x) => x.j !== i && x.v < 0n);
      out.push({ mint: null, amount: d, dec: SOL_DECIMALS, from: senders.length === 1 ? keys[senders[0].j].toBase58() : undefined });
    }
  });

  // SPL via token balance deltas
  const preT = tx.meta.preTokenBalances ?? [];
  const postT = tx.meta.postTokenBalances ?? [];
  const before: Record<string, { amount?: string; mint: string; dec: number; owner?: string }> = {};
  const after: Record<string, { amount?: string; mint: string; dec: number; owner?: string }> = {};
  for (const p of preT) before[`${p.accountIndex}:${p.mint}`] = { amount: p.uiTokenAmount.amount, mint: p.mint, dec: p.uiTokenAmount.decimals, owner: p.owner };
  for (const p of postT) after[`${p.accountIndex}:${p.mint}`] = { amount: p.uiTokenAmount.amount, mint: p.mint, dec: p.uiTokenAmount.decimals, owner: p.owner };
  const all = new Set([...Object.keys(before), ...Object.keys(after)]);
  const byMint: Record<string, { owner: string; delta: bigint; dec: number }[]> = {};
  for (const k of all) {
    const a = before[k], b = after[k];
    const mint = (a?.mint ?? b?.mint)!;
    const dec = a?.dec ?? b?.dec ?? 0;
    const owner = a?.owner ?? b?.owner;
    if (!owner) continue;
    const d = BigInt(b?.amount ?? "0") - BigInt(a?.amount ?? "0");
    (byMint[mint] ??= []).push({ owner, delta: d, dec });
  }
  for (const [mint, rows] of Object.entries(byMint)) {
    const gain = rows.find((r) => {
      try { return new PublicKey(r.owner).equals(target) && r.delta > 0n; } catch { return false; }
    });
    if (!gain) continue;
    const spenders = rows.filter((r) => r.delta < 0n);
    out.push({ mint, amount: gain.delta, dec: gain.dec, from: spenders.length === 1 ? spenders[0].owner : undefined });
  }

  return out;
}

// ingest one tx into public.deposits
async function ingest(signature: string, tx: VersionedTransactionResponse, treasury: string) {
  const inbound = extractInbound(tx, new PublicKey(treasury));
  if (!inbound.length) return;

  // aggregate per-asset
  const agg = new Map<string, { mint: string | null; amount: bigint; dec: number }>();
  for (const x of inbound) {
    const key = `${x.mint ?? "SOL"}:${x.dec}`;
    const cur = agg.get(key);
    if (cur) cur.amount += x.amount;
    else agg.set(key, { mint: x.mint, amount: x.amount, dec: x.dec });
  }

  // parse memo and ref code
  let ref: string | null = null;
  try {
    const msg: any = tx?.transaction?.message;
    const keys: string[] =
      (msg?.staticAccountKeys?.map((k: any) => k.toBase58?.() ?? String(k)) ??
       msg?.accountKeys?.map((k: any) => (typeof k === "string" ? k : k.toBase58?.() ?? String(k))) ??
       []).map(String);
    const ixs: any[] = msg?.compiledInstructions ?? msg?.instructions ?? [];
    for (const ix of ixs) {
      const pidIdx = typeof ix.programIdIndex === "number" ? ix.programIdIndex : undefined;
      const pid = pidIdx != null ? keys[pidIdx] : undefined;
      if (pid === MEMO_PID && ix.data) {
        try {
          const memo = Buffer.from(ix.data, "base64").toString("utf8");
          const m = /ref:([A-Za-z0-9_-]{3,64})/.exec(memo);
          if (m) { ref = m[1]; break; }
        } catch {}
      }
    }
    if (!ref) {
      for (const line of tx?.meta?.logMessages ?? []) {
        const m = line.replace(/^Program log:\s*/i, "");
        const r = /ref:([A-Za-z0-9_-]{3,64})/.exec(m);
        if (r) { ref = r[1]; break; }
      }
    }
  } catch {}

  // resolve contract + user via ref, else fallback by sender
  let resolvedContractId: string | null = null;
  let resolvedUserId: string | null = null;
  if (ref) {
    const { data: refRow, error: refErr } = await db.from("contract_refs").select("contract_id,user_id").eq("ref_code", ref).maybeSingle();
    if (refErr) throw refErr;
    if (refRow) {
      resolvedContractId = refRow.contract_id ?? null;
      resolvedUserId = refRow.user_id ?? null;
    }
  }
  if (!resolvedUserId) {
    const anyFrom = inbound.find((z) => z.from)?.from ?? null;
    if (anyFrom) {
      const { data: uRow, error: uErr } = await db.from("users").select("id").eq("wallet_address", anyFrom).maybeSingle();
      if (uErr) throw uErr;
      resolvedUserId = uRow?.id ?? null;
    }
  }

  // compute status from requested finality
  const when = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  const status: "processed" | "confirmed" | "finalized" = GET_TX_FINALITY;

  // upsert per-asset
  for (const v of agg.values()) {
    const ui = formatUiAmount(v.amount, v.dec);
    const fromMatch = inbound.find((z) => (z.mint ?? null) === (v.mint ?? null) && z.dec === v.dec && z.from)?.from ?? null;
    const row = {
      user_id: resolvedUserId,
      contract_id: resolvedContractId,
      reference_code: ref,
      to_address: treasury,
      from_address: fromMatch,
      tx_sig: signature,
      slot: tx.slot,
      block_time: when,
      mint: v.mint,
      amount_base_units: v.amount.toString(),
      decimals: v.dec,
      ui_amount: ui,
      status,
      source: "rpc",
      memo: ref ?? null
    };
    const { error: upErr } = await db.from("deposits").upsert(row, { onConflict: "tx_sig,to_address,asset_key" });
    if (upErr) throw upErr;
  }
}

// fetch signatures since cursor
async function collectSignaturesSinceCursor(target: PublicKey, cursor: string | null) {
  const out: Array<{ signature: string }> = [];
  let before: string | undefined;
  let fetched = 0;
  while (true) {
    const page = await conn.getSignaturesForAddress(target, { limit: SIGNATURE_BATCH_LIMIT, before });
    if (!page.length) break;
    let cursorHit = false;
    for (const s of page) {
      if (cursor && s.signature === cursor) { cursorHit = true; break; }
      out.push({ signature: s.signature });
      if (!cursor) {
        fetched++;
        if (INITIAL_BACKFILL_CAP !== Number.POSITIVE_INFINITY && fetched >= INITIAL_BACKFILL_CAP) return out.reverse();
      }
    }
    if (cursorHit) break;
    if (page.length < SIGNATURE_BATCH_LIMIT) break;
    const last = page[page.length - 1];
    if (!last?.signature || last.signature === before) break;
    before = last.signature;
  }
  return out.reverse();
}

// main poll loop
(async () => {
  console.log("[deposit] up", { rpc: RPC, finality: GET_TX_FINALITY, treasury: TREASURY });
  for (;;) {
    try {
      const { data: cRow, error: cErr } = await db.from("deposit_cursors").select("last_seen_sig").eq("address", TREASURY).maybeSingle();
      if (cErr) throw cErr;
      const cursor = cRow?.last_seen_sig ?? null;

      const sigs = await collectSignaturesSinceCursor(tKey, cursor);
      if (!sigs.length) { await new Promise((r) => setTimeout(r, POLL_MS)); continue; }

      for (const s of sigs) {
        let processed = false;
        try {
          const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: GET_TX_FINALITY });
          if (tx) { await ingest(s.signature, tx, TREASURY); processed = true; }
          else { console.warn("[deposit] unavailable at finality", s.signature); }
        } catch (e) {
          console.error("[deposit] get/ingest error", s.signature, e);
        }
        if (processed) {
          const up = { address: TREASURY, last_seen_sig: s.signature, updated_at: new Date().toISOString() };
          const { error: uErr } = await db.from("deposit_cursors").upsert(up, { onConflict: "address" });
          if (uErr) throw uErr;
        }
      }
    } catch (e) {
      console.error("[deposit] loop error", e);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
