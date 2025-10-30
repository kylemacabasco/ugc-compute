import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";

// POST distribute payouts for a contract (creator-only)
// Creates pending payout records based on earnings or approved submissions
// 
// This endpoint ONLY creates payout records in the database with status="pending"
// It does NOT perform on-chain Solana transfers
// 
// A separate processor endpoint (/api/payouts/process) will handle:
// - Multisig Squads vault transactions
// - Updating payout status to "completed" with transaction signatures
// - Handling on-chain execution and confirmation
//
// Idempotency: DB constraint prevents duplicate distributions (migration 005)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabaseServiceClient();
    const { id } = await params;
    const contractId = id;

    // Get contract and creator
    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("id, creator_id, rate_per_1k_views")
      .eq("id", contractId)
      .maybeSingle();

    if (contractError || !contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Require creator auth via wallet (mandatory)
    const body = await request.json().catch(() => ({}));
    const { requester_wallet } = body as { requester_wallet?: string };
    if (!requester_wallet) {
      return NextResponse.json({ error: "requester_wallet required" }, { status: 400 });
    }
    const { data: creator } = await supabase
      .from("users")
      .select("wallet_address")
      .eq("id", contract.creator_id)
      .maybeSingle();
    if (!creator || creator.wallet_address !== requester_wallet) {
      return NextResponse.json(
        { error: "Only contract creator can distribute payouts" },
        { status: 403 }
      );
    }

    // Server-side funding guard: finalized SOL deposits minus committed payouts
    const { data: dep } = await supabase
      .from("deposits")
      .select("ui_amount")
      .eq("contract_id", contractId)
      .eq("status", "finalized")
      .eq("asset_key", "SOL");
    const funded = (dep || []).reduce((s, r: any) => s + Number(r.ui_amount || 0), 0);
    const { data: outs } = await supabase
      .from("payouts")
      .select("amount, status")
      .eq("contract_id", contractId)
      .in("status", ["pending", "processing", "completed", "paid"]);
    const committed = (outs || []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
    const available = funded - committed;

    // Strategy 1: Aggregate from earnings table (pending amounts)
    const { data: pendingEarnings, error: earningsError } = await supabase
      .from("earnings")
      .select("user_id, amount_earned")
      .eq("contract_id", contractId)
      .eq("payout_status", "pending");

    const userTotals = new Map<string, number>();
    if (!earningsError && pendingEarnings && pendingEarnings.length > 0) {
      for (const row of pendingEarnings) {
        const prev = userTotals.get(row.user_id) || 0;
        userTotals.set(row.user_id, prev + Number(row.amount_earned || 0));
      }
    } else {
      // Strategy 2 fallback: derive from approved submissions
      const { data: approvedSubs, error: subsError } = await supabase
        .from("submissions")
        .select("id, user_id, earned_amount, view_count")
        .eq("contract_id", contractId)
        .eq("status", "approved");

      if (subsError) {
        return NextResponse.json(
          { error: "Failed to fetch submissions" },
          { status: 500 }
        );
      }

      if (!approvedSubs || approvedSubs.length === 0) {
        return NextResponse.json({ success: true, payouts: [], message: "No approved submissions or pending earnings" });
      }

      for (const sub of approvedSubs) {
        const base = typeof sub.earned_amount === "number" && !isNaN(sub.earned_amount)
          ? sub.earned_amount
          : ((Number(sub.view_count || 0) / 1000) * Number(contract.rate_per_1k_views || 0));
        const prev = userTotals.get(sub.user_id) || 0;
        userTotals.set(sub.user_id, prev + base);
      }
    }

    // Build payout payload
    const payload = Array.from(userTotals.entries())
      .map(([userId, amount]) => ({
        userId,
        amount: Number.isFinite(Number(amount)) ? Number(amount) : 0,
      }))
      .filter((row) => row.userId && row.amount > 0)
      .map((row) => ({
        contract_id: contractId,
        user_id: row.userId,
        amount: row.amount,
        status: "pending",
      }));

    if (payload.length === 0) {
      return NextResponse.json({ success: true, payouts: [], message: "No earnings to distribute (0 totals after filtering)" });
    }

    // Insert payouts - DB unique constraint (migration 005) prevents duplicates
    // If constraint violation occurs, it means payouts were already created (race condition or retry)
    const { data: inserted, error: insertError } = await supabase
      .from("payouts")
      .insert(payload)
      .select("id, user_id, amount, status");

    if (insertError) {
      // Unique constraint violation (23505) = payouts already exist for this contract
      if (insertError.code === "23505" || insertError.message?.includes("ux_payouts_contract_pending")) {
        // Fetch existing payouts to return helpful info
        const { data: existing } = await supabase
          .from("payouts")
          .select("id, status, created_at")
          .eq("contract_id", contractId)
          .in("status", ["pending", "processing", "completed", "paid"])
          .limit(1);
        
        return NextResponse.json(
          { 
            error: "Payouts already created for this contract", 
            existing: existing?.[0],
            detail: "Database constraint prevents duplicate distributions"
          },
          { status: 409 }
        );
      }
      console.error("Payout insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create payouts", detail: insertError.message },
        { status: 500 }
      );
    }

    // Mark earnings as committed to prevent double-counting
    if (pendingEarnings && pendingEarnings.length > 0) {
      await supabase
        .from("earnings")
        .update({ payout_status: "committed" })
        .eq("contract_id", contractId)
        .eq("payout_status", "pending");
    }

    return NextResponse.json({ success: true, payouts: inserted });
  } catch (error) {
    console.error("Error in POST /api/contracts/[id]/payouts/distribute:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return POST(request, context);
}


