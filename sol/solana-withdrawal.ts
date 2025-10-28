/* eslint-disable @typescript-eslint/no-explicit-any */
// Minimal withdrawals API. Short comments only.
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type WithdrawalStatus = "approved" | "broadcast" | "confirmed" | "finalized" | "failed";
export type WithdrawalRequestStatus = "requested" | "approved" | "rejected" | "canceled" | "fulfilled";

// SR client
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// End-user client (pass a JWT)
export function getUserClient(jwt: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required");
  return createClient(url, "", {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// Precise UI conversion
export function toUiAmount(amountBaseUnits: string | number | bigint, decimals: number) {
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

// End-user creates request
export async function createWithdrawalRequest(db: SupabaseClient, params: {
  userId: string;
  contractId: string;
  fromAddress: string;
  toAddress: string;
  mint: string | null;        // null => SOL
  amountBaseUnits: string;    // string for precision
  decimals: number;           // 9 for SOL
}) {
  const row = {
    user_id: params.userId,
    contract_id: params.contractId,
    from_address: params.fromAddress,
    to_address: params.toAddress,
    mint: params.mint,
    amount_base_units: params.amountBaseUnits,
    decimals: params.decimals,
    status: "requested" as WithdrawalRequestStatus,
  };
  const { data, error } = await db.from("withdrawal_requests").insert(row).select().single();
  if (error) throw error;
  return data;
}

// SR: approve request -> create withdrawal
export async function approveWithdrawalRequest(sr: SupabaseClient, requestId: string) {
  const { data: req, error: e1 } = await sr.from("withdrawal_requests").select("*").eq("id", requestId).single();
  if (e1) throw e1;
  if (req.status !== "requested") throw new Error(`Cannot approve status=${req.status}`);

  const uiAmount = toUiAmount(req.amount_base_units, req.decimals);

  const { data: wd, error: e2 } = await sr
    .from("withdrawals")
    .insert({
      user_id: req.user_id,
      contract_id: req.contract_id,
      from_address: req.from_address,
      to_address: req.to_address,
      mint: req.mint,
      amount_base_units: req.amount_base_units,
      decimals: req.decimals,
      ui_amount: uiAmount,
      status: "approved",
      request_id: req.id,
    })
    .select()
    .single();

  if (e2) {
    const dup = String(e2.message || "").includes("ux_withdrawals_request_id");
    if (!dup) throw e2;
    const { data: existing, error: e3 } = await sr.from("withdrawals").select("*").eq("request_id", requestId).single();
    if (e3) throw e3;
    return existing;
  }

  const { error: e3 } = await sr.from("withdrawal_requests").update({ status: "approved" }).eq("id", requestId);
  if (e3) throw e3;

  return wd;
}

// SR: mark broadcast
export async function markWithdrawalBroadcast(sr: SupabaseClient, params: {
  withdrawalId: string;
  txSig: string;
  slot?: number;
  blockTimeIso?: string;
}) {
  const patch: Record<string, any> = { status: "broadcast" as WithdrawalStatus, tx_sig: params.txSig };
  if (typeof params.slot === "number") patch.slot = params.slot;
  if (params.blockTimeIso) patch.block_time = params.blockTimeIso;
  const { data, error } = await sr.from("withdrawals").update(patch).eq("id", params.withdrawalId).select().single();
  if (error) throw error;
  return data;
}

// SR: mark confirmed
export async function markWithdrawalConfirmed(sr: SupabaseClient, params: {
  withdrawalId: string;
  slot?: number;
  blockTimeIso?: string;
}) {
  const patch: Record<string, any> = { status: "confirmed" as WithdrawalStatus };
  if (typeof params.slot === "number") patch.slot = params.slot;
  if (params.blockTimeIso) patch.block_time = params.blockTimeIso;
  const { data, error } = await sr.from("withdrawals").update(patch).eq("id", params.withdrawalId).select().single();
  if (error) throw error;
  return data;
}

// SR: mark finalized
export async function markWithdrawalFinalized(sr: SupabaseClient, withdrawalId: string) {
  const { data, error } = await sr
    .from("withdrawals")
    .update({ status: "finalized" as WithdrawalStatus })
    .eq("id", withdrawalId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// SR: mark failed
export async function markWithdrawalFailed(sr: SupabaseClient, withdrawalId: string, reason: string) {
  const { data, error } = await sr
    .from("withdrawals")
    .update({ status: "failed" as WithdrawalStatus, fail_reason: reason })
    .eq("id", withdrawalId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
