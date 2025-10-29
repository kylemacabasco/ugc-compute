import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET squads vault address and contract slug for a contract
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = id;

    // Get contract info
    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("id, status")
      .eq("id", contractId)
      .single();

    if (contractError || !contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }

    // Get squads vault address from environment (single multisig vault for all contracts)
    const squadsVaultAddress = process.env.SQUADS_VAULT_ADDRESS;
    if (!squadsVaultAddress) {
      return NextResponse.json(
        { error: "Squads vault address not configured" },
        { status: 500 }
      );
    }

    // Get active contract slug
    const { data: slugData, error: slugError } = await supabase
      .from("contract_refs")
      .select("contract_slug, expires_at, status")
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
      vault_address: squadsVaultAddress,
      contract_slug: slugData?.contract_slug || null,
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
