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
