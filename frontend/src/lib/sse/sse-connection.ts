/**
 * SseConnection — 可复用的单路 SSE 连接管理器。
 *
 * 背景：LogConsole 此前各自 `new EventSource('/api/logs')`，没有指数退避
 * 重连、没有心跳看门狗、没有连接状态广播；而 /api/tasks/stream 的全局单例
 * 里已经有一套完整的生命周期管理。本类把这套逻辑抽成共享实现，让「全局单例」
 * 与「按需连接」（如日志控制台）复用同一套能力：
 *   - 指数退避重连（±25% jitter，避免后端重启时重连风暴）
 *   - 心跳看门狗（超过 N×心跳间隔无任何事件即判定死连接并强制重连）
 *   - 连接状态广播（connected / reconnecting / disconnected）
 *   - 事件订阅（重连后自动重新绑定，订阅者无感知）
 */

export type SseConnectionState = "connected" | "disconnected" | "reconnecting";

type SseHandler = ((e: MessageEvent) => void) & { event?: string };
type ConnStateHandler = (state: SseConnectionState) => void;

/** 后端默认每 15s 推送一次 heartbeat；超过 3 倍间隔无任何事件视为死连接。 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
const DEFAULT_HEARTBEAT_TIMEOUT_FACTOR = 3;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export interface SseConnectionOptions {
  /** 后端实际推送 heartbeat 的周期（毫秒）。默认 15000。 */
  heartbeatIntervalMs?: number;
  /** 看门狗超时 = heartbeatIntervalMs × factor。默认 3。 */
  heartbeatTimeoutFactor?: number;
  /** 重连退避上限（毫秒）。默认 30000。 */
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

  /** 连接当前是否处于 open 状态（供调试/UI 判断）。 */
  isConnected(): boolean {
    return this.connected;
  }

  private notifyState(s: SseConnectionState): void {
    this.connected = s === "connected";
    for (const cb of this.stateListeners) {
      // 订阅方抛错不得中断广播循环。
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
    if (this.reconnectTimer) return; // 已有重连计划。

    this.reconnectAttempt++;
    const base = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt - 1),
      this.opts.reconnectMaxMs,
    );
    // +/-25% jitter 避免后端重启时的重连风暴。
    const jitter = base * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(0, Math.round(base + jitter));

    this.notifyState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** 在新建的 EventSource 上重新绑定全部订阅（重连后调用）。 */
  private rebindAll(es: EventSource): void {
    for (const handlers of this.subscribers.values()) {
      for (const handler of handlers) {
        if (handler.event) {
          es.addEventListener(handler.event, handler);
        }
      }
    }
    // heartbeat 事件不派发给业务订阅者，只重置看门狗。
    es.addEventListener("heartbeat", () => this.resetHeartbeat());
  }

  /** 建立连接（幂等：已 open/connecting 时直接返回）。 */
  connect(): void {
    if (this.destroyed) return;
    if (
      this.es &&
      (this.es.readyState === EventSource.CONNECTING ||
        this.es.readyState === EventSource.OPEN)
    ) {
      return;
    }

    // 先清理残留连接/定时器，再新建。
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
      // onerror 在同一次断开中可能触发多次；已有重连计划则忽略。
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

  /** 永久关闭连接并停止重连（组件卸载时调用）。 */
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

  /**
   * 订阅命名 SSE 事件，返回退订函数。
   * 重连后自动重新绑定；任意业务事件派发都会重置心跳看门狗。
   */
  subscribe(event: string, handler: SseHandler): () => void {
    const wrapped: SseHandler = (e: MessageEvent) => {
      // 任何被消费的业务事件都证明连接活跃。
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

    // 连接已建立时立即绑定。
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

  /** 订阅连接状态变化（立即回放当前状态），返回退订函数。 */
  onStateChange(cb: ConnStateHandler): () => void {
    this.stateListeners.add(cb);
    // 回放当前状态，让晚订阅者立即看到真实状态。
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
