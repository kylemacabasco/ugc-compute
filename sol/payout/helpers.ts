// Updated helpers to match your exact schema
// Location: sol/payout/helpers.ts
import "dotenv/config";
import { type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "../../lib/supabase";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export type WithdrawalStatus = "approved" | "proposal_created" | "broadcast" | "confirmed" | "finalized" | "failed";

// Get service role client
export function getServiceClient(): SupabaseClient {
  return createSupabaseServiceClient();
}

// Convert base units to UI amount
export function toUiAmount(amountBaseUnits: string | number | bigint, decimals: number): string {
  const s = typeof amountBaseUnits === "bigint" ? amountBaseUnits.toString() : String(amountBaseUnits);
  if (decimals === 0) return s;
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;
  const padded = digits.padStart(decimals + 1, "0");
  const split = padded.length - decimals;
  const intPart = padded.slice(0, split);
  const frac = padded.slice(split).replace(/0+$/, "");
  return `${neg ? "-" : ""}${intPart}${frac ? "." + frac : ""}`;
}

// Convert UI amount to base units
export function toBaseUnits(uiAmount: number, decimals: number): bigint {
  const multiplier = BigInt(10 ** decimals);
  const scaled = Math.floor(uiAmount * (10 ** decimals));
  return BigInt(scaled);
}

// Proportional payout calculations
export interface UserEarnings {
  userId: string;
  walletAddress: string;
  submissionId: number;
  viewsAchieved: number;
  earnedAmount: number;
  actualPayout: number;
  actualPayoutLamports: bigint;
}

export function calculateProportionalPayouts(params: {
  contractBudget: number;
  ratePerThousandViews: number;
  userSubmissions: Array<{
    userId: string;
    walletAddress: string;
    submissionId: number;
    viewsAchieved: number;
  }>;
}): UserEarnings[] {
  const { contractBudget, ratePerThousandViews, userSubmissions } = params;

  const earnings = userSubmissions.map(sub => {
    const viewsInThousands = sub.viewsAchieved / 1000;
    const earnedAmount = viewsInThousands * ratePerThousandViews;
    
    return {
      userId: sub.userId,
      walletAddress: sub.walletAddress,
      submissionId: sub.submissionId,
      viewsAchieved: sub.viewsAchieved,
      earnedAmount,
      actualPayout: earnedAmount,
      actualPayoutLamports: toBaseUnits(earnedAmount, 9),
    };
  });

  const totalEarned = earnings.reduce((sum, e) => sum + e.earnedAmount, 0);

  // Scale if exceeds budget
  if (totalEarned > contractBudget) {
    const scalingFactor = contractBudget / totalEarned;
    
    earnings.forEach(e => {
      e.actualPayout = e.earnedAmount * scalingFactor;
      e.actualPayoutLamports = toBaseUnits(e.actualPayout, 9);
    });

    console.log(`Scaling payouts: ${totalEarned.toFixed(2)} SOL earned, ${contractBudget.toFixed(2)} SOL budget`);
    console.log(`Scaling factor: ${(scalingFactor * 100).toFixed(2)}%`);
  }

  return earnings;
}

// Withdrawal status updates
export async function markWithdrawalProposalCreated(sr: SupabaseClient, params: {
  withdrawalId: string;
  squadsProposalId: string;
  squadsTransactionIndex: number;
}) {
  const { data, error } = await sr
    .from("withdrawals")
    .update({ 
      status: "proposal_created" as WithdrawalStatus,
      squads_proposal_id: params.squadsProposalId,
      squads_transaction_index: params.squadsTransactionIndex,
    })
    .eq("id", params.withdrawalId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function markWithdrawalBroadcast(sr: SupabaseClient, params: {
  withdrawalId: string;
  txSig: string;
  slot?: number;
  blockTimeIso?: string;
}) {
  const patch: Record<string, any> = { 
    status: "broadcast" as WithdrawalStatus, 
    tx_sig: params.txSig 
  };
  
  if (typeof params.slot === "number") patch.slot = params.slot;
  if (params.blockTimeIso) patch.block_time = params.blockTimeIso;
  
  const { data, error } = await sr
    .from("withdrawals")
    .update(patch)
    .eq("id", params.withdrawalId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function markWithdrawalConfirmed(sr: SupabaseClient, params: {
  withdrawalId: string;
  slot?: number;
  blockTimeIso?: string;
}) {
  const patch: Record<string, any> = { status: "confirmed" as WithdrawalStatus };
  
  if (typeof params.slot === "number") patch.slot = params.slot;
  if (params.blockTimeIso) patch.block_time = params.blockTimeIso;
  
  const { data, error } = await sr
    .from("withdrawals")
    .update(patch)
    .eq("id", params.withdrawalId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function markWithdrawalFinalized(sr: SupabaseClient, withdrawalId: string) {
  const { data, error } = await sr
    .from("withdrawals")
    .update({ 
      status: "finalized" as WithdrawalStatus,
      processed_at: new Date().toISOString()
    })
    .eq("id", withdrawalId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function markWithdrawalFailed(
  sr: SupabaseClient, 
  withdrawalId: string, 
  reason: string
) {
  const { data, error } = await sr
    .from("withdrawals")
    .update({ 
      status: "failed" as WithdrawalStatus, 
      fail_reason: reason.slice(0, 512)
    })
    .eq("id", withdrawalId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}