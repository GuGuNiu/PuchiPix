import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 全局日志缓冲区
 *
 * 存储最近 500 条日志，通过 SSE 推送给前端控制台。
 */
const MAX_LOGS = 500;
const logBuffer: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  source: string;
  message: string;
  details?: string;
}

let logId = 0;

function addLog(level: LogEntry['level'], source: string, message: string, details?: string): void {
  const entry: LogEntry = {
    id: ++logId,
    timestamp: new Date().toISOString(),
    level,
    source,
    message,
    details,
  };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOGS) {
    logBuffer.shift();
  }
  listeners.forEach((fn) => fn(entry));
}

/**
 * 拦截全局 console 方法，将日志收集到缓冲区
 */
function interceptConsole(): void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args);
    addLog('info', 'console', formatArgs(args));
  };

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    addLog('warn', 'console', formatArgs(args));
  };

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    addLog('error', 'console', formatArgs(args));
  };

  console.info = (...args: unknown[]) => {
    originalInfo.apply(console, args);
    addLog('info', 'console', formatArgs(args));
  };

  console.debug = (...args: unknown[]) => {
    originalDebug.apply(console, args);
    addLog('debug', 'console', formatArgs(args));
  };
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

// 只拦截一次
if (typeof window === 'undefined') {
  interceptConsole();
}

export function getLogs(): LogEntry[] {
  return [...logBuffer];
}

export function pushLog(level: LogEntry['level'], source: string, message: string, details?: string): void {
  addLog(level, source, message, details);
}

export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 发送历史日志
      const history = getLogs();
      send('history', history);

      // 监听新日志
      const onLog = (entry: LogEntry): void => {
        send('log', entry);
      };
      listeners.add(onLog);

      // keepalive
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, 15000);

      // 清理
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        listeners.delete(onLog);
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
