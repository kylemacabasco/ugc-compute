/* eslint-disable @typescript-eslint/no-explicit-any */
// SOL-only withdrawal processor
// Processes a single withdrawal from approved to finalized
// Usage: npx tsx scripts/withdraw-sol.ts <withdrawal_id>

import "dotenv/config";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  getServiceClient,
  markWithdrawalBroadcast,
  markWithdrawalConfirmed,
  markWithdrawalFinalized,
  markWithdrawalFailed,
} from "./helpers";

// ============================================================================
// CONFIGURATION
// ============================================================================

const RPC = process.env.SOLANA_RPC_URL || "";
const SECRET_B58 = (
  process.env.SOL_WALLET_SECRET_BASE58 ||
  process.env.SOL_TREASURY_WALLET_SECRET_KEY ||
  ""
).trim();

if (!RPC) throw new Error("SOLANA_RPC_URL is required");
if (!SECRET_B58)
  throw new Error(
    "SOL_WALLET_SECRET_BASE58 (or SOL_TREASURY_WALLET_SECRET_KEY) is required"
  );

const conn = new Connection(RPC, { commitment: "finalized" });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Wait for transaction to be finalized (HTTP polling)
async function waitFinalized(
  signature: string,
  timeoutMs = 180_000,
  pollMs = 2_000
) {
  const start = Date.now();
  for (;;) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const st = value[0];
    if (st) {
      if (st.err)
        throw new Error(`Transaction error: ${JSON.stringify(st.err)}`);
      if (
        st.confirmationStatus === "finalized" ||
        st.confirmations === null
      )
        return st;
    }
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timeout waiting for finalization (${timeoutMs}ms)`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// Load treasury keypair from base58 secret
function loadKeypair(): Keypair {
  const bytes = bs58.decode(SECRET_B58);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error("Invalid base58 secret length; expected 64 or 32 bytes");
}

// ============================================================================
// MAIN PROCESSOR
// ============================================================================

const [, , withdrawalId] = process.argv;

if (!withdrawalId) {
  console.error("Usage: npx tsx scripts/withdraw-sol.ts <withdrawal_id>");
  console.error("");
  console.error("Example:");
  console.error("  npx tsx scripts/withdraw-sol.ts 550e8400-e29b-41d4-a716-446655440000");
  process.exit(1);
}

(async () => {
  const sr = getServiceClient();

  console.log(`[withdraw] Processing withdrawal: ${withdrawalId}`);

  // Fetch withdrawal record
  const { data: wd, error: fetchErr } = await sr
    .from("withdrawals")
    .select("*")
    .eq("id", withdrawalId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;
  if (!wd) throw new Error(`No withdrawal found for id=${withdrawalId}`);

  // Validate withdrawal is for SOL
  if (wd.mint !== null) {
    throw new Error("SOL-only withdrawals supported (mint must be null)");
  }
  if (wd.decimals !== 9) {
    throw new Error("Expected decimals=9 for SOL");
  }

  console.log("[withdraw] Current state:", {
    id: wd.id,
    status: wd.status,
    to_address: wd.to_address,
    amount: `${wd.ui_amount} SOL`,
    tx_sig: wd.tx_sig || "none",
  });

  // Check if already finalized
  if (wd.status === "finalized") {
    console.log("[withdraw] Already finalized");
    console.log(`[withdraw] Explorer: https://explorer.solana.com/tx/${wd.tx_sig}`);
    return;
  }

  // Send transaction if approved
  let sig: string | null = wd.tx_sig;

  if (wd.status === "approved") {
    console.log("[withdraw] Sending transaction...");

    const kp = loadKeypair();
    const treasuryPubkey = kp.publicKey.toBase58();

    // Verify treasury wallet matches from_address
    if (treasuryPubkey !== wd.from_address) {
      throw new Error(
        `Treasury wallet mismatch: ${treasuryPubkey} != ${wd.from_address}`
      );
    }

    // Parse amount
    const lamports = Number(wd.amount_base_units);
    if (!Number.isFinite(lamports) || lamports <= 0) {
      throw new Error("Invalid amount_base_units");
    }

    // Build transaction
    const ix = SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: new PublicKey(wd.to_address),
      lamports,
    });

    const { blockhash } = await conn.getLatestBlockhash("finalized");
    const tx = new Transaction({
      feePayer: kp.publicKey,
      recentBlockhash: blockhash,
    }).add(ix);
    tx.sign(kp);

    // Send transaction
    sig = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
    });

    await markWithdrawalBroadcast(sr, {
      withdrawalId,
      txSig: sig,
      blockTimeIso: new Date().toISOString(),
    });

    console.log("[withdraw] Transaction broadcast:", sig);
  }

  // Wait for finalization
  if (wd.status === "broadcast" || wd.status === "approved") {
    if (!sig) throw new Error("Missing tx_sig after broadcast");

    console.log("[withdraw] Waiting for finalization...");

    try {
      await waitFinalized(sig);
    } catch (err: any) {
      const msg = String(err?.message || err);
      console.error("[withdraw] Transaction failed:", msg);
      await markWithdrawalFailed(sr, withdrawalId, msg.slice(0, 512));
      throw err;
    }

    // Mark as confirmed then finalized
    await markWithdrawalConfirmed(sr, { withdrawalId });
    await markWithdrawalFinalized(sr, withdrawalId);

    console.log("[withdraw] Transaction finalized");
    console.log(`[withdraw] Explorer: https://explorer.solana.com/tx/${sig}`);
    return;
  }

  // Handle confirmed to finalized
  if (wd.status === "confirmed") {
    await markWithdrawalFinalized(sr, withdrawalId);
    console.log("[withdraw] Marked as finalized");
    console.log(`[withdraw] Explorer: https://explorer.solana.com/tx/${wd.tx_sig}`);
    return;
  }

  // Handle unexpected status
  throw new Error(`Unhandled withdrawal status: ${wd.status}`);
})().catch((e) => {
  console.error("[withdraw] Fatal error:", e);
  process.exit(1);
});