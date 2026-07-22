/**
 * DAG API client SDK
 *
 */

import { DagClient } from './dag-client';
export { DagClient } from './dag-client';
export type { DagClientOptions, LogQueryFilter } from './dag-client';

export { SseClient } from './sse-client';
export type { SseEvent, SseEventHandler } from './sse-client';

export { DagClientError } from './error';

export { getNodeStateI18nKey } from './state-labels';

export type {
  ApiResponse,
  NodeSummary,
  DagSummary,
  SlotUsageResponse,
  SchedulerStatsResponse,
  DagStatsResponse,
  DagListData,
  DagNodeDefinitionResponse,
  StateTransitionRecordResponse,
  NodeDetailResponse,
  DagDetailData,
  DagControlAction,
  DagControlData,
  DagEventResponse,
  DagEventsData,
  SchedulerStatsData,
  SlotStatsResponse,
  DownloadConcurrencyResponse,
  SlotStatusData,
  SseInitialEvent,
  SseStatsEvent,
  SseNodeStateChangedEvent,
  SseDagCreatedEvent,
  SseDagCompletedEvent,
  SseNodeCompletedEvent,
  SseNodeFailedEvent,
  SseSchedulingDecisionEvent,
  SseResourceEvent,
  SseDagPausedEvent,
  SseDagResumedEvent,
  SseNodeProgressEvent,
  SseNodeRetryingEvent,
  SseEventType,
  LogEntryResponse,
} from './types';

/**
 *
 * @example
 * ```ts
 * import { createDagClient } from '@/lib/dag-client';
 *
 * const client = createDagClient('localhost', 10540);
 * const dags = await client.getAllDags();
 * ```
 */
export function createDagClient(
  host: string = 'localhost',
  port: string | number = 10540,
  options?: { timeout?: number; headers?: Record<string, string> },
): DagClient {
  return new DagClient({
    baseUrl: `http://${host}:${port}`,
    timeout: options?.timeout,
    headers: options?.headers,
  });
}
