import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createContractTreasury } from "@/lib/treasury";

// GET all contracts
export async function GET() {
  try {
    const { data: contracts, error } = await supabase
      .from("contracts")
      .select(
        `
        *,
        creator:users!creator_id(wallet_address),
        submissions (
          id,
          view_count,
          status
        )
      `
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching contracts:", error);
      return NextResponse.json(
        { error: "Failed to fetch contracts" },
        { status: 500 }
      );
    }

    // Calculate progress based on submissions' view counts
    const contractsWithProgress = contracts?.map((contract: any) => {
      const approvedSubmissions =
        contract.submissions?.filter(
          (submission: any) => submission.status === "approved"
        ) || [];

      const totalViews = approvedSubmissions.reduce(
        (sum: number, submission: any) => sum + (submission.view_count || 0),
        0
      );

      // Calculate how much has been earned: (totalViews / 1000) * ratePer1kViews
      const earnedAmount = (totalViews / 1000) * contract.rate_per_1k_views;

      // Cap at contract amount
      const cappedEarned = Math.min(earnedAmount, contract.contract_amount);

      // Calculate progress percentage
      const progressPercentage = contract.contract_amount > 0
        ? Math.min((earnedAmount / contract.contract_amount) * 100, 100)
        : 0;

      return {
        ...contract,
        calculated_earned: cappedEarned,
        progress_percentage: progressPercentage,
        total_submission_views: totalViews,
        is_completed: earnedAmount >= contract.contract_amount,
      };
    });

    return NextResponse.json(contractsWithProgress);
  } catch (error) {
    console.error("Error in GET /api/contracts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// POST create a new contract
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      contractAmount,
      ratePer1kViews,
      creatorWallet,
      requirements,
    } = body;

    // Validate required fields
    if (
      !title ||
      !description ||
      contractAmount === undefined ||
      ratePer1kViews === undefined ||
      !creatorWallet
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate positive numbers
    if (contractAmount <= 0 || ratePer1kViews <= 0) {
      return NextResponse.json(
        { error: "Contract amount and rate must be positive numbers" },
        { status: 400 }
      );
    }

    // Get user by wallet address
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", creatorWallet)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not found. Please connect your wallet first." },
        { status: 401 }
      );
    }

    // Insert contract into database
    const { data, error } = await supabase
      .from("contracts")
      .insert([
        {
          title,
          description,
          contract_amount: contractAmount,
          rate_per_1k_views: ratePer1kViews,
          creator_id: user.id,
          status: "awaiting_funding",
          metadata: requirements ? { requirements } : {},
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Error creating contract:", error);
      return NextResponse.json(
        { error: "Failed to create contract" },
        { status: 500 }
      );
    }

    // Generate treasury wallet and contract slug (if columns exist)
    try {
      const { treasuryWallet, contractSlug } = await createContractTreasury(
        data.id,
        user.id
      );

      // Return contract with treasury info
      return NextResponse.json(
        {
          ...data,
          treasury_wallet_address: treasuryWallet.address,
          contract_slug: contractSlug,
        },
        { status: 201 }
      );
    } catch (treasuryError) {
      console.error("Error creating treasury:", treasuryError);
      // Contract was created but treasury failed - return contract anyway
      return NextResponse.json(
        {
          ...data,
          warning: "Contract created but treasury setup failed - please apply migration 005",
        },
        { status: 201 }
      );
    }
  } catch (error) {
    console.error("Error in POST /api/contracts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
