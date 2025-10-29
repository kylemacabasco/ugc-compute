import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";

// POST activate a contract (change status from awaiting_funding to open)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabaseServiceClient();
    const { id: contractId } = await params;

    console.log(`[activate] Opening contract ${contractId}`);

    // Get current contract status
    const { data: contract, error: fetchError } = await supabase
      .from("contracts")
      .select("status")
      .eq("id", contractId)
      .single();

    if (fetchError || !contract) {
      console.error("Error fetching contract:", fetchError);
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }

    // Only update if contract is in awaiting_funding status
    if (contract.status !== "awaiting_funding") {
      console.log(`[activate] Contract is already in ${contract.status} status`);
      return NextResponse.json({
        success: true,
        message: `Contract is already ${contract.status}`,
        status: contract.status,
      });
    }

    // Update contract status from awaiting_funding to open
    const { data, error } = await supabase
      .from("contracts")
      .update({ status: "open" })
      .eq("id", contractId)
      .eq("status", "awaiting_funding")
      .select()
      .single();

    if (error) {
      console.error("Error opening contract:", error);
      return NextResponse.json(
        { error: "Failed to open contract" },
        { status: 500 }
      );
    }

    console.log(`[activate] ✅ Contract ${contractId} status updated: awaiting_funding → open`);

    return NextResponse.json({
      success: true,
      message: "Contract is now open for submissions",
      contract: data,
    });
  } catch (error) {
    console.error("[activate] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

