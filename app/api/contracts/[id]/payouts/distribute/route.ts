import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST distribute payouts for a contract (creator-only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = id;

    // Get contract and creator
    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("id, creator_id, rate_per_1k_views")
      .eq("id", contractId)
      .single();

    if (contractError || !contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Optional creator auth via wallet
    const body = await request.json().catch(() => ({}));
    const { requester_wallet } = body as { requester_wallet?: string };

    if (requester_wallet) {
      const { data: creator } = await supabase
        .from("users")
        .select("wallet_address")
        .eq("id", contract.creator_id)
        .single();

      if (!creator || creator.wallet_address !== requester_wallet) {
        return NextResponse.json(
          { error: "Only contract creator can distribute payouts" },
          { status: 403 }
        );
      }
    }

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

    // Idempotency: if payouts already exist for this contract in pending or completed, avoid double creation
    const { data: existingPayouts } = await supabase
      .from("payouts")
      .select("id")
      .eq("contract_id", contractId)
      .in("status", ["pending", "completed"])
      .limit(1);

    if (existingPayouts && existingPayouts.length > 0) {
      return NextResponse.json(
        { error: "Payouts already created for this contract" },
        { status: 409 }
      );
    }

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

    const { data: inserted, error: insertError } = await supabase
      .from("payouts")
      .insert(payload)
      .select("id, user_id, amount, status");

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to create payouts" },
        { status: 500 }
      );
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


