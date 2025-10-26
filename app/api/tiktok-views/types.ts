// Peekalink API Response Types

export interface PeekalinkImage {
  thumbnail: ImageSize;
  medium: ImageSize;
  large: ImageSize;
  original: ImageSize;
}

export interface ImageSize {
  width: number;
  height: number;
  url: string;
}

export interface TikTokUser {
  id: number;
  username: string;
  verified: boolean;
  name: string;
  bio: string;
  url: string;
  followersCount: number;
  followingCount: number;
  likesCount: number;
  visibility: string;
  avatar: PeekalinkImage;
}

export interface TikTokMedia {
  width: number;
  height: number;
  size: number;
  format: string;
  hasAlphaChannel: boolean;
  thumbnail: ImageSize;
  medium: ImageSize;
  large: ImageSize;
  original: ImageSize;
}

export interface TikTokVideoData {
  id: number;
  publishedAt: string;
  likesCount: number;
  commentsCount: number;
  playsCount: number; // This is the view count
  sharesCount: number;
  text: string;
  user: TikTokUser;
  media: TikTokMedia[];
}

export interface PeekalinkResponse {
  id: number;
  ok: boolean;
  url: string;
  domain: string;
  type: string;
  status: number;
  updatedAt: string;
  size: number;
  redirected: boolean;
  title: string;
  description: string;
  image: PeekalinkImage;
  tiktokVideo: TikTokVideoData;
  requestId: string;
}

// API Request/Response Types

export interface TikTokViewsRequest {
  urls: string[];
}

export interface VideoViewResult {
  url: string;
  viewCount: number | null;
  success: boolean;
  error?: string;
  metadata?: {
    username: string;
    title: string;
    likes: number;
    comments: number;
    shares: number;
    publishedAt: string;
  };
}

export interface TikTokViewsResponse {
  results: VideoViewResult[];
  summary: {
    totalVideos: number;
    successful: number;
    failed: number;
    totalViews: number;
  };
}
