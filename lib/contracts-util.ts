/* eslint-disable @typescript-eslint/no-explicit-any */
// Central Supabase DAO for contracts, submissions, profiles, and payouts.

import { createSupabaseServiceClient } from "./supabase";

// Minimal inline types
type Contract = {
  id: number | string; // adjust to uuid if needed
  status: "open" | "paused" | "filled";
  payout_status?: "pending" | "in_progress" | "paid" | null;
  total_value: number;        // SOL budget
  claimed_value: number;      // SOL accrued/owed
  rate_per_1k_views: number;  // SOL per 1k
  last_filled_at?: string | null;
  created_at?: string;
};

type Submission = {
  id: number;
  contract_id: Contract["id"];
  user_id: string;
  video_url: string;
  status: "pending" | "approved" | "rejected";
  view_count: number;
  earned_amount: number;       // SOL
  wallet_address?: string | null;
  created_at?: string;
};

type UserProfile = {
  id?: number;
  user_id: string;
  email?: string | null;
  username?: string | null;
  total_earnings: number;
};

// Single shared service client (server-side only)
const db = createSupabaseServiceClient();

// Core queries (contracts)
export async function getActiveContracts(): Promise<Contract[]> {
  const { data, error } = await (db.from("contracts") as any)
    .select("*")
    .eq("status", "open")
    .lt("claimed_value", "total_value")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Contract[];
}

export async function getContractById(id: Contract["id"]): Promise<Contract> {
  const { data, error } = await (db.from("contracts") as any)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Contract;
}


// Submissions (reads for monitoring)
export async function getSubmissionsByContract(
  contractId: Contract["id"],
  opts?: { status?: Submission["status"] }
): Promise<Submission[]> {
  let q = (db.from("submissions") as any)
    .select("*")
    .eq("contract_id", contractId)
    .order("created_at", { ascending: false });

  if (opts?.status) q = q.eq("status", opts.status);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Submission[];
}

export async function getApprovedSubmissionsByContract(
  contractId: Contract["id"]
): Promise<Pick<Submission, "id" | "video_url" | "view_count" | "earned_amount" | "user_id">[]> {
  const { data, error } = await (db.from("submissions") as any)
    .select("id, video_url, view_count, earned_amount, user_id")
    .eq("contract_id", contractId)
    .eq("status", "approved");
  if (error) throw error;
  return (data ?? []) as any[];
}


// Writes used by the monitor (safe/cached)

export async function updateSubmissionViewsAndEarnings(
  submissionId: number,
  viewCount: number,
  earnedAmount: number
): Promise<void> {
  const { error } = await (db.from("submissions") as any)
    .update({ view_count: viewCount, earned_amount: earnedAmount })
    .eq("id", submissionId);
  if (error) throw error;
}

export async function setContractClaimed(
  contractId: Contract["id"],
  claimedTotal: number
): Promise<void> {
  const { error } = await (db.from("contracts") as any)
    .update({ claimed_value: claimedTotal })
    .eq("id", contractId);
  if (error) throw error;
}

export async function markContractFilledAndQueuePayout(
  contractId: Contract["id"]
): Promise<void> {
  const { error: e1 } = await (db.from("contracts") as any)
    .update({
      status: "filled",
      payout_status: "pending",
      last_filled_at: new Date().toISOString(),
    })
    .eq("id", contractId);
  if (e1) throw e1;

  // Idempotent-ish enqueue in payouts
  const { data: existing, error: e2 } = await (db.from("payouts") as any)
    .select("id")
    .eq("contract_id", contractId)
    .in("status", ["queued", "in_progress"])
    .limit(1);
  if (e2) throw e2;

  if (!existing?.length) {
    const { error: e3 } = await (db.from("payouts") as any).insert({
      contract_id: contractId,
      status: "queued",
      created_at: new Date().toISOString(),
    });
    if (e3) throw e3;
  }
}


