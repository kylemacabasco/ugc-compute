import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";

// DELETE a contract (only if awaiting_funding and user is creator)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabaseServiceClient();
    const { id: contractId } = await params;

    // Get user info from request (you might need to adjust this based on your auth setup)
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: "User ID required" },
        { status: 401 }
      );
    }

    // Get contract to verify status and ownership
    const { data: contract, error: fetchError } = await supabase
      .from("contracts")
      .select("id, status, creator_id")
      .eq("id", contractId)
      .single();

    if (fetchError || !contract) {
      console.error("Error fetching contract:", fetchError);
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }

    // Verify user is the creator
    if (contract.creator_id !== userId) {
      return NextResponse.json(
        { error: "Only the contract creator can delete this contract" },
        { status: 403 }
      );
    }

    // Only allow deletion if contract is awaiting_funding
    if (contract.status !== "awaiting_funding") {
      return NextResponse.json(
        { error: `Cannot delete contract with status: ${contract.status}. Only contracts awaiting funding can be deleted.` },
        { status: 400 }
      );
    }

    // Delete the contract
    const { error: deleteError } = await supabase
      .from("contracts")
      .delete()
      .eq("id", contractId)
      .eq("creator_id", userId)
      .eq("status", "awaiting_funding");

    if (deleteError) {
      console.error("Error deleting contract:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete contract" },
        { status: 500 }
      );
    }

    console.log(`[delete] ✅ Contract ${contractId} deleted by user ${userId}`);

    return NextResponse.json({
      success: true,
      message: "Contract deleted successfully",
    });
  } catch (error) {
    console.error("[delete] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

