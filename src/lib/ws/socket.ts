import { Server as SocketIOServer } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import type { ProgressMessage } from '@/types';

let io: SocketIOServer;

export function initSocketIO(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    // 心跳配置 — 防止连接因超时断开
    pingInterval: 10000,
    pingTimeout: 5000,
    // 允许大消息（进度推送等）
    maxHttpBufferSize: 1e6,
  });

  io.on('connection', (socket) => {
    console.log(`[WS] Client connected: ${socket.id} (total: ${io.engine.clientsCount})`);

    // 客户端可主动请求当前状态
    socket.on('ping', () => {
      socket.emit('pong', { time: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      console.log(
        `[WS] Client disconnected: ${socket.id} (remaining: ${io.engine.clientsCount - 1}) — reason: ${reason}`
      );
    });

    socket.on('error', (err) => {
      console.error(`[WS] Socket error for ${socket.id}:`, err);
    });
  });

  // 引擎级错误处理
  io.engine.on('connection_error', (err) => {
    console.error('[WS] Connection error:', err.code, err.message);
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error('Socket.IO not initialized — call initSocketIO() first');
  }
  return io;
}

export function broadcastProgress(msg: ProgressMessage): void {
  if (io) {
    io.emit('progress', msg);
  }
}
