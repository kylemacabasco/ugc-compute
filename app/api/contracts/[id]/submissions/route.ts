import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface SubmissionRequest {
  video_url: string;
  creator_wallet: string;
  signature: string;
  message: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const contractId = params.id;
    const body: SubmissionRequest = await request.json();
    const { video_url, creator_wallet, signature, message } = body;

    // Validate required fields
    if (!video_url || !creator_wallet || !signature || !message) {
      return NextResponse.json(
        { error: "Video URL, wallet, signature, and message are required" },
        { status: 400 }
      );
    }

    // Verify wallet signature
    try {
      const publicKey = new PublicKey(creator_wallet);
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      
      const verified = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      );

      if (!verified) {
        return NextResponse.json(
          { error: "Invalid wallet signature" },
          { status: 401 }
        );
      }

      // Verify message contains contract ID and timestamp within 5 minutes
      if (!message.includes(contractId)) {
        return NextResponse.json(
          { error: "Signature does not match contract" },
          { status: 401 }
        );
      }

      const timestampMatch = message.match(/Timestamp: (\d+)/);
      if (timestampMatch) {
        const messageTimestamp = parseInt(timestampMatch[1]);
        const currentTime = Date.now();
        const fiveMinutes = 5 * 60 * 1000;
        
        if (Math.abs(currentTime - messageTimestamp) > fiveMinutes) {
          return NextResponse.json(
            { error: "Signature expired. Please try again." },
            { status: 401 }
          );
        }
      }
    } catch (verifyError) {
      console.error("Signature verification error:", verifyError);
      return NextResponse.json(
        { error: "Failed to verify wallet signature" },
        { status: 401 }
      );
    }

    // Get contract to check requirements
    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("*")
      .eq("id", contractId)
      .single();

    if (contractError || !contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }

    // Check if contract is open
    if (contract.status !== "open" && contract.status !== "awaiting_funding") {
      return NextResponse.json(
        { error: "Contract is not accepting submissions" },
        { status: 400 }
      );
    }

    // Get user by wallet
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", creator_wallet)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "User not found. Please connect your wallet first." },
        { status: 401 }
      );
    }

    // Check if user already has a pending or approved submission for this contract
    const { data: existingSubmission } = await supabase
      .from("submissions")
      .select("id, status")
      .eq("contract_id", contractId)
      .eq("creator_id", user.id)
      .in("status", ["pending", "approved"])
      .single();

    if (existingSubmission) {
      return NextResponse.json(
        {
          error: `You already have a ${existingSubmission.status} submission for this contract`,
        },
        { status: 400 }
      );
    }

    // Validate content with Gemini
    const requirements = contract.metadata?.requirements || contract.description;
    
    const validationResponse = await fetch(
      `${request.nextUrl.origin}/api/validate-contract`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: video_url,
          requirements,
        }),
      }
    );

    if (!validationResponse.ok) {
      return NextResponse.json(
        { error: "Failed to validate content" },
        { status: 500 }
      );
    }

    const validation = await validationResponse.json();

    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        valid: false,
        explanation: validation.explanation,
        message: "Content does not meet contract requirements",
      });
    }

    // Create submission
    const { data: submission, error: submissionError } = await supabase
      .from("submissions")
      .insert([
        {
          contract_id: contractId,
          creator_id: user.id,
          video_url,
          status: "approved", // Auto-approve if Gemini validates
          validation_result: validation.explanation,
          view_count: 0,
        },
      ])
      .select()
      .single();

    if (submissionError) {
      console.error("Error creating submission:", submissionError);
      return NextResponse.json(
        { error: "Failed to create submission" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      valid: true,
      submission,
      explanation: validation.explanation,
    });
  } catch (error) {
    console.error("Error in POST /api/contracts/[id]/submissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET submissions for a contract
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const contractId = params.id;

    const { data: submissions, error } = await supabase
      .from("submissions")
      .select(
        `
        *,
        creator:users!submissions_creator_id_fkey(wallet_address, username)
      `
      )
      .eq("contract_id", contractId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching submissions:", error);
      return NextResponse.json(
        { error: "Failed to fetch submissions" },
        { status: 500 }
      );
    }

    return NextResponse.json(submissions);
  } catch (error) {
    console.error("Error in GET /api/contracts/[id]/submissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

