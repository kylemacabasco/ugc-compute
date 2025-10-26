import { NextRequest, NextResponse } from "next/server";
import type {
  YouTubeViewsRequest,
  YouTubeViewsResponse,
  VideoViewResult,
  YouTubeVideoResponse,
} from "./types";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/videos";

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

async function fetchVideoData(
  videoId: string,
  apiKey: string
): Promise<YouTubeVideoResponse> {
  const url = `${YOUTUBE_API_URL}?id=${videoId}&part=snippet,statistics&key=${apiKey}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status}`);
  }

  return response.json();
}

async function processVideo(
  url: string,
  apiKey: string
): Promise<VideoViewResult> {
  try {
    const videoId = extractVideoId(url);

    if (!videoId) {
      return {
        url,
        viewCount: null,
        success: false,
        error: "Invalid YouTube URL",
      };
    }

    const data = await fetchVideoData(videoId, apiKey);

    if (!data.items?.length) {
      return {
        url,
        viewCount: null,
        success: false,
        error: "Video not found",
      };
    }

    const video = data.items[0];
    const stats = video.statistics;
    const snippet = video.snippet;

    const result = {
      url,
      viewCount: stats.viewCount ? parseInt(stats.viewCount, 10) : 0,
      success: true,
      metadata: {
        title: snippet.title,
        channelTitle: snippet.channelTitle,
        likes: stats.likeCount ? parseInt(stats.likeCount, 10) : 0,
        comments: stats.commentCount ? parseInt(stats.commentCount, 10) : 0,
        publishedAt: snippet.publishedAt,
        thumbnail:
          snippet.thumbnails.high?.url ||
          snippet.thumbnails.medium?.url ||
          snippet.thumbnails.default?.url,
      },
    };

    return result;
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
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "YouTube API key not configured" },
        { status: 500 }
      );
    }

    const body: YouTubeViewsRequest = await request.json();

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

    const response: YouTubeViewsResponse = {
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

export async function GET() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "API key not configured" },
      { status: 500 }
    );
  }

  const testUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const result = await processVideo(testUrl, apiKey);

  return NextResponse.json({ success: true, testResult: result });
}
