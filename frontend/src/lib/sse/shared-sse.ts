/**
 * shared-sse.ts — 全局共享 SSE 连接（单例常驻）
 *
 * 背景：
 * 此前每个页面（Dashboard / Tasks / Photos）各自 new EventSource('/api/tasks/stream')，
 * 路由切换时旧页面卸载关闭连接、新页面挂载重新建连，导致：
 *  - 每次路由切换都重新拉取全量 `initial` 数据（状态抖动、后端压力）
 *  - 建连窗口内页面数据短暂缺失（状态不一致）
 *  - 同页多 store 订阅时可能建立重复连接
 *
 * 方案：
 * 应用启动时建立**单个常驻连接**，所有 store / 组件通过 subscribeSseEvent()
 * 订阅事件（同一事件可多 handler 并存）。连接断开后指数退避自动重连，
 * 心跳 watchdog 兜底（45s 无心跳强制重连）。连接状态可广播给订阅者。
 */

type ConnectionState = 'connected' | 'disconnected' | 'reconnecting';

type SseHandler = (e: MessageEvent) => void;
type ConnStateHandler = (state: ConnectionState) => void;

const HEARTBEAT_INTERVAL = 15000; // 后端每 15s 推送一次 heartbeat
const HEARTBEAT_TIMEOUT = 45000;  // 3x 间隔仍无心跳视为连接死亡
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

interface SharedSseState {
  es: EventSource | null;
  /** 已注册的订阅：event -> Set<handler>（同一事件可多 handler） */
  subscribers: Map<string, Set<SseHandler>>;
  connStateListeners: Set<ConnStateHandler>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  lastHeartbeat: number;
  reconnectAttempt: number;
  connected: boolean;
  /** 应用显式销毁（App 卸载）后不再自动重连 */
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
    try {
      cb(s);
    } catch {
      /* 隔离单个订阅者异常 */
    }
  }
}

function resetHeartbeat(): void {
  state.lastHeartbeat = Date.now();
  if (state.heartbeatTimer) clearTimeout(state.heartbeatTimer);
  state.heartbeatTimer = setTimeout(() => {
    // 心跳超时：强制断开并重连
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
  if (state.reconnectTimer) return; // 已排定，避免重复

  state.reconnectAttempt++;
  const base = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempt - 1),
    RECONNECT_MAX_MS,
  );
  // ±25% jitter，避免后端重启时所有客户端同时重连形成风暴
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  const delay = Math.max(0, Math.round(base + jitter));

  notifyConnState('reconnecting');
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connect();
  }, delay);
}

/** 为当前 EventSource 重新注册全部已订阅事件（重连后调用） */
function rebindAllHandlers(es: EventSource): void {
  for (const [event, handlers] of state.subscribers) {
    for (const handler of handlers) {
      es.addEventListener(event, handler);
    }
  }
  // heartbeat 事件不派发给业务订阅者，仅用于重置 watchdog
  es.addEventListener('heartbeat', () => {
    resetHeartbeat();
  });
}

function connect(): void {
  if (state.destroyed) return;

  // 清理旧的连接/定时器，防止重复
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
    // EventSource 断线时会多次触发 onerror；已有重连排定时则忽略
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
 * 订阅指定 SSE 事件。返回取消订阅函数。
 * 同一事件允许多个订阅者；事件名与后端 EventBus 事件名一致。
 */
export function subscribeSseEvent(event: string, handler: SseHandler): () => void {
  let handlers = state.subscribers.get(event);
  if (!handlers) {
    handlers = new Set();
    state.subscribers.set(event, handlers);
  }
  handlers.add(handler);

  // 连接已存在则立即挂载该事件的 listener（含重连后的情况）
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

/** 订阅连接状态变化。返回取消订阅函数。 */
export function onSseConnectionState(cb: ConnStateHandler): () => void {
  state.connStateListeners.add(cb);
  // 回放当前状态，避免订阅方错过初始状态
  const current: ConnectionState = state.connected
    ? 'connected'
    : state.reconnectTimer
      ? 'reconnecting'
      : 'disconnected';
  try {
    cb(current);
  } catch {
    /* ignore */
  }
  return () => {
    state.connStateListeners.delete(cb);
  };
}

/** 应用挂载时调用：建立常驻连接（幂等）。 */
export function initSharedSse(): void {
  state.destroyed = false;
  if (state.es || state.reconnectTimer) return;
  connect();
}

/** 应用卸载时调用：关闭连接并停止重连（幂等）。 */
export function destroySharedSse(): void {
  state.destroyed = true;
  teardown();
}

/** 当前是否已连接（供调试/外部查询）。 */
export function isSharedSseConnected(): boolean {
  return state.connected;
}
