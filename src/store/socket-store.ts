import { create } from 'zustand';
import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import type { ProgressMessage } from '@/types';

interface SocketStore {
  socket: Socket | null;
  connected: boolean;
  reconnecting: boolean;
  lastProgress: ProgressMessage | null;
  connect: () => void;
  disconnect: () => void;
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:10540';

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,
  connected: false,
  reconnecting: false,
  lastProgress: null,
  connect: () => {
    const existing = get().socket;
    if (existing && existing.connected) return;
    if (existing) {
      existing.removeAllListeners();
      existing.disconnect();
    }

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      set({ connected: true, reconnecting: false });
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      set({ connected: false });
      // 服务器主动断开时重连
      if (reason === 'io server disconnect') {
        setTimeout(() => socket.connect(), 2000);
      }
    });

    socket.on('reconnect_attempt', (attempt) => {
      console.log('[Socket] Reconnect attempt:', attempt);
      set({ reconnecting: true });
    });

    socket.on('reconnect', (attempt) => {
      console.log('[Socket] Reconnected after', attempt, 'attempts');
      set({ connected: true, reconnecting: false });
    });

    socket.on('reconnect_error', (err) => {
      console.error('[Socket] Reconnect error:', err.message);
      set({ reconnecting: true });
    });

    socket.on('reconnect_failed', () => {
      console.error('[Socket] Reconnect failed — will keep retrying');
      set({ reconnecting: false });
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connect error:', err.message);
      set({ connected: false });
    });

    socket.on('progress', (msg: ProgressMessage) => {
      set({ lastProgress: msg });
    });

    set({ socket });
  },
  disconnect: () => {
    const sock = get().socket;
    if (sock) {
      sock.removeAllListeners();
      sock.disconnect();
    }
    set({ socket: null, connected: false, reconnecting: false });
  },
}));
