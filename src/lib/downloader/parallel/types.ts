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
  /** ProgressCallback */
  onProgress?: (downloaded: number, total: number) => void;
  timeout?: number;
}

export interface DownloadResult {
  success: boolean;
  fileSize: number;
  savedPath: string;
  parallelism: number;
  ranged: boolean;
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
