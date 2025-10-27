import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// update-youtube-views endpoint
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = id;

    const { data: contract, error: contractError } = await supabase
      .from("contracts")
      .select("rate_per_1k_views")
      .eq("id", contractId)
      .single();

    if (contractError || !contract) {
      return NextResponse.json(
        { error: "Contract not found" },
        { status: 404 }
      );
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

    let updatedCount = 0;
    let failedCount = 0;

    for (const result of viewsData) {
      const submission = submissions.find(
        (s: any) => s.video_url === result.url
      );

      if (submission && result.views !== null && result.views !== undefined) {
        const newViewCount = result.views;
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
            const newViews = newViewCount - oldViewCount;
            const earnedAmount = (newViews / 1000) * contract.rate_per_1k_views;

            if (earnedAmount > 0) {
              await supabase.from("earnings").insert({
                contract_id: contractId,
                user_id: submission.user_id,
                submission_id: submission.id,
                amount_earned: earnedAmount,
                payout_status: "pending",
              });
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
