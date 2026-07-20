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
  VideoInfo?: VideoInfo;
  Segment?: number;
  TotalSegments?: number;
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
}


export interface M3U8Candidate {
  url: string;
  title: string;
}

export interface ScrapeResult {
  m3u8_url: string;
  m3u8_candidates?: M3U8Candidate[];
  title: string;
  page_url: string;
  tags: string[];
  actors: string[];
  categories: string[];
  director: string;
}

export interface CapturedURL {
  url: string;
  type: string;
  timestamp: string;
  page_url: string;
  filename: string;
  tags?: string[];
  actors?: string[];
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

export interface GalleryImageItem {
  url: string;
  pageIndex: number;
  orderIndex: number;
}

export interface GalleryVideoItem {
  url: string;
}

export interface GalleryZipInfo {
  title: string;
  fileCount: number;
  fileSizeText: string;
  imageDimensions: string;
  password: string;
  downloadUrl: string;
  provider: string;
  requiresLogin: boolean;
  requiresEmail: boolean;
  downloadSource?: string;
  ouoUrl?: string;
  _pageId?: string;
  _eligibilityUrl?: string;
  /** DownloadCompleteafter Jump URL */
  _nextUrl?: string;
  /** Temporarydebugfield */
  _dbg?: unknown;
}

export interface GalleryScrapeResult {
  sourceUrl: string;
  title: string;
  protagonist: string;
  description: string;
  category: string;
  tags: string[];
  coverUrl: string;
  publishTime?: string;
  images: GalleryImageItem[];
  videos: GalleryVideoItem[];
  pageCount: number;
  imageCount: number;
  videoCount: number;
  scrapedDomain?: string;
  zipInfo?: GalleryZipInfo;
  gameCharacters?: string[];
  needsPurchase?: boolean;
  downloadLinks?: string[];
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
}

export interface SystemStatus {
  memory: {
    alloc_mb: number;
    sys_mb: number;
    total_mb: number;
    gc_count: number;
  };
  goroutines?: number;
  uptime: number;
  timestamp: string;
}

export interface SniffStatus {
  running: boolean;
  target_url: string;
  captured: number;
  start_time: string;
}

export type AppConfig = Record<string, string>;

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

export interface KeywordResult {
  keyword: string;
  /** SearchState */
  status: 'pending' | 'searching' | 'completed' | 'failed';
  items: SearchItem[];
  /** Error info */
  error?: string;
  /** Retry count */
  retries: number;
}

export interface SearchJob {
  id: string;
  rawKeywords: string;
  keywords: string[];
  siteId: string;
  /** TaskState */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  results: KeywordResult[];
  createdAt: string;
  completedAt?: string;
  totalFound: number;
  totalDownloaded: number;
  totalFailed: number;
  currentIndex: number;
  /** Log */
  logs: SearchLogEntry[];
}

export interface SearchLogEntry {
  time: string;
  message: string;
  level: 'info' | 'warn' | 'error';
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
