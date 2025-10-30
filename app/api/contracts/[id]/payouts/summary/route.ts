import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";

// GET payout summary for a contract (creator-only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabaseServiceClient();
    const { id } = await params;
    const contractId = id;

    // Creator authentication
    const url = new URL(request.url);
    const requester_wallet = url.searchParams.get("requester_wallet");
    
    if (requester_wallet) {
      const { data: contract } = await supabase
        .from("contracts")
        .select("creator_id")
        .eq("id", contractId)
        .maybeSingle();

      if (contract) {
        const { data: creator } = await supabase
          .from("users")
          .select("wallet_address")
          .eq("id", contract.creator_id)
          .maybeSingle();

        if (!creator || creator.wallet_address !== requester_wallet) {
          return NextResponse.json(
            { error: "Only contract creator can view payout summary" },
            { status: 403 }
          );
        }
      }
    }

    const { data, error } = await supabase
      .from("payouts")
      .select("status, amount")
      .eq("contract_id", contractId);

    if (error) {
      return NextResponse.json({ error: "Failed to fetch payouts" }, { status: 500 });
    }

    const counts = {
      total: data?.length || 0,
      pending: data?.filter(p => p.status === "pending").length || 0,
      completed: data?.filter(p => p.status === "completed").length || 0,
      failed: data?.filter(p => p.status === "failed").length || 0,
    };
    const totals = {
      amount: (data || []).reduce((s, r) => s + Number(r.amount || 0), 0),
    };

    return NextResponse.json({ counts, totals });
  } catch (e) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


