import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { Connection, PublicKey } from "@solana/web3.js";

const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SOL_DECIMALS = 9;

// POST record a deposit after transaction is confirmed
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createSupabaseServiceClient();
    const { id: contractId } = await params;
    const body = await request.json();
    const { signature, refCode } = body;

    console.log(`[record-deposit] Starting for contract ${contractId}, signature: ${signature}, refCode: ${refCode}`);

    if (!signature || !refCode) {
      console.error("[record-deposit] Missing signature or refCode");
      return NextResponse.json(
        { error: "Missing signature or refCode" },
        { status: 400 }
      );
    }

    // Get contract details
    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("id, contract_amount, creator_id")
      .eq("id", contractId)
      .single();

    if (contractError || !contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }

    // Verify the ref code belongs to this contract
    const { data: refData, error: refError } = await supabase
      .from("contract_refs")
      .select("contract_id, user_id, status")
      .eq("ref_code", refCode)
      .eq("contract_id", contractId)
      .eq("status", "active")
      .maybeSingle();

    if (refError || !refData) {
      return NextResponse.json(
        { error: "Invalid reference code" },
        { status: 400 }
      );
    }

    // Connect to Solana and fetch transaction
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
    const connection = new Connection(rpcUrl, "confirmed");

    console.log(`[record-deposit] Fetching transaction from Solana...`);
    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!tx || !tx.meta) {
      console.error(`[record-deposit] Transaction not found: ${signature}`);
      return NextResponse.json(
        { error: "Transaction not found or not confirmed yet. Please wait a moment and try again." },
        { status: 400 }
      );
    }
    
    console.log(`[record-deposit] Transaction found, slot: ${tx.slot}`);

    // Verify the transaction sent SOL to the treasury
    const treasuryAddress = process.env.NEXT_PUBLIC_TREASURY_ADDRESS;
    if (!treasuryAddress) {
      return NextResponse.json(
        { error: "Treasury address not configured" },
        { status: 500 }
      );
    }

    const treasuryPubkey = new PublicKey(treasuryAddress);
    
    // Get account keys
    const msg: any = tx.transaction.message;
    const keys: PublicKey[] =
      (msg.staticAccountKeys as PublicKey[]) ??
      msg.getAccountKeys?.({ accountKeysFromLookups: tx.meta.loadedAddresses })?.staticAccountKeys ??
      msg.getAccountKeys?.().staticAccountKeys ??
      [];

    // Calculate SOL received by treasury
    const pre = tx.meta.preBalances || [];
    const post = tx.meta.postBalances || [];
    let amountReceived = 0;

    keys.forEach((k, i) => {
      if (k.equals(treasuryPubkey)) {
        const delta = BigInt(post[i] ?? 0) - BigInt(pre[i] ?? 0);
        if (delta > 0n) {
          amountReceived = Number(delta) / Math.pow(10, SOL_DECIMALS);
        }
      }
    });

    console.log(`[record-deposit] Amount received by treasury: ${amountReceived} SOL`);
    
    if (amountReceived === 0) {
      console.error(`[record-deposit] No SOL transfer found to treasury ${treasuryAddress}`);
      return NextResponse.json(
        { error: "No SOL transfer to treasury found in transaction" },
        { status: 400 }
      );
    }

    // Verify the memo contains the ref code
    let memoFound = false;
    try {
      const ixs: any[] = msg.compiledInstructions ?? msg.instructions ?? [];
      const keyStrings = keys.map(k => k.toBase58());
      
      for (const ix of ixs) {
        const pidIdx = typeof ix.programIdIndex === "number" ? ix.programIdIndex : undefined;
        const pid = pidIdx != null ? keyStrings[pidIdx] : undefined;
        
        if (pid === MEMO_PROGRAM_ID && ix.data) {
          const memo = Buffer.from(ix.data, "base64").toString("utf8");
          if (memo.includes(`ref:${refCode}`)) {
            memoFound = true;
            break;
          }
        }
      }
    } catch (error) {
      console.error("Error parsing memo:", error);
    }

    console.log(`[record-deposit] Memo found: ${memoFound}`);
    
    if (!memoFound) {
      console.error(`[record-deposit] Reference code ${refCode} not found in transaction memo`);
      return NextResponse.json(
        { error: "Reference code not found in transaction memo. Please ensure you used the correct reference code." },
        { status: 400 }
      );
    }

    // Record the deposit
    const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString();
    
    const depositRow = {
      user_id: refData.user_id,
      contract_id: contractId,
      reference_code: refCode,
      to_address: treasuryAddress,
      from_address: null, // Could extract from transaction if needed
      tx_sig: signature,
      slot: tx.slot,
      block_time: blockTime,
      mint: null, // SOL
      amount_base_units: (amountReceived * Math.pow(10, SOL_DECIMALS)).toString(),
      decimals: SOL_DECIMALS,
      ui_amount: amountReceived.toString(),
      status: "confirmed",
      source: "rpc", // Changed from "api" to match database constraint
      memo: refCode,
    };

    const { error: depositError } = await supabase
      .from("deposits")
      .upsert(depositRow, { onConflict: "tx_sig,to_address,asset_key" });

    if (depositError) {
      console.error("Error recording deposit:", depositError);
      return NextResponse.json(
        { error: "Failed to record deposit" },
        { status: 500 }
      );
    }

    // Mark ref as used
    await supabase
      .from("contract_refs")
      .update({ status: "used" })
      .eq("ref_code", refCode)
      .eq("status", "active");

    return NextResponse.json({
      success: true,
      message: "Deposit recorded",
      amountReceived,
    });
  } catch (error) {
    console.error("[record-deposit] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

