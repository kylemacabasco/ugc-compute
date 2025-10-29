import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = id;

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


