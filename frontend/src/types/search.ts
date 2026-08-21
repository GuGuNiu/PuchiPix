export interface SearchItem {
  pageUrl: string;
  title: string;
  coverUrl?: string;
  date?: string;
  m3u8Url?: string;
  taskId?: number;
  status: 'pending' | 'scraping' | 'downloaded' | 'failed';
  error?: string;
  retries: number;
}

export interface BatchTitleResult {
  title: string;
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
  taskId?: number;
  error?: string;
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
  siteId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  results: BatchTitleResult[];
  createdAt: string;
  completedAt?: string;
  totalProcessed: number;
  totalDownloaded: number;
  totalNotFound: number;
  totalFailed: number;
  currentIndex: number;
  logs: SearchLogEntry[];
}
