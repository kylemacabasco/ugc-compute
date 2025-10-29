import { supabase } from "@/lib/supabase";

/**
 * Generates a unique contract slug for contract funding attribution
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
 * Creates a contract slug for a contract
 * Contract attribution is done via slugs/memos for deposit tracking
 */
export async function createContractSlug(contractId: string, userId: string): Promise<{
  contractSlug: string;
}> {
  const contractSlug = generateContractSlug();

  // Create contract slug for funding attribution
  try {
    const { error: slugError } = await supabase
      .from("contract_refs")
      .insert({
        contract_slug: contractSlug,
        contract_id: contractId,
        user_id: userId,
        status: "active",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      });

    if (slugError) {
      throw new Error(`Failed to create contract slug: ${slugError.message}`);
    }
  } catch (error) {
    console.error("Contract slug creation failed:", error);
    throw error;
  }

  return {
    contractSlug,
  };
}

