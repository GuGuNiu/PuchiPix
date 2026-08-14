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

export interface ProgressMessage {
  type: string;
  task_id: number;
  progress: number;
  speed?: string;
  segment: number;
  total: number;
  status: string;
}

export interface Stats {
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  downloading_tasks: number;
  total_size: number;
  total_size_str: string;
  avg_speed: number;
  avg_speed_str: string;
  current_speed: number;
  current_speed_str: string;
  speed_rating: number;
}

export interface GalleryDownloadInfoData {
  ID: number;
  GalleryID: number;
  Title: string;
  FileCount: number;
  FileSizeText: string;
  ImageDimensions: string;
  Password: string;
  DownloadURL: string;
  DownloadSource: string;
  OuoURL: string;
  ResolvedDirectURL: string;
  Provider: string;
  RequiresLogin: boolean;
  RequiresEmail: boolean;
  Status: string;
  LocalPath: string;
  ExtractedPath: string;
  ActualSize: number;
  ZipFileName: string;
  Parallelism: number;
  AvgSpeed: number;
  VerifiedCount: number;
  CountMatched: boolean;
}

export interface GalleryData {
  ID: number;
  Seq?: string;
  SourceURL: string;
  SiteID: string;
  ScrapedDomain: string;
  Title: string;
  Protagonist: string;
  Description: string;
  Category: string;
  Tags: string[];
  CoverURL: string;
  CoverLocalPath: string;
  PublishTime?: string;
  ImageCount: number;
  VideoCount: number;
  PageCount: number;
  Status: string;
  DownloadMethod: string;
  ExpectedImageCount: number;
  ExpectedVideoCount: number;
  ContentVerified: boolean;
  SavePath: string;
  TotalSize: number;
  DownloadedSize: number;
  CreatedAt: string;
  UpdatedAt: string;
  Images?: GalleryImageData[];
  Videos?: GalleryVideoData[];
  DownloadInfo?: GalleryDownloadInfoData;
  GameCharacters?: string[];
}

export interface GalleryImageData {
  ID: number;
  GalleryID: number;
  URL: string;
  LocalPath: string;
  FileName: string;
  PageIndex: number;
  OrderIndex: number;
  Status: string;
}

export interface GalleryVideoData {
  ID: number;
  GalleryID: number;
  URL: string;
  LocalPath: string;
  FileName: string;
  Status: string;
  /** Bytes of the downloaded MP4 (0 when not yet downloaded). */
  FileSize?: number;
  /** Duration in minutes (probed from the MP4 after download). */
  Duration?: number;
  /** Resolution string, e.g. "1920x1080". */
  Resolution?: string;
  Format?: string;
  ErrorMsg?: string;
}

export interface SearchItem {
  pageUrl: string;
  title: string;
  coverUrl?: string;
  date?: string;
  m3u8Url?: string;
  taskId?: number;
  status: 'pending' | 'scraping' | 'downloaded' | 'failed';
  /** Error info */
  error?: string;
  /** Retry count */
  retries: number;
}

export interface BatchTitleResult {
  title: string;
  /** HandleState */
  status:
    | 'pending'
    | 'searching'
    | 'found'
    | 'scraping'
    | 'completed'
    | 'not_found'
    | 'failed';
  searchResults: SearchItem[];
  selectedItem?: SearchItem;
  /** Create Downloadtask ID */
  taskId?: number;
  /** Error info */
  error?: string;
  /** Retry count */
  retries: number;
  matchScore?: number;
}

export interface SearchLogEntry {
  time: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface BatchSearchJob {
  id: string;
  rawTitles: string;
  titles: string[];
  /** Search site ID */
  siteId: string;
  /** TaskState */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Eachtitle Handleresult */
  results: BatchTitleResult[];
  createdAt: string;
  completedAt?: string;
  /** Handleamount */
  totalProcessed: number;
  /** SuccessDownload amount */
  totalDownloaded: number;
  totalNotFound: number;
  /** HandleFail amount */
  totalFailed: number;
  /** CurrentcurrentlyHandle titleIndex */
  currentIndex: number;
  /** Log */
  logs: SearchLogEntry[];
}
