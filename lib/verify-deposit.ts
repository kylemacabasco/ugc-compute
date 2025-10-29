// Verify transaction exists on-chain
import { Connection } from "@solana/web3.js";

export async function verifyDeposit(txSig: string, maxRetries: number = 3) {
  const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (!RPC) throw new Error("SOLANA_RPC_URL is required");

  const conn = new Connection(RPC, { commitment: "confirmed" });

  // Retry with exponential backoff: 2s, 4s, 8s
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delayMs = Math.pow(2, attempt) * 1000;
    
    if (attempt > 1) {
      console.log(`[verify-deposit] Retry ${attempt}/${maxRetries} for ${txSig} after ${delayMs}ms`);
    }
    
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      // Fetch transaction from Solana
      const tx = await conn.getTransaction(txSig, {
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      });

      if (!tx) {
        if (attempt === maxRetries) {
          console.warn(`[verify-deposit] Transaction ${txSig} not found after ${maxRetries} attempts`);
          return { success: false, error: "Transaction not found after retries" };
        }
        continue;
      }

      // Transaction verified on-chain!
      return { success: true, slot: tx.slot, blockTime: tx.blockTime };
    } catch (error) {
      if (attempt === maxRetries) {
        console.error("[verify-deposit] Error:", error);
        return { success: false, error };
      }
    }
  }

  return { success: false, error: "Max retries exceeded" };
}