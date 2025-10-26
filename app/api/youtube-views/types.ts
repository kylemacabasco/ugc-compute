// YouTube API Response Types

export interface YouTubeThumbnail {
  url: string;
  width: number;
  height: number;
}

export interface YouTubeThumbnails {
  default: YouTubeThumbnail;
  medium: YouTubeThumbnail;
  high: YouTubeThumbnail;
  standard?: YouTubeThumbnail;
  maxres?: YouTubeThumbnail;
}

export interface YouTubeVideoSnippet {
  publishedAt: string;
  channelId: string;
  title: string;
  description: string;
  thumbnails: YouTubeThumbnails;
  channelTitle: string;
  tags?: string[];
  categoryId: string;
  liveBroadcastContent: string;
  localized: {
    title: string;
    description: string;
  };
}

export interface YouTubeVideoStatistics {
  viewCount: string;
  likeCount: string;
  dislikeCount?: string;
  favoriteCount: string;
  commentCount: string;
}

export interface YouTubeVideoItem {
  kind: string;
  etag: string;
  id: string;
  snippet: YouTubeVideoSnippet;
  statistics: YouTubeVideoStatistics;
}

export interface YouTubeVideoResponse {
  kind: string;
  etag: string;
  items: YouTubeVideoItem[];
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
}

// API Request/Response Types

export interface YouTubeViewsRequest {
  urls: string[];
}

export interface VideoViewResult {
  url: string;
  viewCount: number | null;
  success: boolean;
  error?: string;
  metadata?: {
    title: string;
    channelTitle: string;
    likes: number;
    comments: number;
    publishedAt: string;
    thumbnail: string;
  };
}

export interface YouTubeViewsResponse {
  results: VideoViewResult[];
  summary: {
    totalVideos: number;
    successful: number;
    failed: number;
    totalViews: number;
  };
}
