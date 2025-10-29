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
 * Generates a unique contract slug for contract funding
 */
export function generateContractSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Creates a treasury wallet and contract slug for a contract
 */
export async function createContractTreasury(contractId: string, userId: string): Promise<{
  treasuryWallet: TreasuryWallet;
  contractSlug: string;
}> {
  const treasuryWallet = generateTreasuryWallet();
  const contractSlug = generateContractSlug();

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

  // Create contract slug for funding
  try {
    const { error: slugError } = await supabase
      .from("contract_refs")
      .insert({
        ref_code: contractSlug,
        contract_id: contractId,
        user_id: userId,
        status: "active",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      });

    if (slugError) {
      // Contract slug creation failed - treasury wallet is more important
      console.error("Contract slug creation failed:", slugError.message);
    }
  } catch (error) {
    // Contract slug creation failed - treasury wallet is more important
    console.error("Contract slug creation failed:", error);
  }

  return {
    treasuryWallet,
    contractSlug,
  };
}

