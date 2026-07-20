import type { NextRequest } from 'next/server';
import { logSink } from '@/lib/core/infra';
import type { StructuredLogEntry, LogQueryFilter, LogLevel } from '@/lib/core/infra';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  levelValue: number;
  module: string;
  source: string;
  message: string;
  traceId?: string;
  dagId?: string;
  nodeId?: string;
  taskType?: string;
  phase?: string;
  context?: Record<string, unknown>;
  data?: unknown;
  details?: string;
  i18nKey?: string;
  i18nParams?: Record<string, string | number>;
}

let logSeq = 0;

function toLogEntry(entry: StructuredLogEntry): LogEntry {
  return {
    id: ++logSeq,
    timestamp: entry.timestamp,
    level: entry.level,
    levelValue: entry.levelValue,
    module: entry.module,
    source: entry.module,
    message: entry.message,
    traceId: entry.context.traceId,
    dagId: entry.context.dagId,
    nodeId: entry.context.nodeId,
    taskType: entry.context.taskType,
    phase: entry.context.phase,
    context: entry.context,
    data: entry.data,
    i18nKey: entry.i18nKey,
    i18nParams: entry.i18nParams,
  };
}

function matchesFilter(entry: StructuredLogEntry, filter: LogQueryFilter): boolean {
  if (filter.level !== undefined && entry.levelValue < filter.level) return false;
  if (filter.module && entry.module !== filter.module) return false;
  if (filter.dagId && entry.context.dagId !== filter.dagId) return false;
  if (filter.nodeId && entry.context.nodeId !== filter.nodeId) return false;
  if (filter.traceId && entry.context.traceId !== filter.traceId) return false;
  if (filter.taskType && entry.context.taskType !== filter.taskType) return false;
  return true;
}

const LEVEL_MAP: Record<string, LogLevel> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const legacyEnabled = process.env.LOG_SINK_LEGACY !== 'false';

function interceptConsole(): void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  const pushLegacy = (level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', args: unknown[]): void => {
    if (!legacyEnabled) return;
    const message = args
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
    logSink.push({
      timestamp: new Date().toISOString(),
      level,
      levelValue: LEVEL_MAP[level.toLowerCase() as keyof typeof LEVEL_MAP] ?? 20,
      module: 'console-legacy',
      message,
      context: {},
    });
  };

  console.log = (...args: unknown[]) => {
    originalLog.apply(console, args);
    pushLegacy('INFO', args);
  };

  console.warn = (...args: unknown[]) => {
    originalWarn.apply(console, args);
    pushLegacy('WARN', args);
  };

  console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    pushLegacy('ERROR', args);
  };

  console.info = (...args: unknown[]) => {
    originalInfo.apply(console, args);
    pushLegacy('INFO', args);
  };

  console.debug = (...args: unknown[]) => {
    originalDebug.apply(console, args);
    pushLegacy('DEBUG', args);
  };
}

if (typeof window === 'undefined') {
  interceptConsole();
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);

  const filter: LogQueryFilter = {
    module: searchParams.get('module') ?? undefined,
    dagId: searchParams.get('dagId') ?? undefined,
    nodeId: searchParams.get('nodeId') ?? undefined,
    traceId: searchParams.get('traceId') ?? undefined,
    taskType: searchParams.get('taskType') ?? undefined,
    limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined,
  };

  const levelParam = searchParams.get('level');
  if (levelParam) {
    filter.level = LEVEL_MAP[levelParam.toLowerCase()];
  }

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

      const history = logSink.query(filter).map(toLogEntry);
      send('history', history);

      const unsubscribe = logSink.subscribe((entry) => {
        if (matchesFilter(entry, filter)) {
          send('log', toLogEntry(entry));
        }
      });

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, 15000);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
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
