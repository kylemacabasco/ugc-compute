/* eslint-disable @typescript-eslint/no-explicit-any */
// SOL-only withdrawal sender. Resumable. No WebSockets. No rebroadcast.
import "dotenv/config";
import bs58 from "bs58";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction
} from "@solana/web3.js";
import {
  getServiceClient,
  markWithdrawalBroadcast,
  markWithdrawalConfirmed,
  markWithdrawalFinalized,
  markWithdrawalFailed,
} from "../sol/solana-withdrawal";

const RPC = process.env.SOLANA_RPC_URL || "";
const SECRET_B58 = (process.env.SOL_WALLET_SECRET_BASE58 || process.env.SOL_TREASURY_WALLET_SECRET_KEY || "").trim();
if (!RPC) throw new Error("SOLANA_RPC_URL is required");
if (!SECRET_B58) throw new Error("SOL_WALLET_SECRET_BASE58 (or SOL_TREASURY_WALLET_SECRET_KEY) is required");

const conn = new Connection(RPC, { commitment: "finalized" });

// wait for finalized by HTTP polling only
async function waitFinalized(signature: string, timeoutMs = 180_000, pollMs = 2_000) {
  const start = Date.now();
  for (;;) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const st = value[0];
    if (st) {
      if (st.err) throw new Error(`tx ${signature} error: ${JSON.stringify(st.err)}`);
      if (st.confirmationStatus === "finalized" || st.confirmations === null) return st;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting finalization for ${signature}`);
    await new Promise(r => setTimeout(r, pollMs));
  }
}

// load treasury keypair
function loadKeypair(): Keypair {
  const bytes = bs58.decode(SECRET_B58);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new Error("Invalid base58 length; expected 64 or 32");
}

const [, , withdrawalId] = process.argv;
if (!withdrawalId) {
  console.error("Usage: tsx -r dotenv/config scripts/withdraw-sol.ts <withdrawal_id>");
  process.exit(1);
}

(async () => {
  const sr = getServiceClient();

  // fetch row
  const { data: wd, error: e1 } = await sr.from("withdrawals").select("*").eq("id", withdrawalId).maybeSingle();
  if (e1) throw e1;
  if (!wd) throw new Error(`No withdrawal found for id=${withdrawalId}`);
  if (wd.mint !== null) throw new Error("SOL-only (mint must be null)");
  if (wd.decimals !== 9) throw new Error("Expected decimals=9 for SOL");

  console.log("state:", { id: wd.id, status: wd.status, tx_sig: wd.tx_sig, ui: wd.ui_amount });

  // already done
  if (wd.status === "finalized") {
    console.log("already finalized:", { id: wd.id, tx: wd.tx_sig });
    return;
  }

  // send once if approved
  let sig: string | null = wd.tx_sig;
  if (wd.status === "approved") {
    const kp = loadKeypair();
    if (kp.publicKey.toBase58() !== wd.from_address) {
      throw new Error(`Keypair pubkey ${kp.publicKey.toBase58()} != from_address ${wd.from_address}`);
    }
    const lamports = Number(wd.amount_base_units);
    if (!Number.isFinite(lamports) || lamports <= 0) throw new Error("Invalid amount_base_units");

    const ix = SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: new PublicKey(wd.to_address),
      lamports,
    });

    const { blockhash } = await conn.getLatestBlockhash("finalized");
    const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: blockhash }).add(ix);
    tx.sign(kp);

    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await markWithdrawalBroadcast(sr, { withdrawalId, txSig: sig, blockTimeIso: new Date().toISOString() });
    console.log("broadcast:", { id: wd.id, sig });
  }

  // poll only; no rebroadcast
  if (wd.status === "broadcast" || wd.status === "approved") {
    if (!sig) throw new Error("missing tx_sig after broadcast");
    try {
      await waitFinalized(sig);
    } catch (err: any) {
      const msg = String(err?.message || err);
      await markWithdrawalFailed(sr, withdrawalId, msg.slice(0, 512));
      throw err;
    }
    await markWithdrawalConfirmed(sr, { withdrawalId });
    await markWithdrawalFinalized(sr, withdrawalId);
    console.log("finalized:", { id: wd.id, sig });
    console.log(`explorer: https://explorer.solana.com/tx/${sig}`);
    return;
  }

  // confirmed → finalize
  if (wd.status === "confirmed") {
    await markWithdrawalFinalized(sr, withdrawalId);
    console.log("finalized:", { id: wd.id, tx: wd.tx_sig });
    return;
  }

  // any other status
  throw new Error(`Unhandled status: ${wd.status}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
