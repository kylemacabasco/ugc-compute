/* eslint-disable @typescript-eslint/no-explicit-any */
// Deposit Indexer: Polls Solana for treasury-address transactions and ingests inbound SOL/SPL deposits into the database.
// Focus: Reliable extraction, attribution via memo ref codes, idempotent upserts, and heartbeat telemetry.
import "dotenv/config";
import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { createSupabaseServiceClient } from "../lib/supabase";

const db = createSupabaseServiceClient();

const RPC = process.env.SOLANA_RPC_URL;
const TREASURY = process.env.TREASURY_ADDRESS;
if (!RPC) throw new Error("SOLANA_RPC_URL is required");
if (!TREASURY) throw new Error("TREASURY_ADDRESS is required");

// Set the target finality used when fetching transactions
const GET_TX_FINALITY: "confirmed" | "finalized" = "finalized";

// Set the main polling interval for new signatures
const POLL_MS = 8000;

// Set the number of signatures fetched per page from RPC
const SIGNATURE_BATCH_LIMIT = 50;

// Set the maximum initial backfill count when no cursor exists
const INITIAL_BACKFILL_CAP = 500;

// Define SOL decimal places for UI formatting
const SOL_DECIMALS = 9;

// Define Memo Program ID for extracting reference codes
const MEMO_PID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

// Set retry behavior for transient RPC/DB errors
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// Configure heartbeat telemetry interval for liveness reporting
const HEARTBEAT_INTERVAL_MS = 60000; // 1 minute

// Track last heartbeat time and processing stats for telemetry
let lastHeartbeat = Date.now();
let lastProcessedSignature: string | null = null;
let totalProcessed = 0;
let totalErrors = 0;

// Create the Solana RPC connection with a default commitment
const conn = new Connection(RPC, { commitment: "confirmed" });
const tKey = new PublicKey(TREASURY);

// This function formats an integer base-unit amount to a UI string with decimals
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

// This function scans a transaction to extract inbound SOL and SPL token transfers into a target address
function extractInbound(tx: VersionedTransactionResponse, target: PublicKey) {
  const out: Array<{ mint: string | null; amount: bigint; dec: number; from?: string }> = [];
  if (!tx.meta) return out;

  // Get account keys from the transaction, using lookups if available
  const msg: any = tx.transaction.message;
  const keys: PublicKey[] =
    (msg.staticAccountKeys as PublicKey[]) ??
    msg.getAccountKeys?.({ accountKeysFromLookups: tx.meta.loadedAddresses })?.staticAccountKeys ??
    msg.getAccountKeys?.().staticAccountKeys ??
    [];

  // Compute SOL deltas from pre/post lamport balances and collect inbound to target
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

  // Compute SPL deltas from token balance changes and collect inbound to target
  const preT = tx.meta.preTokenBalances ?? [];
  const postT = tx.meta.postTokenBalances ?? [];
  const before: Record<string, { amount?: string; mint: string; dec: number; owner?: string }> = {};
  const after: Record<string, { amount?: string; mint: string; dec: number; owner?: string }> = {};
  for (const p of preT) before[`${p.accountIndex}:${p.mint}`] = { amount: p.uiTokenAmount.amount, mint: p.mint, dec: p.uiTokenAmount.decimals, owner: p.owner };
  for (const p of postT) after[`${p.accountIndex}:${p.mint}`] = { amount: p.uiTokenAmount.amount, mint: p.mint, dec: p.uiTokenAmount.decimals, owner: p.owner };

  // Merge before/after maps to compute per-mint owner deltas
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

  // Add entries where target gained tokens, optionally deriving a single sender
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

// This function ingests a single transaction into the deposits table after extracting inbound transfers
async function ingest(signature: string, tx: VersionedTransactionResponse, treasury: string) {
  const inbound = extractInbound(tx, new PublicKey(treasury));
  if (!inbound.length) return;

  // Aggregate amounts per asset key to handle multiple inbound changes in one transaction
  const agg = new Map<string, { mint: string | null; amount: bigint; dec: number }>();
  for (const x of inbound) {
    const key = `${x.mint ?? "SOL"}:${x.dec}`;
    const cur = agg.get(key);
    if (cur) cur.amount += x.amount;
    else agg.set(key, { mint: x.mint, amount: x.amount, dec: x.dec });
  }

  // Attempt to parse a memo-based reference code from instructions or logs
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

  // Resolve contract and user from the reference code, with expiration handling
  let resolvedContractId: string | null = null;
  let resolvedUserId: string | null = null;
  let refWasValid = false;

  if (ref) {
    const { data: refRow, error: refErr } = await db
      .from("contract_refs")
      .select("contract_id,user_id,expires_at,status")
      .eq("ref_code", ref)
      .eq("status", "active")
      .maybeSingle();

    if (refErr) throw refErr;

    if (refRow) {
      // Check if the reference code is expired and degrade linking if so
      if (refRow.expires_at && new Date(refRow.expires_at) < new Date()) {
        console.warn(`[deposit] Expired ref: ${ref} for tx ${signature}`);
        resolvedContractId = null;
        resolvedUserId = refRow.user_id ?? null;
      } else {
        resolvedContractId = refRow.contract_id ?? null;
        resolvedUserId = refRow.user_id ?? null;
        refWasValid = true;
      }
    } else {
      console.warn(`[deposit] Ref code not found or already used: ${ref} for tx ${signature}`);
    }
  }

  // Fallback to resolving user by the inferred sender wallet if ref did not map to a user
  if (!resolvedUserId) {
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
  }

  // Emit a warning when a deposit cannot be attributed to a user or contract
  if (!resolvedUserId && !resolvedContractId) {
    console.warn(
      `[deposit] UNATTRIBUTED DEPOSIT: ${signature} - ${formatUiAmount(agg.values().next().value?.amount ?? 0n, SOL_DECIMALS)} SOL`
    );
  }

  // Compute the final status and timestamp information from the transaction
  const when = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null;
  const status: "processed" | "confirmed" | "finalized" = GET_TX_FINALITY;

  // Upsert one row per aggregated asset entry into the deposits table
  for (const v of agg.values()) {
    const ui = formatUiAmount(v.amount, v.dec);
    const fromMatch = inbound.find(
      (z) => (z.mint ?? null) === (v.mint ?? null) && z.dec === v.dec && z.from
    )?.from ?? null;

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
      memo: ref ?? null,
    };

    const { error: upErr } = await db.from("deposits").upsert(row, { onConflict: "tx_sig,to_address,asset_key" });
    if (upErr) throw upErr;

    console.log(
      `[deposit] Ingested: ${signature} - ${ui} ${v.mint ?? "SOL"} from ${fromMatch ?? "unknown"} → contract: ${resolvedContractId ?? "none"}`
    );
  }

  // Mark the ref as used after a successful, linked deposit to prevent reuse
  if (ref && refWasValid && resolvedContractId) {
    const { error: markErr } = await db
      .from("contract_refs")
      .update({
        status: "used",
        updated_at: new Date().toISOString(),
      })
      .eq("ref_code", ref)
      .eq("status", "active"); // Maintain idempotency

    if (markErr) {
      console.error(`[deposit] Failed to mark ref as used: ${ref}`, markErr);
    } else {
      console.log(`[deposit] Marked ref as used: ${ref} for contract ${resolvedContractId}`);
    }
  }
}

