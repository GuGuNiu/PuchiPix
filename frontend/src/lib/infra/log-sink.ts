import type { StructuredLogEntry } from "./log-entry";

export type LogSinkListener = (entry: StructuredLogEntry) => void;

export interface LogQueryFilter {
  levelValue?: number;
  module?: string;
  dagId?: string;
  nodeId?: string;
  traceId?: string;
  taskType?: string;
  limit?: number;
}

/**
 * Thread-safe ring buffer holding structured log entries.
 *
 * Used by the LogSinkHandler for dual-write (console + buffer) and
 * exposed via /api/logs for real-time SSE streaming and historical query.
 * Mirrors the Go backend LogSink API for CLI compatibility.
 */
export class LogSink {
  private buffer: StructuredLogEntry[] = [];
  private capacity: number;
  private listeners = new Map<number, LogSinkListener>();
  private nextListenerId = 0;

  constructor(capacity = 1000) {
    this.capacity = Math.max(100, capacity);
  }

  /** Push an entry, evicting oldest when full, then fan out to subscribers. */
  push(entry: StructuredLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer = this.buffer.slice(this.buffer.length - this.capacity);
    }

    for (const fn of this.listeners.values()) {
      try {
        fn(entry);
      } catch {
        // Prevent faulty listener from crashing the logger
      }
    }
  }

  /** Subscribe to new entries. Returns unsubscribe function. */
  subscribe(fn: LogSinkListener): () => void {
    const id = this.nextListenerId++;
    this.listeners.set(id, fn);
    return () => {
      this.listeners.delete(id);
    };
  }

  /** Query entries matching the filter, newest-first up to limit. */
  query(filter: LogQueryFilter): StructuredLogEntry[] {
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 500;
    const result: StructuredLogEntry[] = [];

    for (let i = this.buffer.length - 1; i >= 0 && result.length < limit; i--) {
      const e = this.buffer[i];
      if (filter.levelValue != null && e.levelValue < filter.levelValue) continue;
      if (filter.module && e.module !== filter.module) continue;
      if (filter.dagId && e.context.dagId !== filter.dagId) continue;
      if (filter.nodeId && e.context.nodeId !== filter.nodeId) continue;
      if (filter.traceId && e.context.traceId !== filter.traceId) continue;
      if (filter.taskType && e.context.taskType !== filter.taskType) continue;
      result.push(e);
    }

    return result;
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
    const start = Math.max(0, this.buffer.length - limit);
    return this.buffer.slice(start);
  }

  stats(): { total: number; capacity: number; listeners: number } {
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
