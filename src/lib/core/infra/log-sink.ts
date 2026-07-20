import { getOrCreateGlobal } from './global-singleton';
import type { StructuredLogEntry, LogLevel } from './logger';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface LogQueryFilter {
  level?: LogLevel;
  module?: string;
  dagId?: string;
  nodeId?: string;
  traceId?: string;
  taskType?: string;
  limit?: number;
}

export type LogSinkListener = (entry: StructuredLogEntry) => void;

export interface LogSinkStats {
  total: number;
  capacity: number;
  listeners: number;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * ─────────────────────────────────────────────────────────────────────────────
 */

class LogSink {
  private buffer: StructuredLogEntry[] = [];
  private readonly capacity: number;
  private readonly listeners = new Set<LogSinkListener>();

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  push(entry: StructuredLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
      }
    }
  }

  subscribe(listener: LogSinkListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  query(filter?: LogQueryFilter): StructuredLogEntry[] {
    let result = this.buffer;

    if (filter?.level !== undefined) {
      result = result.filter((e) => e.levelValue >= filter.level!);
    }
    if (filter?.module) {
      result = result.filter((e) => e.module === filter.module);
    }
    if (filter?.dagId) {
      result = result.filter((e) => e.context.dagId === filter.dagId);
    }
    if (filter?.nodeId) {
      result = result.filter((e) => e.context.nodeId === filter.nodeId);
    }
    if (filter?.traceId) {
      result = result.filter((e) => e.context.traceId === filter.traceId);
    }
    if (filter?.taskType) {
      result = result.filter((e) => e.context.taskType === filter.taskType);
    }

    const limit = filter?.limit ?? 500;
    return result.slice(-limit);
  }

  getByDagId(dagId: string, limit = 100): StructuredLogEntry[] {
    return this.query({ dagId, limit });
  }

  getByTraceId(traceId: string, limit = 100): StructuredLogEntry[] {
    return this.query({ traceId, limit });
  }

  getByModule(module: string, limit = 100): StructuredLogEntry[] {
    return this.query({ module, limit });
  }

  getRecent(limit = 500): StructuredLogEntry[] {
    return this.buffer.slice(-limit);
  }

  stats(): LogSinkStats {
    return {
      total: this.buffer.length,
      capacity: this.capacity,
      listeners: this.listeners.size,
    };
  }

  clear(): void {
    this.buffer = [];
  }
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * GlobalSingleton
 * ─────────────────────────────────────────────────────────────────────────────
 */

function getLogSinkCapacity(): number {
  const env = process.env.LOG_SINK_CAPACITY;
  if (!env) return 1000;
  const num = parseInt(env, 10);
  return isNaN(num) || num < 100 ? 1000 : num;
}

export const logSink = getOrCreateGlobal(
  '__puchipix_log_sink__',
  () => new LogSink(getLogSinkCapacity()),
);