// This function collects new signatures since the last cursor, honoring pagination and backfill limits
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

      // Enforce a backfill cap only when starting from no cursor
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

// This function sends a periodic heartbeat to logs and stores liveness data in the database
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

  // Persist heartbeat in app_settings for external monitoring
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

// This IIFE launches the infinite polling loop that reads new signatures and ingests deposits
(async () => {
  console.log("[deposit] Starting deposit indexer", {
    rpc: RPC,
    finality: GET_TX_FINALITY,
    treasury: TREASURY,
    pollInterval: `${POLL_MS}ms`,
    maxRetries: MAX_RETRIES,
    heartbeatInterval: `${HEARTBEAT_INTERVAL_MS}ms`,
  });

  // Start the heartbeat timer for periodic liveness reporting
  const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

  // Send an initial heartbeat on startup
  await sendHeartbeat();

  // Enter the infinite processing loop to fetch, decode, and ingest deposits
  for (;;) {
    try {
      // Read the last seen signature cursor for the treasury
      const { data: cRow, error: cErr } = await db
        .from("deposit_cursors")
        .select("last_seen_sig")
        .eq("address", TREASURY)
        .maybeSingle();

      if (cErr) throw cErr;

      const cursor = cRow?.last_seen_sig ?? null;

      // Collect new signatures beyond the last cursor
      const sigs = await collectSignaturesSinceCursor(tKey, cursor);
      if (!sigs.length) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }

      console.log(`[deposit] Processing ${sigs.length} new signature(s)...`);

      // Process signatures in arrival order with retry semantics
      for (const s of sigs) {
        let processed = false;
        let tx: VersionedTransactionResponse | null = null;

        // Retry fetching the transaction from RPC with exponential backoff
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

        // Retry ingesting the transaction with exponential backoff
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

        // Upsert the cursor when a signature is fully processed to maintain progress
        if (processed) {
          const up = {
            address: TREASURY,
            last_seen_sig: s.signature,
            updated_at: new Date().toISOString(),
          };

          // Retry updating the cursor to guard against transient DB failures
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
