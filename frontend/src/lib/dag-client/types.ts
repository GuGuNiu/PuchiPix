

import type {
  NodeState,
  TaskType,
  TaskPhase,
  TaskPriority,
  NodeError,
  NodeExecutionResult,
  DagEventType,
  ResourceRequirement,
} from '@/types/dag';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * DAG List (GET /api/dag)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface NodeSummary {
  nodeId: string;
  state: NodeState;
  error: NodeError | null;
  hasResult: boolean;
  historyCount: number;
  lastTransition: {
    from: NodeState;
    to: NodeState;
    reason: string;
    triggeredBy: string;
    timestamp: string;
  } | null;
}

export interface DagSummary {
  dagId: string;
  taskType: TaskType;
  sourceUrl: string;
  createdAt: string;
  nodeCount: number;
  progress: {
    completed: number;
    failed: number;
    running: number;
    paused: number;
    queued: number;
  };
  nodes: NodeSummary[];
}

export interface SlotUsageResponse {
  slotType: string;
  current: number;
  max: number;
  available: number;
}

export interface SchedulerStatsResponse {
  queueSize: number;
  byPriority: Record<string, number>;
  byTaskType: Record<string, number>;
  strategy: string;
}

export interface DagStatsResponse {
  totalDags: number;
  activeDags: number;
  totalNodes: number;
}

export interface DagListData {
  dags: DagSummary[];
  stats: DagStatsResponse & {
    scheduler: SchedulerStatsResponse;
    slots: Record<string, SlotUsageResponse>;
  };
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface DagNodeDefinitionResponse {
  id: string;
  phase: TaskPhase;
  executor: string;
  priority: TaskPriority;
  dependencies: string[];
  resourceRequirements: ResourceRequirement[];
  timeout?: number;
  maxRetries?: number;
}

export interface StateTransitionRecordResponse {
  from: NodeState;
  to: NodeState;
  timestamp: string;
  reason: string;
  triggeredBy: string;
  error?: NodeError;
}

export interface NodeDetailResponse {
  nodeId: string;
  state: NodeState;
  error: NodeError | null;
  result: NodeExecutionResult | null;
  history: StateTransitionRecordResponse[];
}

export interface DagDetailData {
  dagId: string;
  taskType: TaskType;
  sourceUrl: string;
  providerId?: string;
  createdAt: string;
  definition: {
    nodeCount: number;
    nodes: DagNodeDefinitionResponse[];
  };
  nodes: NodeDetailResponse[];
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type DagControlAction = 'pause' | 'resume' | 'retry' | 'cancel';

export interface DagControlData {
  dagId: string;
  action: DagControlAction;
  snapshot: DagDetailData | null;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * DAG Eventhistory (GET /api/dag/[dagId]/events)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface DagEventResponse {
  seq: number;
  type: DagEventType;
  dagId: string;
  nodeId?: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface DagEventsData {
  dagId: string;
  events: DagEventResponse[];
  totalEvents: number;
  currentSeq: number;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type SchedulerStatsData = SchedulerStatsResponse;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface SlotStatsResponse {
  totalSlots: number;
  usedSlots: number;
  availableSlots: number;
  utilizationRate: number;
}

export interface DownloadConcurrencyResponse {
  tsSegmentConcurrent: number;
  galleryImageConcurrent: number;
}

export interface SlotStatusData {
  snapshot: Record<string, SlotUsageResponse>;
  stats: SlotStatsResponse;
  downloadConcurrency: DownloadConcurrencyResponse;
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SSE EventStream (GET /api/dag/stream)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface SseInitialEvent {
  dags: DagSummary[];
  count: number;
}

export interface SseStatsEvent {
  dags: DagStatsResponse;
  scheduler: SchedulerStatsResponse;
  slots: Record<string, SlotUsageResponse>;
  timestamp: string;
}

export interface SseNodeStateChangedEvent {
  dagId: string;
  nodeId: string;
  from: NodeState;
  to: NodeState;
  timestamp: string;
}

export interface SseDagCreatedEvent {
  dagId: string;
  taskType: TaskType;
  sourceUrl?: string;
  createdAt?: string;
  nodes?: NodeSummary[];
}

export interface SseDagCompletedEvent {
  dagId: string;
  snapshot: DagDetailData | null;
  timestamp: string;
}

export interface SseNodeCompletedEvent {
  dagId: string;
  nodeId: string;
  result: NodeExecutionResult;
  timestamp: string;
}

export interface SseNodeFailedEvent {
  dagId: string;
  nodeId: string;
  error: NodeError;
  timestamp: string;
}

export interface SseSchedulingDecisionEvent {
  dagId: string;
  nodeId: string;
  strategy: string;
  reason: string;
  timestamp: string;
}

export interface SseResourceEvent {
  dagId: string;
  nodeId: string;
  resources: ResourceRequirement[] | string[];
  timestamp: string;
}

export interface SseDagPausedEvent {
  dagId: string;
  pausedCount: number;
  timestamp: string;
}

export interface SseDagResumedEvent {
  dagId: string;
  resumedCount: number;
  timestamp: string;
}

export interface SseNodeProgressEvent {
  dagId: string;
  nodeId: string;
  phase: string;
  current: number;
  total: number;
  speed?: string;
  failed?: number;
  timestamp: string;
}

export interface SseNodeRetryingEvent {
  dagId: string;
  nodeId: string;
  retryCount: number;
  error: { code: string; message: string };
  timestamp: string;
}

export type SseEventType =
  | 'initial'
  | 'stats'
  | 'dag:created'
  | 'dag:completed'
  | 'dag:cancelled'
  | 'dag:paused'
  | 'dag:resumed'
  | 'dag:nodeStateChanged'
  | 'dag:nodeCompleted'
  | 'dag:nodeFailed'
  | 'dag:nodeProgress'
  | 'dag:nodeRetrying'
  | 'dag:schedulingDecision'
  | 'dag:resourceAllocated'
  | 'dag:resourceReleased'
  | 'dag:event'
  | 'keepalive'
  | 'history'
  | 'log';

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Logsystem (GET /api/logs)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface LogEntryResponse {
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
