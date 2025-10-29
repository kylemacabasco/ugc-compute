import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET treasury wallet and contract slug for a contract
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = id;

    // Get contract treasury info
    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("id, treasury_wallet_address, status")
      .eq("id", contractId)
      .single();

    if (contractError || !contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }

    if (!contract.treasury_wallet_address) {
      return NextResponse.json(
        { error: "Treasury wallet not configured for this contract" },
        { status: 400 }
      );
    }

    // Get active contract slug
    const { data: slugData, error: slugError } = await supabase
      .from("contract_refs")
      .select("ref_code, expires_at, status")
      .eq("contract_id", contractId)
      .eq("status", "active")
      .maybeSingle();

    if (slugError) {
      console.error("Error fetching contract slug:", slugError);
    }

    // Get total deposits for this contract
    const { data: deposits, error: depositsError } = await supabase
      .from("deposits")
      .select("ui_amount, status")
      .eq("contract_id", contractId)
      .eq("status", "finalized");

    const totalDeposited = deposits?.reduce(
      (sum, deposit) => sum + Number(deposit.ui_amount || 0),
      0
    ) || 0;

    return NextResponse.json({
      treasury_wallet_address: contract.treasury_wallet_address,
      contract_slug: slugData?.ref_code || null,
      contract_slug_expires_at: slugData?.expires_at || null,
      total_deposited: totalDeposited,
      contract_status: contract.status,
    });
  } catch (error) {
    console.error("Error in GET /api/contracts/[id]/treasury:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
