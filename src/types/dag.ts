import type { EventMap } from '@/lib/core/infra/event-bus';

export enum NodeState {
  PENDING = 'pending',
  READY = 'ready',
  QUEUED = 'queued',
  ALLOCATED = 'allocated',
  RUNNING = 'running',
  PAUSED = 'paused',
  VERIFYING = 'verifying',
  RESUME_VERIFY = 'resume_verify',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
}


export const VALID_TRANSITIONS: Record<NodeState, NodeState[]> = {
  [NodeState.PENDING]: [NodeState.READY, NodeState.CANCELLED],
  [NodeState.READY]: [NodeState.QUEUED, NodeState.CANCELLED, NodeState.PAUSED],
  [NodeState.QUEUED]: [NodeState.ALLOCATED, NodeState.CANCELLED, NodeState.PAUSED, NodeState.READY],
  [NodeState.ALLOCATED]: [NodeState.RUNNING, NodeState.CANCELLED, NodeState.PAUSED, NodeState.FAILED],
  [NodeState.RUNNING]: [NodeState.VERIFYING, NodeState.FAILED, NodeState.TIMEOUT, NodeState.CANCELLED, NodeState.PAUSED],
  [NodeState.PAUSED]: [NodeState.READY, NodeState.CANCELLED],
  [NodeState.VERIFYING]: [NodeState.COMPLETED, NodeState.FAILED, NodeState.PAUSED, NodeState.RESUME_VERIFY],
  [NodeState.RESUME_VERIFY]: [NodeState.VERIFYING, NodeState.COMPLETED, NodeState.FAILED, NodeState.PAUSED],
  [NodeState.COMPLETED]: [],
  [NodeState.FAILED]: [NodeState.READY],
  [NodeState.CANCELLED]: [],
  [NodeState.TIMEOUT]: [NodeState.READY],
};


