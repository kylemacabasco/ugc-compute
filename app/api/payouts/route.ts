import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

// POST create and execute payouts for a contract (creator-only)
// Simplified approach: calculates amounts AND sends SOL in one step
// No multisig - direct transfer from treasury wallet
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const body = await request.json();
    const { contract_id, requester_wallet } = body;

    if (!contract_id) {
      return NextResponse.json({ error: "contract_id required" }, { status: 400 });
    }
    if (!requester_wallet) {
      return NextResponse.json({ error: "requester_wallet required" }, { status: 400 });
    }

    // Get contract and creator
    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("id, creator_id, rate_per_1k_views")
      .eq("id", contract_id)
      .maybeSingle();

    if (contractError || !contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    // Verify creator auth
    const { data: creator } = await supabase
      .from("users")
      .select("wallet_address")
      .eq("id", contract.creator_id)
      .maybeSingle();
    if (!creator || creator.wallet_address !== requester_wallet) {
      return NextResponse.json(
        { error: "Only contract creator can distribute payouts" },
        { status: 403 }
      );
    }

    // Server-side funding guard: finalized SOL deposits minus committed payouts
    const { data: dep } = await supabase
      .from("deposits")
      .select("ui_amount")
      .eq("contract_id", contract_id)
      .eq("status", "finalized")
      .eq("asset_key", "SOL");
    const funded = (dep || []).reduce((s, r: any) => s + Number(r.ui_amount || 0), 0);
    
    const { data: outs } = await supabase
      .from("payouts")
      .select("amount, status")
      .eq("contract_id", contract_id)
      .in("status", ["pending", "processing", "completed", "paid"]);
    const committed = (outs || []).reduce((s, r: any) => s + Number(r.amount || 0), 0);
    const available = funded - committed;

    // Aggregate earnings (pending amounts) or fallback to approved submissions
    const { data: pendingEarnings } = await supabase
      .from("earnings")
      .select("user_id, amount_earned")
      .eq("contract_id", contract_id)
      .eq("payout_status", "pending");

    const userTotals = new Map<string, number>();
    if (pendingEarnings && pendingEarnings.length > 0) {
      for (const row of pendingEarnings) {
        const prev = userTotals.get(row.user_id) || 0;
        userTotals.set(row.user_id, prev + Number(row.amount_earned || 0));
      }
    } else {
      // Fallback: derive from approved submissions
      const { data: approvedSubs, error: subsError } = await supabase
        .from("submissions")
        .select("id, user_id, earned_amount, view_count")
        .eq("contract_id", contract_id)
        .eq("status", "approved");

      if (subsError) {
        return NextResponse.json({ error: "Failed to fetch submissions" }, { status: 500 });
      }

      if (!approvedSubs || approvedSubs.length === 0) {
        return NextResponse.json({ 
          success: true, 
          payouts: [], 
          message: "No approved submissions or pending earnings" 
        });
      }

      for (const sub of approvedSubs) {
        const base = typeof sub.earned_amount === "number" && !isNaN(sub.earned_amount)
          ? sub.earned_amount
          : ((Number(sub.view_count || 0) / 1000) * Number(contract.rate_per_1k_views || 0));
        const prev = userTotals.get(sub.user_id) || 0;
        userTotals.set(sub.user_id, prev + base);
      }
    }

    // Build payout list
    const payoutList = Array.from(userTotals.entries())
      .map(([userId, amount]) => ({ userId, amount: Number(amount) }))
      .filter((row) => row.userId && row.amount > 0);

    if (payoutList.length === 0) {
      return NextResponse.json({ 
        success: true, 
        payouts: [], 
        message: "No earnings to distribute" 
      });
    }

    // Get user wallet addresses for transfers
    const { data: users } = await supabase
      .from("users")
      .select("id, wallet_address")
      .in("id", payoutList.map(p => p.userId));

    if (!users || users.length === 0) {
      return NextResponse.json({ error: "No valid users found for payout" }, { status: 500 });
    }

    const userWalletMap = new Map(users.map(u => [u.id, u.wallet_address]));

    // Initialize Solana connection
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Solana RPC URL not configured" }, { status: 500 });
    }
    const connection = new Connection(rpcUrl, "confirmed");

    // Load treasury keypair (stored securely in env)
    const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
    if (!treasuryPrivateKey) {
      return NextResponse.json({ error: "Treasury private key not configured" }, { status: 500 });
    }
    
    let treasuryKeypair: Keypair;
    try {
      const secretKey = Uint8Array.from(JSON.parse(treasuryPrivateKey));
      treasuryKeypair = Keypair.fromSecretKey(secretKey);
    } catch (e) {
      console.error("Failed to parse treasury private key:", e);
      return NextResponse.json({ error: "Invalid treasury configuration" }, { status: 500 });
    }

    // Execute transfers and create payout records
    const results = [];
    let successCount = 0;
    let failedCount = 0;

    for (const payout of payoutList) {
      const recipientWallet = userWalletMap.get(payout.userId);
      if (!recipientWallet) {
        results.push({ user_id: payout.userId, status: "failed", error: "Wallet not found" });
        failedCount++;
        continue;
      }

      try {
        // Convert SOL amount to lamports
        const lamports = Math.floor(payout.amount * 1e9);
        
        // Create transfer transaction
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: treasuryKeypair.publicKey,
            toPubkey: new PublicKey(recipientWallet),
            lamports,
          })
        );

        // Send and confirm transaction
        const signature = await sendAndConfirmTransaction(connection, transaction, [treasuryKeypair]);

        // Insert payout record in DB
        const { data: inserted, error: insertError } = await supabase
          .from("payouts")
          .insert({
            contract_id,
            user_id: payout.userId,
            amount: payout.amount,
            status: "completed",
            solana_transaction_signature: signature,
            processed_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (insertError) {
          // Check if duplicate (idempotency)
          if (insertError.code === "23505") {
            results.push({ 
              user_id: payout.userId, 
              status: "skipped", 
              message: "Already paid",
              signature 
            });
          } else {
            results.push({ 
              user_id: payout.userId, 
              status: "warning", 
              signature,
              message: "Transferred but DB insert failed" 
            });
          }
        } else {
          results.push({ 
            user_id: payout.userId, 
            amount: payout.amount,
            status: "completed", 
            signature,
            payout_id: inserted.id
          });
          successCount++;
        }

        // Mark earnings as paid
        if (pendingEarnings && pendingEarnings.length > 0) {
          await supabase
            .from("earnings")
            .update({ payout_status: "paid" })
            .eq("contract_id", contract_id)
            .eq("user_id", payout.userId)
            .eq("payout_status", "pending");
        }

      } catch (error: any) {
        console.error(`Transfer failed for user ${payout.userId}:`, error);
        results.push({ 
          user_id: payout.userId, 
          status: "failed", 
          error: error.message || "Transfer failed" 
        });
        failedCount++;
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Processed ${payoutList.length} payouts: ${successCount} succeeded, ${failedCount} failed`,
      results,
      summary: {
        total: payoutList.length,
        succeeded: successCount,
        failed: failedCount,
      }
    });

  } catch (error) {
    console.error("Error in POST /api/payouts:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

