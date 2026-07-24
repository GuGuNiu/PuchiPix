/**
 * SseBridge — 统一的 SSE 连接管理器（v2）
 *
 * 特性:
 * - 按需动态注册 EventSource listener（不再硬编码事件类型）
 * - 心跳 watchdog：45s 无心跳则主动断开并重连
 * - 指数退避重连：1s → 2s → 4s → 8s → max 30s
 * - 连接状态事件：connected / disconnected / reconnecting
 */

import { createLogger } from '@/lib/infra';

const logger = createLogger('SseBridge');

type SseEventHandler = (data: any) => void;
type ConnectionStateHandler = (state: 'connected' | 'disconnected' | 'reconnecting') => void;

interface SseBridgeState {
  connected: boolean;
  eventSource: EventSource | null;
  listeners: Map<string, Set<SseEventHandler>>;
  connStateListeners: Set<ConnectionStateHandler>;
  registeredEvents: Set<string>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastHeartbeat: number;
  reconnectAttempt: number;
}

const state: SseBridgeState = {
  connected: false,
  eventSource: null,
  listeners: new Map(),
  connStateListeners: new Set(),
  registeredEvents: new Set(),
  reconnectTimer: null,
  heartbeatTimer: null,
  lastHeartbeat: 0,
  reconnectAttempt: 0,
};

const HEARTBEAT_INTERVAL = 15000;   // backend sends heartbeat every 15s
const HEARTBEAT_TIMEOUT = 45000;    // 3x interval before considering dead
const RECONNECT_BASE = 1000;        // 1s base delay
const RECONNECT_MAX = 30000;        // 30s max delay

function notifyConnState(s: 'connected' | 'disconnected' | 'reconnecting'): void {
  for (const h of state.connStateListeners) {
    try { h(s); } catch { /* isolate */ }
  }
}

function dispatch(event: string, data: any): void {
  const handlers = state.listeners.get(event);
  if (!handlers) return;
  for (const handler of handlers) {
    try { handler(data); } catch (err) {
      logger.warn(`Handler error for "${event}"`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function resetHeartbeat(): void {
  state.lastHeartbeat = Date.now();
  if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
  state.heartbeatTimer = setTimeout(() => {
    logger.warn('Heartbeat timeout — forcing reconnect');
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
    state.connected = false;
    scheduleReconnect();
  }, HEARTBEAT_TIMEOUT);
}

function cancelHeartbeat(): void {
  if (state.heartbeatTimer) {
    clearTimeout(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

function ensureEventSourceListener(es: EventSource, event: string): void {
  if (state.registeredEvents.has(event)) return;
  state.registeredEvents.add(event);
  es.addEventListener(event, (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      dispatch(event, data);
    } catch {
      dispatch(event, e.data);
    }
  });
}

function connect(): void {
  if (state.eventSource) {
    state.eventSource.close();
  }
  cancelHeartbeat();
  // Clear any pending reconnect timer to prevent double-connect
  // when connect() is called externally (e.g. initSseBridge) while
  // a scheduled reconnect hasn't fired yet.
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  const es = new EventSource('/api/tasks/stream');
  state.eventSource = es;
  state.registeredEvents.clear();

  es.onopen = () => {
    state.connected = true;
    state.reconnectAttempt = 0;
    state.lastHeartbeat = Date.now();
    resetHeartbeat();
    logger.info('SSE connected');
    notifyConnState('connected');
  };

  // Register EventSource listeners for all subscribed event types
  for (const event of state.listeners.keys()) {
    ensureEventSourceListener(es, event);
  }

  // Heartbeat: reset watchdog on every backend ping. Registered here
  // (not via ensureEventSourceListener) so heartbeat dispatch doesn't
  // leak to consumer handlers.
  if (!state.registeredEvents.has('heartbeat')) {
    state.registeredEvents.add('heartbeat');
    es.addEventListener('heartbeat', () => {
      resetHeartbeat();
    });
  }

  es.onerror = () => {
    // Guard: if we're already reconnecting, skip duplicate onerror events.
    // EventSource may fire onerror multiple times during a single disconnection.
    if (state.reconnectTimer) return;

    state.connected = false;
    cancelHeartbeat();
    // Close the broken EventSource and schedule immediate reconnect.
    // Previously we relied on the heartbeat watchdog (45s timeout) to
    // trigger reconnect, which caused a 45s window where the frontend
    // appeared frozen. Now we close and reconnect immediately.
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (state.reconnectTimer) return;

  state.reconnectAttempt++;
  const baseDelay = Math.min(
    RECONNECT_BASE * Math.pow(2, state.reconnectAttempt - 1),
    RECONNECT_MAX,
  );
  // Add ±25% jitter to prevent reconnection storms when the backend
  // restarts and all clients reconnect simultaneously.
  const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
  const delay = Math.max(0, Math.round(baseDelay + jitter));

  logger.info(`SSE reconnecting in ${delay}ms (attempt ${state.reconnectAttempt})`);
  notifyConnState('reconnecting');

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

/**
 * Subscribe to a named SSE event. Returns an unsubscribe function.
 */
export function onSseEvent(event: string, handler: SseEventHandler): () => void {
  if (!state.listeners.has(event)) {
    state.listeners.set(event, new Set());
  }
  state.listeners.get(event)!.add(handler);

  if (!state.eventSource && !state.reconnectTimer) {
    connect();
  }

  if (state.eventSource) {
    ensureEventSourceListener(state.eventSource, event);
  }

  return () => {
    state.listeners.get(event)?.delete(handler);
  };
}

export function initSseBridge(): void {
  if (!state.eventSource && !state.reconnectTimer) {
    connect();
  }
}

export function isSseConnected(): boolean {
  return state.connected;
}
