import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  SendTransactionError,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

export interface DepositParams {
  wallet: WalletContextState;
  connection: Connection;
  treasuryAddress: string;
  amount: number; // in SOL
  refCode: string;
}

export interface DepositResult {
  signature: string;
  success: boolean;
  error?: string;
}

/**
 * Send SOL to the treasury wallet with a memo containing the reference code
 */
export async function depositToTreasury({
  wallet,
  connection,
  treasuryAddress,
  amount,
  refCode,
}: DepositParams): Promise<DepositResult> {
  try {
    if (!wallet.publicKey || !wallet.signTransaction) {
      throw new Error("Wallet not connected");
    }

    // Convert SOL to lamports
    const lamports = Math.floor(amount * LAMPORTS_PER_SOL);

    if (lamports <= 0) {
      throw new Error("Amount must be greater than 0");
    }

    const treasuryPubkey = new PublicKey(treasuryAddress);

    // Check wallet balance
    const balance = await connection.getBalance(wallet.publicKey);
    const estimatedFee = 5000; // Estimate 5000 lamports for transaction fee
    const totalRequired = lamports + estimatedFee;

    if (balance < totalRequired) {
      const balanceSOL = (balance / LAMPORTS_PER_SOL).toFixed(4);
      const requiredSOL = (totalRequired / LAMPORTS_PER_SOL).toFixed(4);
      throw new Error(
        `Insufficient balance. You have ${balanceSOL} SOL but need ${requiredSOL} SOL (including fees)`
      );
    }

    // Create the transaction
    const transaction = new Transaction();

    // Add memo instruction with reference code
    const memoInstruction = new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(`ref:${refCode}`, "utf-8"),
    });
    transaction.add(memoInstruction);

    // Add transfer instruction
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: treasuryPubkey,
      lamports,
    });
    transaction.add(transferInstruction);

    // Get latest blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = wallet.publicKey;

    // Sign and send transaction
    const signed = await wallet.signTransaction(transaction);
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation
    await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed"
    );

    return {
      signature,
      success: true,
    };
  } catch (error) {
    console.error("Deposit error:", error);

    // Extract detailed logs from SendTransactionError
    if (error instanceof SendTransactionError) {
      const logs = await error.getLogs(connection);
      console.error("Transaction logs:", logs);
      
      // Check for specific error patterns
      if (logs?.some(log => log.includes("insufficient lamports"))) {
        return {
          signature: "",
          success: false,
          error: "Insufficient funds to complete the transaction",
        };
      }
    }

    return {
      signature: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