export function canTransition(from: NodeState, to: NodeState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function isTerminalState(state: NodeState): boolean {
  return VALID_TRANSITIONS[state].length === 0;
}

export type TaskType = 'gallery' | 'video' | 'sniff';

export type TaskPhase = 'create' | 'scrape' | 'download' | 'finalize';

export enum TaskPriority {
  BATCH = 1,
  LOW = 3,
  NORMAL = 5,
  HIGH = 8,
  CRITICAL = 10,
}

export type SlotTypeKey = string;

export interface SlotTypeDefinition {
  key: SlotTypeKey;
  /** Showname */
  label: string;
  /** Defaultupper limit */
  defaultMax: number;
  configKey: string;
  /** Upper limitrange */
  min: number;
  max: number;
  
  releasePolicy: 'node_complete' | 'phase_complete' | 'manual' | 'event';
  releaseEvents?: string[];
  queueable: boolean;
  queueTimeout?: number;
}


export interface ResourceRequirement {
  slotType: SlotTypeKey;
  count: number;
  holdUntil: 'node_complete' | 'phase_complete';
}


export interface SlotUsage {
  slotType: string;
  current: number;
  max: number;
  available: number;
}


export type SlotPoolSnapshot = Record<string, SlotUsage>;

export interface DagNodeDefinition {
  id: string;
  /** Tasktype */
  taskType: TaskType;
  /** Phase */
  phase: TaskPhase;
  dependencies: string[];
  resourceRequirements: ResourceRequirement[];
  executor: string;
  /** Executeparameter */
  config: Record<string, unknown>;
  /** Priority */
  priority: TaskPriority;
  timeout?: number;
  /** Max retrycount */
  maxRetries?: number;
  /** RetryInterval (ms) */
  retryDelay?: number;
  transitionPolicy?: TransitionPolicy;
}


export interface DagDefinition {
  id: string;
  /** Tasktype */
  taskType: TaskType;
  /** NodeList */
  nodes: DagNodeDefinition[];
  metadata: {
    sourceUrl: string;
    providerId?: string;
    userId?: string;
    createdAt: Date;
  };
}


export interface TransitionContext {
  /** Convertreason */
  reason: string;
  triggeredBy: 'system' | 'user' | 'scheduler' | 'executor';
  error?: NodeError;
  metadata?: Record<string, unknown>;
}

/**
 * NodeError info
 */
export interface NodeError {
  /** Error code */
  code: string;
  /** Error info */
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

/**
 * State transitionLog
 */
export interface StateTransitionRecord {
  nodeId: string;
  dagId: string;
  from: NodeState;
  to: NodeState;
  timestamp: Date;
  context: TransitionContext;
}


export interface SchedulableNode {
  nodeId: string;
  dagId: string;
  taskType: TaskType;
  phase: TaskPhase;
  executorKey: string;
  priority: TaskPriority;
  resourceRequirements: ResourceRequirement[];
  config: Record<string, unknown>;
  submittedAt: Date;
}


export interface ExecutionContext {
  onProgress: (progress: NodeProgress) => void;
  onCancel: () => void;
  signal?: AbortSignal;
}

/**
 * NodeExecuteresult
 */
export interface NodeExecutionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: NodeError;
}

/**
 * NodeExecuteProgress
 */
export interface NodeProgress {
  nodeId: string;
  phase: TaskPhase;
  current: number;
  total: number;
  speed?: string;
  failed?: number;
}


export interface SchedulerStats {
  queueSize: number;
  byPriority: Record<string, number>;
  byTaskType: Record<string, number>;
  strategy: string;
}


export type DagEventType = Extract<keyof EventMap, `dag:${string}`>;

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ─────────────────────────────────────────────────────────────────────────────
 */


export interface StateMachineContext {
  readonly definition: DagNodeDefinition;
  /** CurrentRetry count */
  retryCount: number;
  lastError: NodeError | null;
  enteredAt: Date;
  accumulatedDuration: number;
  extras: Record<string, unknown>;
}


export type GuardFn = (
  ctx: StateMachineContext,
  event: { to: NodeState; context: TransitionContext },
) => boolean;


export type ActionFn = (
  ctx: StateMachineContext,
  event: { from: NodeState; to: NodeState; context: TransitionContext },
) => void | Promise<void>;


export interface TransitionRule {
  /** GoalState */
  target: NodeState;
  cond?: string;
  actions?: string[];
}


export interface TransitionPolicy {
  guards?: Record<string, GuardFn>;
  actions?: Record<string, ActionFn>;
  transitions?: Partial<Record<NodeState, TransitionRule[]>>;
  onPause?: (ctx: StateMachineContext) => NodeState | null;
  onResume?: (ctx: StateMachineContext) => NodeState[];
  onRestart?: (ctx: StateMachineContext) => NodeState | null;
  retryPolicy?: {
    priority?: (ctx: StateMachineContext) => TaskPriority;
    backoff?: (ctx: StateMachineContext) => number;
    maxAttempts?: (ctx: StateMachineContext) => number;
  };
}

/**
 * DAG Eventstructure
 */
export interface DagEvent {
  seq: number;
  type: DagEventType;
  dagId: string;
  nodeId?: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

/**
 * NodeSnapshot
 */
export interface NodeSnapshot {
  nodeId: string;
  state: NodeState;
  error: NodeError | null;
  history: StateTransitionRecord[];
  result: NodeExecutionResult | null;
}


export interface DagSnapshot {
  dagId: string;
  definition: DagDefinition;
  nodeStates: NodeSnapshot[];
  createdAt: Date;
}


export interface VerificationResult {
  status: 'passed' | 'failed' | 'skipped' | 'needs_retry';
  corrected: number;
  reason: string;
}


export class IllegalTransitionError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly fromState: NodeState,
    public readonly toState: NodeState,
  ) {
    super(`Illegal state transition: node ${nodeId} from ${fromState} to ${toState}`);
    this.name = 'IllegalTransitionError';
  }
}
