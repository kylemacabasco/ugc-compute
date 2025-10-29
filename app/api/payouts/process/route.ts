import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Payouts Processor (Dry-Run)
 * - This endpoint simulates processing payouts without executing on-chain transfers.
 * - It updates payout rows as if completed, writing a placeholder signature and timestamps.
 * - Use cases: end-to-end flow testing, UI wiring, and database field population.
 *
 * Future (real Squads integration):
 * - Create Squads multisig transfer proposals from a vault (SQUADS_VAULT_ADDRESS).
 * - Require member approvals, then execute and capture the confirmed signature.
 * - Persist proposal identifiers and transition payout status on confirmations/failures.
 * - Env inputs needed: SQUADS_VAULT_ADDRESS, SOLANA_RPC_URL, and an authenticated signer strategy.
 */

type Mode = "all" | "one";

// Processes payouts in DRY-RUN mode (no-chain). Replace with Squads integration later.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { contract_id, mode, payout_id, operator_wallet, dry_run } = body as {
      contract_id?: string;
      mode?: Mode;
      payout_id?: string;
      operator_wallet?: string;
      dry_run?: boolean;
    };

    const useDryRun = Boolean(dry_run ?? true);

    // Select pending payouts by contract or single payout
    let query = supabase.from("payouts").select("id, contract_id, user_id, amount, status, solana_transaction_signature").eq("status", "pending");
    if (contract_id) query = query.eq("contract_id", contract_id);
    if ((mode || "all") === "one" && payout_id) query = query.eq("id", payout_id);

    const { data: payouts, error } = await query;
    if (error) return NextResponse.json({ error: "Failed to load payouts" }, { status: 500 });
    if (!payouts || payouts.length === 0) return NextResponse.json({ success: true, processed: [], message: "No pending payouts" });

    // NOTE: Simulate successful completion in DRY-RUN mode.
    // Replace this block with real Squads proposal creation and execution tracking.
    const now = new Date().toISOString();
    const results: Array<{ id: string; status: string; signature?: string }> = [];

    if (useDryRun) {
      for (const p of payouts) {
        results.push({ id: p.id, status: "completed", signature: "dry-run-signature" });
      }
    } else {
      // Placeholder branch for future real chain interaction (non-dry-run path)
      for (const p of payouts) {
        results.push({ id: p.id, status: "failed" });
      }
    }

    // Persist updates
    for (const r of results) {
      const updates: Record<string, any> = { status: r.status };
      if (r.signature) updates["solana_transaction_signature"] = r.signature;
      updates["processed_at"] = now;
      if (operator_wallet) {
        const { data: op } = await supabase.from("users").select("id").eq("wallet_address", operator_wallet).maybeSingle();
        if (op?.id) updates["processed_by"] = op.id;
      }
      await supabase.from("payouts").update(updates).eq("id", r.id);
    }

    return NextResponse.json({ success: true, processed: results, dry_run: useDryRun });
  } catch (e) {
    console.error("Error in POST /api/payouts/process:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}


