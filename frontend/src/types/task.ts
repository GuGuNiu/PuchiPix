import type { GalleryDownloadInfoData } from "./gallery";
import type { ProgressMessage } from "./common";

export type TaskStatus =
  | 'pending'
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
  /** Completed segments count (from download_tasks.completed_segments) */
  Segment?: number;
  /** Total segments count (from download_tasks.total_segments) */
  TotalSegments?: number;
  /** File size in bytes (from video_infos.file_size via LEFT JOIN) */
  FileSize?: number;
  /**
   * Live downloaded bytes during video download — sum of completed
   * segment file sizes (260809). Shows a partial size in the size
   * column instead of "—" until the MP4 merge sets FileSize.
   */
  DownloadedBytes?: number;
  /**
   * Live downloaded bytes during gallery download — accumulated size of
   * completed images (260809). Shows a partial size in real-time.
   */
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
  GalleryProgressInfo?: { completed: number; total: number; failed: number };
  GalleryZipProgressInfo?: { downloaded: number; total: number; percent: number };
  GalleryZipStatus?: string;
  /** Backend-computed effective status for filtering (replaces frontend getEffectiveFilterStatus) */
  EffectiveStatus?: TaskStatus;
  /** Backend-computed progress stage key for i18n (replaces frontend getProgressStage threshold logic) */
  ProgressStage?: string;
  /** Backend-computed allowed actions for this task (replaces frontend batch operation qualification checks) */
  AllowedActions?: string[];
}

export interface M3U8Candidate {
  url: string;
  title: string;
}
