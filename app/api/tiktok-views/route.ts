import { NextRequest, NextResponse } from "next/server";
import type {
  TikTokViewsRequest,
  TikTokViewsResponse,
  VideoViewResult,
  PeekalinkResponse,
} from "./types";

const PEEKALINK_API_URL = "https://api.peekalink.io/";

async function fetchVideoData(
  url: string,
  apiKey: string
): Promise<PeekalinkResponse> {
  const response = await fetch(PEEKALINK_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ link: url }),
  });

  if (!response.ok) {
    throw new Error(`Peekalink API error: ${response.status}`);
  }

  return response.json();
}

async function processVideo(
  url: string,
  apiKey: string
): Promise<VideoViewResult> {
  try {
    const data = await fetchVideoData(url, apiKey);

    if (!data.ok || !data.tiktokVideo) {
      return {
        url,
        viewCount: null,
        success: false,
        error: "Invalid TikTok video",
      };
    }

    const { tiktokVideo } = data;
    return {
      url,
      viewCount: tiktokVideo.playsCount,
      success: true,
      metadata: {
        username: tiktokVideo.user.username,
        title: tiktokVideo.text,
        likes: tiktokVideo.likesCount,
        comments: tiktokVideo.commentsCount,
        shares: tiktokVideo.sharesCount,
        publishedAt: tiktokVideo.publishedAt,
      },
    };
  } catch (error) {
    return {
      url,
      viewCount: null,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.PEEKALINK_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Peekalink API key not configured" },
        { status: 500 }
      );
    }

    const body: TikTokViewsRequest = await request.json();

    if (!body.urls?.length || !Array.isArray(body.urls)) {
      return NextResponse.json(
        { error: "Invalid request: urls must be a non-empty array" },
        { status: 400 }
      );
    }

    const results = await Promise.allSettled(
      body.urls.map((url) => processVideo(url, apiKey))
    );

    const videoResults: VideoViewResult[] = results.map((result, index) => {
      if (result.status === "fulfilled") return result.value;

      return {
        url: body.urls[index],
        viewCount: null,
        success: false,
        error: result.reason?.message || "Processing failed",
      };
    });

    const successful = videoResults.filter((r) => r.success).length;
    const totalViews = videoResults.reduce(
      (sum, r) => sum + (r.viewCount || 0),
      0
    );

    const response: TikTokViewsResponse = {
      results: videoResults,
      summary: {
        totalVideos: videoResults.length,
        successful,
        failed: videoResults.length - successful,
        totalViews,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
