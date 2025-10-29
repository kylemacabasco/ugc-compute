import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { verifyDeposit } from "@/lib/verify-deposit";

// POST /api/deposits - Record a deposit from the frontend
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const body = await request.json();

    const {
      tx_sig,
      contract_id,
      amount_sol,
      from_address,
      to_address,
      user_id,
    } = body;

    if (!tx_sig || !contract_id || !amount_sol) {
      return NextResponse.json(
        { error: "Missing required fields: tx_sig, contract_id, amount_sol" },
        { status: 400 }
      );
    }

    // SECURITY: Verify transaction on-chain before accepting
    const verification = await verifyDeposit(tx_sig);
    
    if (!verification.success) {
      return NextResponse.json(
        { error: "Transaction not found or not confirmed on-chain", details: verification.error },
        { status: 400 }
      );
    }

    // Record deposit with verified on-chain data
    const depositRecord = {
      tx_sig,
      contract_id,
      user_id: user_id || null,
      from_address: from_address || null,
      to_address: to_address || process.env.NEXT_PUBLIC_TREASURY_ADDRESS,
      amount_base_units: String(Math.floor(Number(amount_sol) * 1000000000)),
      decimals: 9,
      ui_amount: String(amount_sol),
      status: "finalized" as const,
      source: "rpc" as const, // Verified via RPC = secure
      slot: verification.slot, // Proof of on-chain verification
      block_time: verification.blockTime ? new Date(verification.blockTime * 1000).toISOString() : null,
      mint: null,
    };

    const { data, error } = await supabase
      .from("deposits")
      .upsert(depositRecord, {
        onConflict: "tx_sig,to_address,asset_key",
      })
      .select()
      .single();

    if (error) {
      console.error("[deposits] Error:", error);
      return NextResponse.json(
        { error: "Failed to record deposit", details: error.message },
        { status: 500 }
      );
    }

    console.log(`[deposits] Recorded: ${amount_sol} SOL for contract ${contract_id} (verified at slot ${verification.slot})`);

    return NextResponse.json({ success: true, deposit: data });
  } catch (error) {
    console.error("[deposits] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET /api/deposits - Retrieve deposits with optional filters
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const { searchParams } = new URL(request.url);

    const user_id = searchParams.get("user_id");
    const contract_id = searchParams.get("contract_id");
    const to_address = searchParams.get("to_address");
    const tx_sig = searchParams.get("tx_sig");
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");

    let query = supabase
      .from("deposits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (user_id) query = query.eq("user_id", user_id);
    if (contract_id) query = query.eq("contract_id", contract_id);
    if (to_address) query = query.eq("to_address", to_address);
    if (tx_sig) query = query.eq("tx_sig", tx_sig);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;

    if (error) {
      console.error("[deposits] Error fetching deposits:", error);
      return NextResponse.json(
        { error: "Failed to fetch deposits", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      deposits: data,
      count: data.length,
    });
  } catch (error) {
    console.error("[deposits] Error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
