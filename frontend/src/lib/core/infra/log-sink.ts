import type { StructuredLogEntry } from './logger';

export interface LogQuery {
  module?: string;
  dagId?: string;
  nodeId?: string;
  traceId?: string;
  level?: string;
  limit?: number;
}

type LogListener = (entry: StructuredLogEntry) => void;

export class LogSink {
  private buffer: StructuredLogEntry[] = [];
  private capacity: number;
  private listeners = new Set<LogListener>();

  constructor(capacity?: number) {
    const envCap = typeof process !== 'undefined' ? process.env?.LOG_SINK_CAPACITY : undefined;
    const parsed = envCap ? parseInt(envCap, 10) : undefined;
    this.capacity = parsed && parsed >= 100 ? parsed : (capacity ?? 1000);
  }

  push(entry: StructuredLogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length > this.capacity) {
      this.buffer = this.buffer.slice(-this.capacity);
    }
    // Notify listeners
    for (const listener of this.listeners) {
      // Swallow listener errors
      try {
        listener(entry);
      } catch {
      }
    }
  }

  query(query: LogQuery = {}): StructuredLogEntry[] {
    let results = [...this.buffer];

    if (query.module) {
      results = results.filter((e) => e.module === query.module);
    }
    if (query.dagId) {
      results = results.filter((e) => e.context.dagId === query.dagId);
    }
    if (query.nodeId) {
      results = results.filter((e) => e.context.nodeId === query.nodeId);
    }
    if (query.traceId) {
      results = results.filter((e) => e.context.traceId === query.traceId);
    }
    if (query.level) {
      const level = query.level.toUpperCase();
      results = results.filter((e) => e.level === level);
    }
    if (query.limit && query.limit > 0) {
      results = results.slice(-query.limit);
    }

    return results;
  }

  getByDagId(dagId: string): StructuredLogEntry[] {
    return this.query({ dagId });
  }

  getByTraceId(traceId: string): StructuredLogEntry[] {
    return this.query({ traceId });
  }

  getByModule(module: string): StructuredLogEntry[] {
    return this.query({ module });
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current buffer size */
  get size(): number {
    return this.buffer.length;
  }

  /** Clear all buffered entries */
  clear(): void {
    this.buffer = [];
  }
}

// Global singleton
export const logSink = new LogSink();
