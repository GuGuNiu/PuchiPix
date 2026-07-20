

/*
 * ─────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────
 */

export interface TaskCreatePayload {
  taskType: 'gallery' | 'video' | 'sniff';
  url: string;
  galleryId?: number;
  taskId?: number;
  sniffId?: number;
  siteId?: string;
  concurrency?: number;
}

export interface TaskActionPayload {
  taskId: number;
  action: 'start' | 'pause' | 'cancel' | 'resume' | 'retry';
}

export interface TaskSelectM3u8Payload {
  taskId: number;
  m3u8Url: string;
}

export interface GalleryDownloadPayload {
  galleryId: number;
  concurrency?: number;
}

export interface GalleryActionPayload {
  galleryId: number;
  action: 'pause' | 'resume' | 'retry-failed' | 'download-zip';
  manualUrl?: string;
  enqueue?: boolean;
  maxRetries?: number;
}

export interface GalleryBatchPayload {
  urls: string[];
  siteId: string;
}

export interface ConfigUpdatePayload {
  key: string;
  value: string;
}

export interface DagCommandPayload {
  dagId?: string;
  command: 'pause' | 'resume' | 'retry' | 'cancel';
  nodeId?: string;
}

export type WorkerCommand =
  | { type: 'task:create'; payload: TaskCreatePayload }
  | { type: 'task:action'; payload: TaskActionPayload }
  | { type: 'task:select-m3u8'; payload: TaskSelectM3u8Payload }
  | { type: 'gallery:download'; payload: GalleryDownloadPayload }
  | { type: 'gallery:action'; payload: GalleryActionPayload }
  | { type: 'gallery:batch'; payload: GalleryBatchPayload }
  | { type: 'config:update'; payload: ConfigUpdatePayload }
  | { type: 'dag:command'; payload: DagCommandPayload }
  | { type: 'shutdown' };

/*
 * ─────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────
 */

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'event'; event: string; payload: unknown }
  | { type: 'error'; payload: { message: string; stack?: string } }
  | { type: 'shutdown:complete' };

/*
 * ─────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────
 */

const COMMAND_TYPES = new Set<WorkerCommand['type']>([
  'task:create',
  'task:action',
  'task:select-m3u8',
  'gallery:download',
  'gallery:action',
  'gallery:batch',
  'config:update',
  'dag:command',
  'shutdown',
]);

const EVENT_TYPES = new Set<WorkerEvent['type']>([
  'ready',
  'event',
  'error',
  'shutdown:complete',
]);

export function isWorkerCommand(msg: unknown): msg is WorkerCommand {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return typeof obj.type === 'string' && COMMAND_TYPES.has(obj.type as WorkerCommand['type']);
}

export function isWorkerEvent(msg: unknown): msg is WorkerEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const obj = msg as Record<string, unknown>;
  return typeof obj.type === 'string' && EVENT_TYPES.has(obj.type as WorkerEvent['type']);
}

/*
 * ─────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────
 */

export type WorkerStatus = 'ready' | 'starting' | 'restarting' | 'down' | 'fatal';

export interface WorkerStats {
  status: WorkerStatus;
  pid: number | null;
  uptime: number | null;
  restartCount: number;
  lastExitCode: number | null;
}
