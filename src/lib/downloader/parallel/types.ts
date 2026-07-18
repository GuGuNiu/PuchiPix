export const DEFAULT_CHUNK_COUNT = 4;
export const MAX_CHUNK_COUNT = 8;
export const CHUNK_TIMEOUT = 120000;
export const MAX_REDIRECTS = 5;

export interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  retries: number;
}

export interface ParallelDownloadOptions {
  chunkCount?: number;
  headers?: Record<string, string>;
  /** 进度回调 */
  onProgress?: (downloaded: number, total: number) => void;
  /** 下载超时（毫秒） */
  timeout?: number;
}

export interface DownloadResult {
  success: boolean;
  fileSize: number;
  savedPath: string;
  /** 实际使用的并行数 */
  parallelism: number;
  /** 是否使用了多线程 */
  ranged: boolean;
  /** 平均速度（字节/秒） */
  avgSpeed: number;
}

export interface ProbeResult {
  statusCode: number;
  contentLength: number;
  acceptsRanges: boolean;
  finalUrl: string;
  filename: string | null;
  headers: import('http').IncomingHttpHeaders;
}
