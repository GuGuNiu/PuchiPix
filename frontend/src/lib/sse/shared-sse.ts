/**
 * SharedSse - app-wide shared SSE connection.
 *
 * Single resident connection established at app startup. Stores and components
 * subscribe via subscribeSseEvent(). Connection lifecycle management
 * (reconnect, backoff, heartbeat watchdog) is handled by SseConnection.
 */

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

/**
 * Subscribe to a named SSE event. Returns an unsubscribe function.
 * Multiple subscribers per event are allowed; event names match the
 * backend EventBus event names.
 */
export function subscribeSseEvent(event: string, handler: SseHandler): () => void {
  return ensureConnection().subscribe(event, handler);
}

/** Subscribe to connection-state changes. Returns an unsubscribe function. */
export function onSseConnectionState(cb: ConnStateHandler): () => void {
  return ensureConnection().onStateChange(cb);
}

/** Call at app mount: establish the resident connection (idempotent). */
export function initSharedSse(): void {
  ensureConnection().connect();
}

/** Call at app unmount: close the connection and stop reconnecting. */
export function destroySharedSse(): void {
  if (conn) {
    conn.destroy();
    conn = null;
  }
}

/** Whether the connection is currently open (for debugging). */
export function isSharedSseConnected(): boolean {
  return conn?.isConnected() ?? false;
}
