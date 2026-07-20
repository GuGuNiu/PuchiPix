/**
 * DAG SSE EventStreamclient
 *
 */

import type { SseEventType } from './types';

export interface SseEvent {
  type: SseEventType;
  data: unknown;
}

export type SseEventHandler = (event: SseEvent) => void;

export class SseClient {
  private abortController: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly options: {
      headers?: Record<string, string>;
      onEvent: SseEventHandler;
      onError?: (err: Error) => void;
      onClose?: () => void;
    } = { onEvent: () => {} },
  ) {}

  
  async connect(): Promise<void> {
    this.abortController = new AbortController();

    try {
      const res = await fetch(this.url, {
        headers: {
          Accept: 'text/event-stream',
          ...this.options.headers,
        },
        signal: this.abortController.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`SSE connection failed: HTTP ${res.status} ${res.statusText}`);
      }

      this.reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!this.closed) {
        const { done, value } = await this.reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentEvent) {
            this.dispatchEvent(currentEvent, currentData);
            currentEvent = '';
            currentData = '';
          }
        }
      }
    } catch (err) {
      if (this.closed) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'AbortError') return;
      this.options.onError?.(error);
    } finally {
      this.options.onClose?.();
    }
  }

  private dispatchEvent(type: string, dataStr: string): void {
    if (type === 'keepalive' || dataStr === '') return;

    let data: unknown;
    try {
      data = JSON.parse(dataStr);
    } catch {
      data = dataStr;
    }

    this.options.onEvent({
      type: type as SseEventType,
      data,
    });
  }

  /**
   * Close SSE Connect
   */
  close(): void {
    this.closed = true;
    this.abortController?.abort();
    this.reader = null;
  }
}
