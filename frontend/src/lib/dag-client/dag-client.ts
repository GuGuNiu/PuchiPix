/**
 * DagClient — DAG taskschedulesystem API client
 *
 *
 */

import { DagClientError } from './error';
import type {
  ApiResponse,
  DagListData,
  DagDetailData,
  DagControlAction,
  DagControlData,
  DagEventsData,
  SchedulerStatsData,
  SlotStatusData,
  LogEntryResponse,
} from './types';

export interface LogQueryFilter {
  module?: string;
  dagId?: string;
  nodeId?: string;
  traceId?: string;
  level?: string;
  limit?: number;
}

export interface DagClientOptions {
  baseUrl: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export class DagClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;

  constructor(options: DagClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeout = options.timeout ?? 10000;
    this.headers = {
      Accept: 'application/json',
      ...options.headers,
    };
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   * GET /api/dag
   */
  async getAllDags(): Promise<DagListData> {
    const res = await this.get<ApiResponse<DagListData>>('/api/dag');
    return res.data;
  }

  /**
   * GET /api/dag/[dagId]
   */
  async getDag(dagId: string): Promise<DagDetailData> {
    const res = await this.get<ApiResponse<DagDetailData>>(
      `/api/dag/${encodeURIComponent(dagId)}`,
    );
    return res.data;
  }

  /**
   * GET /api/dag/[dagId]/events?limit=N&fromSeq=N
   */
  async getDagEvents(
    dagId: string,
    options?: { limit?: number; fromSeq?: number },
  ): Promise<DagEventsData> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(Math.min(options.limit, 1000)));
    }
    if (options?.fromSeq !== undefined) {
      params.set('fromSeq', String(options.fromSeq));
    }
    const query = params.toString();
    const path = `/api/dag/${encodeURIComponent(dagId)}/events${query ? `?${query}` : ''}`;
    const res = await this.get<ApiResponse<DagEventsData>>(path);
    return res.data;
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   * Pause DAG
   * POST /api/dag/[dagId] { action: 'pause' }
   */
  async pauseDag(dagId: string): Promise<DagControlData> {
    return this.controlDag(dagId, 'pause');
  }

  /**
   * POST /api/dag/[dagId] { action: 'resume', nodeId }
   */
  async resumeDag(dagId: string, nodeId?: string): Promise<DagControlData> {
    return this.controlDag(dagId, 'resume', nodeId);
  }

  /**
   * POST /api/dag/[dagId] { action: 'retry', nodeId }
   */
  async retryDag(dagId: string, nodeId?: string): Promise<DagControlData> {
    return this.controlDag(dagId, 'retry', nodeId);
  }

  /**
   * Cancel DAG
   * POST /api/dag/[dagId] { action: 'cancel' }
   */
  async cancelDag(dagId: string): Promise<DagControlData> {
    return this.controlDag(dagId, 'cancel');
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   * GET /api/dag/scheduler
   */
  async getSchedulerStats(): Promise<SchedulerStatsData> {
    const res = await this.get<ApiResponse<SchedulerStatsData>>('/api/dag/scheduler');
    return res.data;
  }

  /**
   * GET /api/dag/slots
   */
  async getSlotStatus(): Promise<SlotStatusData> {
    const res = await this.get<ApiResponse<SlotStatusData>>('/api/dag/slots');
    return res.data;
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * SSE EventStream URL
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   * GET /api/dag/stream (text/event-stream)
   */
  getStreamUrl(): string {
    return `${this.baseUrl}/api/dag/stream`;
  }

  /**
   * GET /api/logs?module=&dagId=&nodeId=&traceId=&level=&limit= (text/event-stream)
   */
  getLogStreamUrl(filter?: LogQueryFilter): string {
    const base = `${this.baseUrl}/api/logs`;
    if (!filter) return base;
    const params = new URLSearchParams();
    if (filter.module) params.set('module', filter.module);
    if (filter.dagId) params.set('dagId', filter.dagId);
    if (filter.nodeId) params.set('nodeId', filter.nodeId);
    if (filter.traceId) params.set('traceId', filter.traceId);
    if (filter.level) params.set('level', filter.level);
    if (filter.limit) params.set('limit', String(filter.limit));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * ─────────────────────────────────────────────────────────────────────────
   */

  async queryLogs(filter?: LogQueryFilter): Promise<LogEntryResponse[]> {
    const base = `${this.baseUrl}/api/logs/history`;
    const params = new URLSearchParams();
    if (filter?.module) params.set('module', filter.module);
    if (filter?.dagId) params.set('dagId', filter.dagId);
    if (filter?.nodeId) params.set('nodeId', filter.nodeId);
    if (filter?.traceId) params.set('traceId', filter.traceId);
    if (filter?.level) params.set('level', filter.level);
    if (filter?.limit) params.set('limit', String(filter.limit));
    const qs = params.toString();
    const path = `/api/logs/history${qs ? `?${qs}` : ''}`;
    const res = await this.get<ApiResponse<LogEntryResponse[]>>(path);
    return res.data;
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * ─────────────────────────────────────────────────────────────────────────
   */

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const init: RequestInit = {
        method,
        headers: {
          ...this.headers,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: controller.signal,
      };

      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }

      const res = await fetch(url, init);
      const text = await res.text();

      let json: unknown;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        throw new DagClientError(
          `响应解析失败: ${text.slice(0, 200)}`,
          res.status,
          path,
        );
      }

      if (!res.ok) {
        const errMsg =
          (json as { error?: string })?.error ||
          `HTTP ${res.status} ${res.statusText}`;
        throw new DagClientError(errMsg, res.status, path, json);
      }

      return json as T;
    } catch (err) {
      if (err instanceof DagClientError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new DagClientError(
          `请求超时 (${this.timeout}ms)`,
          undefined,
          path,
        );
      }

      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new DagClientError(
          `无法连接到服务端 ${this.baseUrl}（服务可能未启动）`,
          undefined,
          path,
        );
      }

      throw new DagClientError(
        err instanceof Error ? err.message : String(err),
        undefined,
        path,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async controlDag(
    dagId: string,
    action: DagControlAction,
    nodeId?: string,
  ): Promise<DagControlData> {
    const res = await this.post<ApiResponse<DagControlData>>(
      `/api/dag/${encodeURIComponent(dagId)}`,
      { action, nodeId },
    );
    return res.data;
  }
}
