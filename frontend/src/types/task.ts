import type { GalleryDownloadInfoData } from "./gallery";
import type { ProgressMessage } from "./common";

export type TaskStatus =
  | 'pending'
  | 'preparing'
  | 'scrape_pending'
  | 'scraping'
  | 'download_pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'transcoding';

export interface VideoInfo {
  ID: number;
  TaskID: number;
  Title: string;
  SourceURL: string;
  FileSize: number;
  Duration: number;
  Tags: string[];
  Actors: string[];
  Categories: string[];
  Director: string;
  Resolution: string;
  CreatedAt: string;
}

export type TaskType = 'video' | 'gallery' | 'sniff';

export interface DownloadTask {
  ID: number;
  DisplayID?: string;
  URL: string;
  M3U8URL: string;
  Status: TaskStatus;
  Progress: number;
  FilePath: string;
  Format: string;
  Priority: number;
  ErrorMsg: string;
  CreatedAt: string;
  UpdatedAt: string;
  SiteID?: string;
  VideoInfo?: VideoInfo;
  Segment?: number;
  TotalSegments?: number;
  FileSize?: number;
  DownloadedBytes?: number;
  DownloadedSize?: number;
  TaskType?: TaskType;
  GalleryTitle?: string;
  ImageCount?: number;
  VideoCount?: number;
  DownloadMethod?: string;
  GalleryTotalSize?: number;
  DownloadInfo?: GalleryDownloadInfoData;
  M3U8Candidates?: M3U8Candidate[];
  SniffTotalFound?: number;
  SniffTotalCreated?: number;
  SniffTotalSkipped?: number;
  Person?: string;
  /** Scraped tags from video_infos.tags (video pipeline tasks). */
  Tags?: string[];
  /** Scraped actors from video_infos.actors (video pipeline tasks). */
  Actors?: string[];
  GalleryProgressInfo?: { completed: number; total: number; failed: number };
  GalleryZipProgressInfo?: { downloaded: number; total: number; percent: number };
  GalleryZipStatus?: string;
  EffectiveStatus?: TaskStatus;
  ProgressStage?: string;
  AllowedActions?: string[];
}

export interface M3U8Candidate {
  url: string;
  title: string;
}
