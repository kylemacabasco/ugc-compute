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
      .from("deposits")
      .select("ui_amount, status")
      .eq("contract_id", contractId)
      .eq("status", "finalized");

    if (error) {
      return NextResponse.json({ error: "Failed to fetch deposits" }, { status: 500 });
    }

    const totalDeposited = (data || []).reduce((s, r) => s + Number(r.ui_amount || 0), 0);
    return NextResponse.json({ total_deposited: totalDeposited });
  } catch (e) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


