import { create } from 'zustand';
import type { ProgressMessage } from '@/types';

// Event types emitted by Go backend WebSocket (gorilla/websocket JSON messages)
interface WsMessage {
  event: string;
  data: any;
}

type EventHandler = (...args: any[]) => void;

/**
 * Lightweight WebSocket wrapper that mimics the Socket.IO event-style API
 * the rest of the app expects, using native WebSocket underneath.
 * Connects directly to Go backend (port 10541) to avoid Next.js proxy
 * complexity.
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

  emit(_event: string, ..._args: any[]): void {
    // The Go backend doesn't accept client-to-server messages via WS
    // (events flow only from Go → browser via EventBus).
    // Keep this stub for Socket.IO API compatibility.
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
      this._fire('reconnect'); // also fire reconnect for compatibility
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        // Dispatch as Socket.IO-style event: "task:created" → on('task:created', ...)
        if (msg.event) {
          this._fire(msg.event, msg.data);
        }
      } catch {
        // Ignore non-JSON messages (heartbeats, etc.)
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

  private _fire(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(...args);
        } catch (e) {
          console.error(`[WS] Handler error for event "${event}":`, e);
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

const WS_URL = 'ws://localhost:10541/ws';

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
      console.log('[Socket] Connected:', socket.id);
      set({ connected: true, reconnecting: false });
    });

    socket.on('disconnect', (reason: string) => {
      console.log('[Socket] Disconnected:', reason);
      set({ connected: false });
    });

    socket.on('reconnect', (_attempt: number) => {
      console.log('[Socket] Reconnected');
      set({ connected: true, reconnecting: false });
    });

    socket.on('reconnect_attempt', (attempt: number) => {
      console.log('[Socket] Reconnect attempt:', attempt);
      set({ reconnecting: true });
    });

    socket.on('connect_error', (err: Error) => {
      console.error('[Socket] Connect error:', err.message);
      set({ connected: false });
    });

    socket.on('progress', (msg: ProgressMessage) => {
      set({ lastProgress: msg });
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
export type { NativeWsClient };
