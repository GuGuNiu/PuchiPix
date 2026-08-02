import { create } from 'zustand';
import type { ProgressMessage } from '@/types';
import { createLogger } from '@/lib/core/infra';

const logger = createLogger('SocketStore');

// Event types emitted by Go backend WebSocket (gorilla/websocket JSON messages)
interface WsMessage {
  event: string;
  data: unknown;
}

type EventHandler = (...args: unknown[]) => void;

/**
 * Lightweight WebSocket wrapper that mimics the Socket.IO event-style API
 * the rest of the app expects, using native WebSocket underneath.
 * Connects directly to the Go backend (port 10541).
 */
class NativeWsClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<EventHandler>>();
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private reconnectMaxDelay = 5000;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  public id: string = '';

  constructor(url: string) {
    this.url = url;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(event: string, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler?: EventHandler): void {
    if (!handler) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.get(event)?.delete(handler);
  }

  emit(_event: string, ..._args: unknown[]): void {
    /*
     * The Go backend doesn't accept client-to-server messages via WS
     * (events flow only from Go → browser via EventBus).
     * Keep this stub for Socket.IO API compatibility.
     */
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.intentionalClose = false;
    this._doConnect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this._cleanup();
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  private _doConnect(): void {
    this._cleanup();

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this._fire('connect_error', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.reconnectAttempts = 0;
      this.reconnectDelay = 1000;
      this._fire('connect');
      this._fire('reconnect'); // Also fire reconnect for compatibility
    };

    this.ws.onmessage = (event) => {
      // Ignore non-JSON messages (heartbeats, etc.).
      try {
        const msg: WsMessage = JSON.parse(event.data);
        // Dispatch as Socket.IO-style event: "task:created" → on('task:created', ...)
        if (msg.event) {
          this._fire(msg.event, msg.data);
        }
      } catch {
      }
    };

    this.ws.onclose = (event) => {
      this._fire('disconnect', event.reason || 'connection closed');
      if (!this.intentionalClose) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this._fire('connect_error', new Error('WebSocket error'));
    };
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts++;
    this._fire('reconnect_attempt', this.reconnectAttempts);

    const delay = Math.min(this.reconnectDelay * (this.reconnectAttempts > 1 ? 1.5 : 1), this.reconnectMaxDelay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._doConnect();
    }, delay);
  }

  private _cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private _fire(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(...args);
        } catch (e) {
          logger.error(`Handler error for event "${event}"`, { error: e });
        }
      }
    }
  }
}

// ── Zustand store ──

interface SocketStore {
  socket: NativeWsClient | null;
  connected: boolean;
  reconnecting: boolean;
  lastProgress: ProgressMessage | null;
  connect: () => void;
  disconnect: () => void;
}

/*
 * WS endpoint: derive from location so it works in dev (Vite proxy /ws)
 * and in production (nginx /ws proxy) alike. Previously this was
 * hardcoded to ws://localhost:10541/ws, which is unreachable when the
 * frontend is served from a different host.
 */
const WS_URL = (() => {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
})();

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,
  connected: false,
  reconnecting: false,
  lastProgress: null,

  connect: () => {
    const existing = get().socket;
    if (existing && existing.connected) return;
    if (existing) {
      existing.disconnect();
    }

    const socket = new NativeWsClient(WS_URL);

    socket.on('connect', () => {
      logger.info(`Connected: ${socket.id}`);
      set({ connected: true, reconnecting: false });
    });

    socket.on('disconnect', (reason: unknown) => {
      logger.info(`Disconnected: ${reason}`);
      set({ connected: false });
    });

    socket.on('reconnect', () => {
      logger.info('Reconnected');
      set({ connected: true, reconnecting: false });
    });

    socket.on('reconnect_attempt', () => {
      logger.info('Reconnect attempt');
      set({ reconnecting: true });
    });

    socket.on('connect_error', (err: unknown) => {
      logger.error('Connect error', { error: err instanceof Error ? err.message : String(err) });
      set({ connected: false });
    });

    socket.on('progress', (msg: unknown) => {
      set({ lastProgress: msg as ProgressMessage });
    });

    socket.connect();
    set({ socket });
  },

  disconnect: () => {
    const sock = get().socket;
    if (sock) {
      sock.disconnect();
    }
    set({ socket: null, connected: false, reconnecting: false });
  },
}));

// Re-export the client type for components that access socket directly
