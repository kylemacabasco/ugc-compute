import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase";
import { randomBytes } from "crypto";

// Generate a unique reference code
function generateRefCode(): string {
  return randomBytes(8).toString("base64url");
}

// POST generate a reference code for a contract
export async function POST(request: NextRequest) {
  try {
    const supabase = createSupabaseServiceClient();
    const body = await request.json();
    const { contractId, userId, expiresInDays = 7 } = body;

    // Validate required fields
    if (!contractId || !userId) {
      return NextResponse.json(
        { error: "Missing contractId or userId" },
        { status: 400 }
      );
    }

    // Check if there's already an active ref for this user+contract
    const { data: existingRefs, error: existingError } = await supabase
      .from("contract_refs")
      .select("ref_code, expires_at, status")
      .eq("contract_id", contractId)
      .eq("user_id", userId)
      .eq("status", "active");

    if (existingError) {
      console.error("Error checking existing ref:", existingError);
      return NextResponse.json(
        { error: "Failed to check existing reference" },
        { status: 500 }
      );
    }

    // If active ref(s) exist, handle them
    if (existingRefs && existingRefs.length > 0) {
      // Get the first active ref
      const existingRef = existingRefs[0];
      const expiresAt = existingRef.expires_at
        ? new Date(existingRef.expires_at)
        : null;
      
      // If not expired, return it
      if (!expiresAt || expiresAt > new Date()) {
        return NextResponse.json({
          ref_code: existingRef.ref_code,
          expires_at: existingRef.expires_at,
        });
      }
      
      // Mark all expired active refs as expired before creating a new one
      await supabase
        .from("contract_refs")
        .update({ status: "expired" })
        .eq("contract_id", contractId)
        .eq("user_id", userId)
        .eq("status", "active");
    }

    // Generate a new unique reference code
    let refCode = generateRefCode();
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      // Check if ref code already exists
      const { data: existing } = await supabase
        .from("contract_refs")
        .select("ref_code")
        .eq("ref_code", refCode)
        .maybeSingle();

      if (!existing) break;

      refCode = generateRefCode();
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return NextResponse.json(
        { error: "Failed to generate unique reference code" },
        { status: 500 }
      );
    }

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    // Insert the new reference code
    const { data, error } = await supabase
      .from("contract_refs")
      .insert([
        {
          ref_code: refCode,
          contract_id: contractId,
          user_id: userId,
          status: "active",
          expires_at: expiresAt.toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      // If duplicate key error (race condition), fetch and return the existing ref
      if (error.code === "23505") {
        console.log("Duplicate ref detected, returning existing ref for contract:", contractId);
        const { data: existingRef } = await supabase
          .from("contract_refs")
          .select("ref_code, expires_at")
          .eq("contract_id", contractId)
          .eq("user_id", userId)
          .eq("status", "active")
          .single();
        
        if (existingRef) {
          return NextResponse.json(existingRef, { status: 200 });
        }
      }
      
      // Only log as error if it's not a handled duplicate key error
      console.error("Error creating reference code:", error);
      return NextResponse.json(
        { error: "Failed to create reference code" },
        { status: 500 }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error in POST /api/contracts/generate-ref:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