// Submission lifecycle
export async function createSubmission(
  userId: string,
  contractId: Contract["id"],
  videoUrl: string
): Promise<Submission> {
  const { data, error } = await (db.from("submissions") as any)
    .insert({
      user_id: userId,
      contract_id: contractId,
      video_url: videoUrl,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;
  return data as Submission;
}

export async function updateSubmissionStatus(
  submissionId: number,
  status: Submission["status"],
  validationExplanation: string,
  viewCount?: number
): Promise<Submission> {
  const patch: any = { status, validation_explanation: validationExplanation };

  if (viewCount !== undefined) {
    patch.view_count = viewCount;
    if (status === "approved") {
      const { data: subRow, error: sErr } = await (db.from("submissions") as any)
        .select("contract_id")
        .eq("id", submissionId)
        .single();
      if (sErr) throw sErr;

      const contract = await getContractById(subRow.contract_id);
      patch.earned_amount = (viewCount / 1000) * Number(contract.rate_per_1k_views || 0);
    }
  }

  const { data, error } = await (db.from("submissions") as any)
    .update(patch)
    .eq("id", submissionId)
    .select()
    .single();
  if (error) throw error;
  return data as Submission;
}


// Profiles & user stats
export async function getOrCreateUserProfile(
  userId: string,
  email?: string,
  username?: string
): Promise<UserProfile> {
  const { data: existing } = await (db.from("user_profiles") as any)
    .select("*")
    .eq("user_id", userId)
    .single();
  if (existing) return existing as UserProfile;

  const { data, error } = await (db.from("user_profiles") as any)
    .insert({
      user_id: userId,
      email: email || null,
      username: username || null,
      total_earnings: 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data as UserProfile;
}

export async function updateUserEarnings(
  userId: string,
  amount: number
): Promise<UserProfile> {
  const { data: profile } = await (db.from("user_profiles") as any)
    .select("total_earnings")
    .eq("user_id", userId)
    .single();
  if (!profile) throw new Error("User profile not found");

  const newTotal = Number(profile.total_earnings || 0) + Number(amount || 0);

  const { data, error } = await (db.from("user_profiles") as any)
    .update({ total_earnings: newTotal })
    .eq("user_id", userId)
    .select()
    .single();
  if (error) throw error;
  return data as UserProfile;
}

export async function getUserStats(userId: string) {
  const { data: profile } = await (db.from("user_profiles") as any)
    .select("*")
    .eq("user_id", userId)
    .single();

  const { data: submissions } = await (db.from("submissions") as any)
    .select("*")
    .eq("user_id", userId);

  const subs = (submissions ?? []) as Submission[];

  return {
    profile: (profile as UserProfile) ?? null,
    stats: {
      totalSubmissions: subs.length,
      approvedSubmissions: subs.filter((s) => s.status === "approved").length,
      pendingSubmissions: subs.filter((s) => s.status === "pending").length,
      rejectedSubmissions: subs.filter((s) => s.status === "rejected").length,
      totalEarnings: Number((profile as any)?.total_earnings || 0),
      totalViews: subs.reduce((sum, s) => sum + Number(s.view_count || 0), 0),
    },
  };
}


// Payout plan 
export async function buildPayoutPlanForContract(
  contractId: Contract["id"]
): Promise<{ user_id: string; wallet_address: string; payable_sol: number }[]> {
  // If wallet lives on user_profiles, JOIN there instead of using submissions.wallet_address
  const { data: subs, error } = await (db.from("submissions") as any)
    .select("user_id, earned_amount, wallet_address")
    .eq("contract_id", contractId)
    .eq("status", "approved");
  if (error) throw error;

  const byUser = new Map<string, { wallet: string; sum: number }>();
  for (const row of (subs ?? []) as any[]) {
    const uid = row.user_id as string;
    const wallet = String(row.wallet_address || "");
    if (!uid || !wallet) continue;
    const prev = byUser.get(uid) ?? { wallet, sum: 0 };
    prev.sum += Number(row.earned_amount || 0);
    byUser.set(uid, prev);
  }

  return Array.from(byUser.entries()).map(([user_id, v]) => ({
    user_id,
    wallet_address: v.wallet,
    payable_sol: v.sum,
  }));
}
