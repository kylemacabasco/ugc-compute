import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
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
    const signature = await connection.sendRawTransaction(signed.serialize());

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
    return {
      signature: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
