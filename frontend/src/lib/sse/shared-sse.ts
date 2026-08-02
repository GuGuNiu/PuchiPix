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
 * a heartbeat watchdog (45s without heartbeat) forces a reconnect.
 * Connection state can be broadcast to subscribers.
 */

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

type SseHandler = (e: MessageEvent) => void;
type ConnStateHandler = (state: ConnectionState) => void;

/** Backend pushes heartbeat every 15s; consider the connection dead beyond 3x that interval and force a reconnect. */
const HEARTBEAT_TIMEOUT = 45000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

interface SharedSseState {
  es: EventSource | null;
  /** Registered subscriptions: event -> Set<handler>. */
  subscribers: Map<string, Set<SseHandler>>;
  connStateListeners: Set<ConnStateHandler>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastHeartbeat: number;
  reconnectAttempt: number;
  connected: boolean;
  /** When destroyed explicitly (App unmount), no further reconnects. */
  destroyed: boolean;
}

const state: SharedSseState = {
  es: null,
  subscribers: new Map(),
  connStateListeners: new Set(),
  reconnectTimer: null,
  heartbeatTimer: null,
  lastHeartbeat: 0,
  reconnectAttempt: 0,
  connected: false,
  destroyed: false,
};

function notifyConnState(s: ConnectionState): void {
  state.connected = s === 'connected';
  for (const cb of state.connStateListeners) {
    // Subscriber errors must not break the broadcast loop.
    try {
      cb(s);
    } catch {
    }
  }
}

function resetHeartbeat(): void {
  state.lastHeartbeat = Date.now();
  if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
  state.heartbeatTimer = setTimeout(() => {
    // Heartbeat timeout: force close and reconnect.
    if (state.es) {
      state.es.close();
      state.es = null;
    }
    notifyConnState('disconnected');
    scheduleReconnect();
  }, HEARTBEAT_TIMEOUT);
}

function cancelHeartbeat(): void {
  if (state.heartbeatTimer) {
    clearTimeout(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

function scheduleReconnect(): void {
  if (state.destroyed) return;
  if (state.reconnectTimer) return; // Already scheduled.

  state.reconnectAttempt++;
  const base = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempt - 1),
    RECONNECT_MAX_MS,
  );
  // +/-25% jitter avoids a reconnect storm when the backend restarts.
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  const delay = Math.max(0, Math.round(base + jitter));

  notifyConnState('reconnecting');
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

/** Re-register all subscribed events on a fresh EventSource (after reconnect). */
function rebindAllHandlers(es: EventSource): void {
  for (const [event, handlers] of state.subscribers) {
    for (const handler of handlers) {
      es.addEventListener(event, handler);
    }
  }
  /* Heartbeat events are not dispatched to business subscribers; they only reset the watchdog. */
  es.addEventListener('heartbeat', () => {
    resetHeartbeat();
  });
}

function connect(): void {
  if (state.destroyed) return;

  // Tear down any stale connection / timers before (re)connecting.
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  cancelHeartbeat();
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  const es = new EventSource('/api/tasks/stream');
  state.es = es;

  es.onopen = () => {
    state.reconnectAttempt = 0;
    resetHeartbeat();
    notifyConnState('connected');
  };

  es.onerror = () => {
  // EventSource onerror may fire multiple times during one disconnect.
  if (state.reconnectTimer) return;
    cancelHeartbeat();
    if (state.es === es) {
      state.es = null;
      es.close();
    }
    notifyConnState('disconnected');
    scheduleReconnect();
  };

  rebindAllHandlers(es);
}

function teardown(): void {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  cancelHeartbeat();
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  state.reconnectAttempt = 0;
  notifyConnState('disconnected');
}

/**
 * Subscribe to a named SSE event. Returns an unsubscribe function.
 * Multiple subscribers per event are allowed; event names match the
 * backend EventBus event names.
 */
export function subscribeSseEvent(event: string, handler: SseHandler): () => void {
  let handlers = state.subscribers.get(event);
  if (!handlers) {
    handlers = new Set();
    state.subscribers.set(event, handlers);
  }
  handlers.add(handler);

  // Attach the listener immediately when a connection already exists.
  if (state.es) {
    state.es.addEventListener(event, handler);
  }

  return () => {
    const set = state.subscribers.get(event);
    if (!set) return;
    set.delete(handler);
    if (state.es) {
      state.es.removeEventListener(event, handler);
    }
    if (set.size === 0) {
      state.subscribers.delete(event);
    }
  };
}

/** Subscribe to connection-state changes. Returns an unsubscribe function. */
export function onSseConnectionState(cb: ConnStateHandler): () => void {
  state.connStateListeners.add(cb);
  // Replay the current state so late subscribers see the real status.
  const current: ConnectionState = state.connected
    ? 'connected'
    : state.reconnectTimer
      ? 'reconnecting'
      : 'disconnected';
  // Subscriber errors must not break subscription setup.
  try {
    cb(current);
  } catch {
  }
  return () => {
    state.connStateListeners.delete(cb);
  };
}

/** Call at app mount: establish the resident connection (idempotent). */
export function initSharedSse(): void {
  state.destroyed = false;
  if (state.es || state.reconnectTimer) return;
  connect();
}

/** Call at app unmount: close the connection and stop reconnecting. */
export function destroySharedSse(): void {
  state.destroyed = true;
  teardown();
}

/** Whether the connection is currently open (for debugging). */
export function isSharedSseConnected(): boolean {
  return state.connected;
}
