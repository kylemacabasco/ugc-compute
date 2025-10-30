import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";

// GET total deposited SOL for a contract (finalized deposits only)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabaseServiceClient();
    const { id } = await params;
    const contractId = id;

    const { data, error } = await supabase
      .from("deposits")
      .select("ui_amount, status, asset_key")
      .eq("contract_id", contractId)
      .eq("status", "finalized")
      .eq("asset_key", "SOL");

    if (error) {
      return NextResponse.json({ error: "Failed to fetch deposits" }, { status: 500 });
    }

    const totalDeposited = (data || []).reduce((s, r) => s + Number(r.ui_amount || 0), 0);
    return NextResponse.json({ total_deposited: totalDeposited });
  } catch (e) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


