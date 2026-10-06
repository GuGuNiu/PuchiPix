import { SseConnection, type SseConnectionState } from "./sse-connection";

export type ConnectionState = SseConnectionState;
export type SseHandler = ((e: MessageEvent) => void) & { event?: string };
export type ConnStateHandler = (state: ConnectionState) => void;

let conn: SseConnection | null = null;

function ensureConnection(): SseConnection {
  if (!conn) {
    conn = new SseConnection("/api/tasks/stream");
  }
  return conn;
}

export function subscribeSseEvent(event: string, handler: SseHandler): () => void {
  return ensureConnection().subscribe(event, handler);
}

export function onSseConnectionState(cb: ConnStateHandler): () => void {
  return ensureConnection().onStateChange(cb);
}

export function initSharedSse(): void {
  ensureConnection().connect();
}

export function destroySharedSse(): void {
  if (conn) {
    conn.destroy();
    conn = null;
  }
}

export function isSharedSseConnected(): boolean {
  return conn?.isConnected() ?? false;
}
