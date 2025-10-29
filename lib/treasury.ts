import { Keypair } from "@solana/web3.js";
import { supabase } from "@/lib/supabase";

export interface TreasuryWallet {
  address: string;
  privateKey: string;
}

/**
 * Generates a new Solana keypair for treasury wallet
 */
export function generateTreasuryWallet(): TreasuryWallet {
  const keypair = Keypair.generate();
  
  return {
    address: keypair.publicKey.toBase58(),
    privateKey: Buffer.from(keypair.secretKey).toString('base64')
  };
}

/**
 * Generates a unique reference code for contract funding
 */
export function generateReferenceCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Creates a treasury wallet and reference code for a contract
 */
export async function createContractTreasury(contractId: string, userId: string): Promise<{
  treasuryWallet: TreasuryWallet;
  referenceCode: string;
}> {
  const treasuryWallet = generateTreasuryWallet();
  const referenceCode = generateReferenceCode();

  // Update contract with treasury wallet
  const { error: contractError } = await supabase
    .from("contracts")
    .update({
      treasury_wallet_address: treasuryWallet.address,
      treasury_keypair_encrypted: treasuryWallet.privateKey,
    })
    .eq("id", contractId);

  if (contractError) {
    throw new Error(`Failed to update contract with treasury wallet: ${contractError.message}`);
  }

  // Create reference code for funding
  try {
    const { error: refError } = await supabase
      .from("contract_refs")
      .insert({
        ref_code: referenceCode,
        contract_id: contractId,
        user_id: userId,
        status: "active",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      });

    if (refError) {
      console.warn("Reference code creation failed:", refError.message);
      // Don't throw error - treasury wallet is more important than reference code
    }
  } catch (error) {
    console.warn("Reference code creation failed:", error);
    // Don't throw error - treasury wallet is more important than reference code
  }

  return {
    treasuryWallet,
    referenceCode,
  };
}

