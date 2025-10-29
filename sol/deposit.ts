/* eslint-disable @typescript-eslint/no-explicit-any */
// Deposit Indexer: Polls Solana for treasury transactions and ingests deposits
// Simplified version without reference code logic
import "dotenv/config";
import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { createSupabaseServiceClient } from "../lib/supabase";

const db = createSupabaseServiceClient();

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
const TREASURY = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
if (!RPC) throw new Error("SOLANA_RPC_URL is required");
if (!TREASURY) throw new Error("TREASURY_ADDRESS is required");

const GET_TX_FINALITY: "confirmed" | "finalized" = "finalized";
const POLL_MS = 8000;
const SIGNATURE_BATCH_LIMIT = 50;
const INITIAL_BACKFILL_CAP = 500;
const SOL_DECIMALS = 9;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 60000;

let lastHeartbeat = Date.now();
let lastProcessedSignature: string | null = null;
let totalProcessed = 0;
let totalErrors = 0;

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

function extractInbound(tx: VersionedTransactionResponse, target: PublicKey) {
  const out: Array<{ mint: string | null; amount: bigint; dec: number; from?: string }> = [];
  if (!tx.meta) return out;

  const msg: any = tx.transaction.message;
  const keys: PublicKey[] =
    (msg.staticAccountKeys as PublicKey[]) ??
    msg.getAccountKeys?.({ accountKeysFromLookups: tx.meta.loadedAddresses })?.staticAccountKeys ??
    msg.getAccountKeys?.().staticAccountKeys ??
    [];

  // SOL deltas
  const pre = tx.meta.preBalances || [];
  const post = tx.meta.postBalances || [];
  const deltas = keys.map((_, i) => BigInt(post[i] ?? 0) - BigInt(pre[i] ?? 0));
  keys.forEach((k, i) => {
    if (!k.equals(target)) return;
    const d = deltas[i];
    if (d > 0n) {
      const senders = deltas.map((v, j) => ({ v, j })).filter((x) => x.j !== i && x.v < 0n);
      out.push({
        mint: null,
        amount: d,
        dec: SOL_DECIMALS,
        from: senders.length === 1 ? keys[senders[0].j].toBase58() : undefined,
      });
    }
  });

  // SPL deltas
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

async function ingest(signature: string, tx: VersionedTransactionResponse, treasury: string) {
  const inbound = extractInbound(tx, new PublicKey(treasury));
  if (!inbound.length) return;

  // Aggregate amounts per asset
  const agg = new Map<string, { mint: string | null; amount: bigint; dec: number }>();
  for (const x of inbound) {
    const key = `${x.mint ?? "SOL"}:${x.dec}`;
    const cur = agg.get(key);
    if (cur) cur.amount += x.amount;
    else agg.set(key, { mint: x.mint, amount: x.amount, dec: x.dec });
  }

  // Extract any memo text from transaction logs
  let memoText: string | null = null;
  try {
    for (const line of tx?.meta?.logMessages ?? []) {
      if (line.includes("Program log:")) {
        const memo = line.replace(/^Program log:\s*/i, "").trim();
        if (memo) {
          memoText = memo;
          break;
        }
      }
    }
  } catch {}

  // Resolve user_id from sender wallet
  let resolvedUserId: string | null = null;
  const anyFrom = inbound.find((z) => z.from)?.from ?? null;
  if (anyFrom) {
    const { data: uRow, error: uErr } = await db
      .from("users")
      .select("id")
      .eq("wallet_address", anyFrom)
      .maybeSingle();
    if (uErr) throw uErr;
    resolvedUserId = uRow?.id ?? null;
  }

  // Warning for unattributed deposits
  if (!resolvedUserId) {
    console.warn(
      `[deposit] UNATTRIBUTED DEPOSIT: ${signature} - ${formatUiAmount(agg.values().next().value?.amount ?? 0n, SOL_DECIMALS)} SOL from ${anyFrom ?? "unknown"}`
    );
  }

  const when = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  const status: "processed" | "confirmed" | "finalized" = GET_TX_FINALITY;

  // Insert deposit rows
  for (const v of agg.values()) {
    const ui = formatUiAmount(v.amount, v.dec);
    const fromMatch = inbound.find(
      (z) => (z.mint ?? null) === (v.mint ?? null) && z.dec === v.dec && z.from
    )?.from ?? null;

    const row = {
      user_id: resolvedUserId,
      contract_id: null, // Set via API route after deposit
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
      source: "rpc" as const,
      memo: memoText,
    };

    const { error: upErr } = await db.from("deposits").upsert(row, { onConflict: "tx_sig,to_address,asset_key" });
    if (upErr) throw upErr;

    console.log(
      `[deposit] Ingested: ${signature} - ${ui} ${v.mint ?? "SOL"} from ${fromMatch ?? "unknown"}`
    );
  }
}

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
        if (INITIAL_BACKFILL_CAP !== Number.POSITIVE_INFINITY && fetched >= INITIAL_BACKFILL_CAP) {
          return out.reverse();
        }
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

async function sendHeartbeat() {
  const now = Date.now();
  const uptime = Math.floor((now - lastHeartbeat) / 1000);

  const heartbeatData = {
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime_seconds: uptime,
    treasury: TREASURY,
    stats: {
      total_processed: totalProcessed,
      total_errors: totalErrors,
      last_signature: lastProcessedSignature,
    },
  };

  console.log("[deposit] Heartbeat:", heartbeatData);

  try {
    await db.from("app_settings").upsert(
      {
        key: "deposit_indexer_heartbeat",
        value: JSON.stringify(heartbeatData),
      },
      { onConflict: "key" }
    );
  } catch (error) {
    console.error("[deposit] Failed to update heartbeat in DB:", error);
  }

  lastHeartbeat = now;
}

(async () => {
  console.log("[deposit] Starting deposit indexer", {
    rpc: RPC,
    finality: GET_TX_FINALITY,
    treasury: TREASURY,
    pollInterval: `${POLL_MS}ms`,
    maxRetries: MAX_RETRIES,
    heartbeatInterval: `${HEARTBEAT_INTERVAL_MS}ms`,
  });

  const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  await sendHeartbeat();

  for (;;) {
    try {
      const { data: cRow, error: cErr } = await db
        .from("deposit_cursors")
        .select("last_seen_sig")
        .eq("address", TREASURY)
        .maybeSingle();

      if (cErr) throw cErr;

      const cursor = cRow?.last_seen_sig ?? null;
      const sigs = await collectSignaturesSinceCursor(tKey, cursor);
      if (!sigs.length) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }

      console.log(`[deposit] Processing ${sigs.length} new signature(s)...`);

      for (const s of sigs) {
        let processed = false;
        let tx: VersionedTransactionResponse | null = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            tx = await conn.getTransaction(s.signature, {
              maxSupportedTransactionVersion: 0,
              commitment: GET_TX_FINALITY,
            });

            if (tx) {
              break;
            } else {
              if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                console.warn(
                  `[deposit] Transaction unavailable (attempt ${attempt}/${MAX_RETRIES}): ${s.signature}, retrying in ${delay}ms...`
                );
                await new Promise((r) => setTimeout(r, delay));
              } else {
                console.warn(
                  `[deposit] Skipping transaction after ${MAX_RETRIES} attempts: ${s.signature}`
                );
                totalErrors++;
              }
            }
          } catch (e) {
            console.error(
              `[deposit] Get transaction error (attempt ${attempt}/${MAX_RETRIES}):`,
              s.signature,
              e
            );
            if (attempt < MAX_RETRIES) {
              const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
              await new Promise((r) => setTimeout(r, delay));
            } else {
              totalErrors++;
            }
          }
        }

        if (tx) {
          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              await ingest(s.signature, tx, TREASURY);
              processed = true;
              totalProcessed++;
              lastProcessedSignature = s.signature;
              break;
            } catch (e) {
              console.error(
                `[deposit] Ingest error (attempt ${attempt}/${MAX_RETRIES}):`,
                s.signature,
                e
              );
              if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                await new Promise((r) => setTimeout(r, delay));
              } else {
                totalErrors++;
              }
            }
          }
        }

        if (processed) {
          const up = {
            address: TREASURY,
            last_seen_sig: s.signature,
            updated_at: new Date().toISOString(),
          };

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              const { error: uErr } = await db
                .from("deposit_cursors")
                .upsert(up, { onConflict: "address" });

              if (uErr) throw uErr;
              break;
            } catch (e) {
              console.error(
                `[deposit] Cursor update error (attempt ${attempt}/${MAX_RETRIES}):`,
                e
              );
              if (attempt === MAX_RETRIES) {
                totalErrors++;
              } else {
                await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
              }
            }
          }
        }
      }
    } catch (e) {
      console.error("[deposit] Loop error", e);
      totalErrors++;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
})().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});