/**
 * SseConnection — reusable single SSE connection manager with exponential backoff,
 * heartbeat watchdog, connection state broadcast, and auto-rebinding subscriptions.
 */

export type SseConnectionState = "connected" | "disconnected" | "reconnecting";

type SseHandler = ((e: MessageEvent) => void) & { event?: string };
type ConnStateHandler = (state: SseConnectionState) => void;

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
const DEFAULT_HEARTBEAT_TIMEOUT_FACTOR = 3;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export interface SseConnectionOptions {
  heartbeatIntervalMs?: number;
  heartbeatTimeoutFactor?: number;
  reconnectMaxMs?: number;
}

export class SseConnection {
  readonly url: string;
  private opts: Required<SseConnectionOptions>;

  private es: EventSource | null = null;
  private subscribers = new Map<string, Set<SseHandler>>();
  private stateListeners = new Set<ConnStateHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connected = false;
  private destroyed = false;

  constructor(url: string, opts: SseConnectionOptions = {}) {
    this.url = url;
    this.opts = {
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      heartbeatTimeoutFactor: opts.heartbeatTimeoutFactor ?? DEFAULT_HEARTBEAT_TIMEOUT_FACTOR,
      reconnectMaxMs: opts.reconnectMaxMs ?? RECONNECT_MAX_MS,
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  private notifyState(s: SseConnectionState): void {
    this.connected = s === "connected";
    for (const cb of this.stateListeners) {
      // Subscriber errors must not interrupt the broadcast loop.
      try {
        cb(s);
      } catch {
      }
    }
  }

  private resetHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      // Heartbeat timeout: force close and reconnect.
      if (this.es) {
        this.es.close();
        this.es = null;
      }
      this.notifyState("disconnected");
      this.scheduleReconnect();
    }, this.opts.heartbeatIntervalMs * this.opts.heartbeatTimeoutFactor);
  }

  private cancelHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempt++;
    const base = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt - 1),
      this.opts.reconnectMaxMs,
    );
    // +/-25% jitter to avoid reconnection storm when backend restarts.
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(base + jitter));

    this.notifyState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private rebindAll(es: EventSource): void {
    for (const handlers of this.subscribers.values()) {
      for (const handler of handlers) {
        if (handler.event) {
          es.addEventListener(handler.event, handler);
        }
      }
    }
    // heartbeat events are not dispatched to business subscribers, only reset watchdog.
    es.addEventListener("heartbeat", () => this.resetHeartbeat());
  }

  connect(): void {
    if (this.destroyed) return;
    if (
      this.es &&
      (this.es.readyState === EventSource.CONNECTING ||
        this.es.readyState === EventSource.OPEN)
    ) {
      return;
    }

    // Clean up stale connection/timer before creating a new one.
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.cancelHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const es = new EventSource(this.url);
    this.es = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.resetHeartbeat();
      this.notifyState("connected");
    };

    es.onerror = () => {
      // onerror may fire multiple times per disconnect; ignore if a reconnect is already scheduled.
      if (this.reconnectTimer) return;
      this.cancelHeartbeat();
      if (this.es === es) {
        this.es = null;
        es.close();
      }
      this.notifyState("disconnected");
      this.scheduleReconnect();
    };

    this.rebindAll(es);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.cancelHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.notifyState("disconnected");
  }

  subscribe(event: string, handler: SseHandler): () => void {
    const wrapped: SseHandler = (e: MessageEvent) => {
      // Any consumed business event proves the connection is alive.
      this.resetHeartbeat();
      handler(e);
    };
    wrapped.event = event;

    let handlers = this.subscribers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(event, handlers);
    }
    handlers.add(wrapped);

    if (this.es) {
      this.es.addEventListener(event, wrapped);
    }

    return () => {
      const set = this.subscribers.get(event);
      if (!set) return;
      set.delete(wrapped);
      if (this.es) {
        this.es.removeEventListener(event, wrapped);
      }
      if (set.size === 0) {
        this.subscribers.delete(event);
      }
    };
  }

  onStateChange(cb: ConnStateHandler): () => void {
    this.stateListeners.add(cb);
    const current: SseConnectionState = this.connected
      ? "connected"
      : this.reconnectTimer
        ? "reconnecting"
        : "disconnected";
    try {
      cb(current);
    } catch {
    }
    return () => {
      this.stateListeners.delete(cb);
    };
  }
}
