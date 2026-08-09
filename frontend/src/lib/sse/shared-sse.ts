/**
 * SharedSse - app-wide shared SSE connection (single resident instance).
 *
 * Background:
 * Previously each page (Dashboard / Tasks / Photos) created its own
 * EventSource to '/api/tasks/stream'. Route switching closed the old
 * connection and opened a new one, which caused:
 *  - Full 'initial' payload being re-pulled on every route change
 *    (state flicker and extra backend load)
 *  - A window where the page had no live data during (re)connection
 *  - Duplicate connections when multiple stores subscribed at once
 *
 * Solution:
 * A single resident connection is established at app startup. Stores and
 * components subscribe via subscribeSseEvent() (multiple handlers per
 * event are supported). On disconnect, reconnect uses exponential backoff;
 * a heartbeat watchdog (45s without any event) forces a reconnect.
 * Connection state can be broadcast to subscribers.
 *
 * The connection lifecycle (reconnect/backoff/heartbeat watchdog/state
 * broadcast/rebind) lives in SseConnection (./sse-connection), shared with
 * the log console so every stream gets identical protection.
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
