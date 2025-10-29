import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";

// POST activate a contract (change status from inactive to active)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabaseServiceClient();
    const { id: contractId } = await params;

    console.log(`[activate] Activating contract ${contractId}`);

    // Update contract status to active
    const { data, error } = await supabase
      .from("contracts")
      .update({ status: "active" })
      .eq("id", contractId)
      .select()
      .single();

    if (error) {
      console.error("Error activating contract:", error);
      return NextResponse.json(
        { error: "Failed to activate contract" },
        { status: 500 }
      );
    }

    console.log(`[activate] ✅ Contract ${contractId} activated successfully`);

    return NextResponse.json({
      success: true,
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

