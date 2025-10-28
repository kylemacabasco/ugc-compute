import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = id;

    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("rate_per_1k_views, creator_id")
      .eq("id", contractId)
      .single();

    if (contractError || !contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { updater_wallet } = body;

    if (updater_wallet) {
      const { data: creator } = await supabase
        .from("users")
        .select("wallet_address")
        .eq("id", contract.creator_id)
        .single();

      if (creator?.wallet_address !== updater_wallet) {
        return NextResponse.json(
          { error: "Only contract creator can update views" },
          { status: 403 }
        );
      }
    }

    const { data: submissions, error: submissionsError } = await supabase
      .from("submissions")
      .select("id, video_url, view_count, platform, user_id")
      .eq("contract_id", contractId)
      .eq("status", "approved")
      .eq("platform", "youtube");

    if (submissionsError) {
      console.error("Error fetching submissions:", submissionsError);
      return NextResponse.json(
        { error: "Failed to fetch submissions" },
        { status: 500 }
      );
    }

    if (!submissions || submissions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No approved submissions to update",
        updated: 0,
      });
    }

    const urls = submissions.map((s: any) => s.video_url);

    const youtubeResponse = await fetch(
      `${request.nextUrl.origin}/api/youtube-views`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      }
    );

    if (!youtubeResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch view counts" },
        { status: 500 }
      );
    }

    const viewsData = await youtubeResponse.json();

    if (!viewsData.results || !Array.isArray(viewsData.results)) {
      console.error("Invalid YouTube API response:", viewsData);
      return NextResponse.json(
        { error: "Invalid response from YouTube API" },
        { status: 500 }
      );
    }

    let updatedCount = 0;
    let failedCount = 0;

    for (const result of viewsData.results) {
      const submission = submissions.find(
        (s: any) => s.video_url === result.url
      );

      if (submission && result.viewCount !== null && result.viewCount !== undefined) {
        const newViewCount = result.viewCount;
        const oldViewCount = submission.view_count || 0;

        if (newViewCount !== oldViewCount) {
          const { error: updateError } = await supabase
            .from("submissions")
            .update({ view_count: newViewCount })
            .eq("id", submission.id);

          if (updateError) {
            console.error(
              `Failed to update submission ${submission.id}:`,
              updateError
            );
            failedCount++;
          } else {
            const totalEarnedAmount = (newViewCount / 1000) * contract.rate_per_1k_views;
            const newViews = newViewCount - oldViewCount;
            const incrementalEarned = (newViews / 1000) * contract.rate_per_1k_views;

            const { error: updateSubmissionError } = await supabase
              .from("submissions")
              .update({ earned_amount: totalEarnedAmount })
              .eq("id", submission.id);

            if (updateSubmissionError) {
              console.error(
                `Failed to update submission earned_amount ${submission.id}:`,
                updateSubmissionError
              );
            }

            if (incrementalEarned > 0) {
              const { error: earningsError } = await supabase
                .from("earnings")
                .insert({
                  contract_id: contractId,
                  user_id: submission.user_id,
                  submission_id: submission.id,
                  amount_earned: incrementalEarned,
                  payout_status: "pending",
                });

              if (earningsError) {
                console.error(
                  `Failed to create earnings for submission ${submission.id}:`,
                  earningsError
                );
              }
            }

            updatedCount++;
          }
        }
      } else {
        failedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updatedCount} submissions`,
      updated: updatedCount,
      failed: failedCount,
    });
  } catch (error) {
    console.error("Error in POST /api/contracts/[id]/update-views:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return POST(request, context);
}
