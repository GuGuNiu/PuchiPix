export enum NodeState {
  /** 待创建：DAG 已提交，节点尚未初始化 */
  PENDING = 'pending',
  /** 就绪：前置依赖已完成，等待资源分配 */
  READY = 'ready',
  /** 排队：已提交给调度器，在优先级队列中等待 */
  QUEUED = 'queued',
  /** 资源已分配：槽位已获取，等待执行器启动 */
  ALLOCATED = 'allocated',
  /** 执行中：执行器正在运行 */
  RUNNING = 'running',
  /** 暂停中：用户主动暂停 */
  PAUSED = 'paused',
  /** 验证中：执行完成，StateReconciler 正在校验产出物 */
  VERIFYING = 'verifying',
  /** 已完成：执行成功且验证通过 */
  COMPLETED = 'completed',
  /** 失败：执行失败或验证失败 */
  FAILED = 'failed',
  /** 已取消：用户主动取消 */
  CANCELLED = 'cancelled',
  /** 超时：执行超过最大时间限制 */
  TIMEOUT = 'timeout',
}

/**
 * 状态转换合法性矩阵
 * key = 当前状态, value = 可转换到的状态列表
 */
export const VALID_TRANSITIONS: Record<NodeState, NodeState[]> = {
  [NodeState.PENDING]: [NodeState.READY, NodeState.CANCELLED],
  [NodeState.READY]: [NodeState.QUEUED, NodeState.CANCELLED, NodeState.PAUSED],
  [NodeState.QUEUED]: [NodeState.ALLOCATED, NodeState.CANCELLED, NodeState.PAUSED],
  [NodeState.ALLOCATED]: [NodeState.RUNNING, NodeState.CANCELLED, NodeState.PAUSED, NodeState.FAILED],
  [NodeState.RUNNING]: [NodeState.VERIFYING, NodeState.FAILED, NodeState.TIMEOUT, NodeState.CANCELLED, NodeState.PAUSED],
  [NodeState.PAUSED]: [NodeState.READY, NodeState.CANCELLED],
  [NodeState.VERIFYING]: [NodeState.COMPLETED, NodeState.FAILED],
  [NodeState.COMPLETED]: [],
  [NodeState.FAILED]: [NodeState.READY],
  [NodeState.CANCELLED]: [],
  [NodeState.TIMEOUT]: [NodeState.READY],
};

/**
 * 检查状态转换是否合法
 */
export function canTransition(from: NodeState, to: NodeState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * 判断是否为终态（不可再转换）
 */
export function isTerminalState(state: NodeState): boolean {
  return VALID_TRANSITIONS[state].length === 0;
}

// ============================================================================
// 任务类型与阶段
// ============================================================================

export type TaskType = 'gallery' | 'video' | 'sniff';

export type TaskPhase = 'create' | 'scrape' | 'download' | 'finalize';

/**
 * 任务优先级枚举
 *
 * 数值越大优先级越高，调度器优先选择高优先级任务
 */
export enum TaskPriority {
  /** 批量任务：用户一次性添加的大量任务，最低优先级 */
  BATCH = 1,
  /** 低优先级：后台自动重试、自动恢复的任务 */
  LOW = 3,
  /** 普通优先级：正常创建的任务 */
  NORMAL = 5,
  /** 高优先级：用户主动操作触发的任务（如手动下载） */
  HIGH = 8,
  /** 关键优先级：用户交互式操作（如单个任务重试），立即调度 */
  CRITICAL = 10,
}

// ============================================================================
// 资源管理
// ============================================================================

export type SlotTypeKey = string;

/**
 * 槽位类型定义 — 通过注册机制声明，无需修改核心代码
 */
export interface SlotTypeDefinition {
  /** 槽位类型标识（唯一键） */
  key: SlotTypeKey;
  /** 显示名称 */
  label: string;
  /** 默认上限 */
  defaultMax: number;
  /** 配置键名（AppConfig 表中的 key） */
  configKey: string;
  /** 上限范围 */
  min: number;
  max: number;
  /**
   * 释放时机定义
   * - 'node_complete': 节点完成时释放（默认）
   * - 'phase_complete': 阶段完成时释放
   * - 'manual': 需要手动释放
   * - 'event': 事件驱动释放（指定事件名）
   */
  releasePolicy: 'node_complete' | 'phase_complete' | 'manual' | 'event';
  /** 如果 releasePolicy = 'event'，指定触发释放的事件列表 */
  releaseEvents?: string[];
  /** 是否支持排队等待 */
  queueable: boolean;
  /** 排队超时时间（ms），超时后自动取消 */
  queueTimeout?: number;
}

/**
 * 资源需求声明 — DAG 节点声明式资源需求
 */
export interface ResourceRequirement {
  /** 槽位类型标识 */
  slotType: SlotTypeKey;
  /** 需要的数量（通常为 1） */
  count: number;
  /** 持有到何时 */
  holdUntil: 'node_complete' | 'phase_complete';
}

/**
 * 槽位使用情况
 */
export interface SlotUsage {
  slotType: string;
  current: number;
  max: number;
  available: number;
}

/**
 * 槽位池快照 — 所有槽位类型的当前状态
 */
export type SlotPoolSnapshot = Record<string, SlotUsage>;

// ============================================================================
// DAG 定义
// ============================================================================

/**
 * DAG 节点定义（声明式）
 */
export interface DagNodeDefinition {
  /** 节点唯一 ID */
  id: string;
  /** 任务类型 */
  taskType: TaskType;
  /** 阶段 */
  phase: TaskPhase;
  /** 前置节点 ID 列表 */
  dependencies: string[];
  /** 资源需求（声明式） */
  resourceRequirements: ResourceRequirement[];
  /** 执行器标识 */
  executor: string;
  /** 执行参数 */
  config: Record<string, unknown>;
  /** 优先级 */
  priority: TaskPriority;
  /** 超时时间 (ms) */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试间隔 (ms) */
  retryDelay?: number;
}

/**
 * DAG 定义
 */
export interface DagDefinition {
  /** DAG 唯一 ID */
  id: string;
  /** 任务类型 */
  taskType: TaskType;
  /** 节点列表 */
  nodes: DagNodeDefinition[];
  /** 元数据 */
  metadata: {
    sourceUrl: string;
    providerId?: string;
    userId?: string;
    createdAt: Date;
  };
}

// ============================================================================
// 状态转换与错误
// ============================================================================

/**
 * 状态转换上下文
 */
export interface TransitionContext {
  /** 转换原因 */
  reason: string;
  /** 触发者 */
  triggeredBy: 'system' | 'user' | 'scheduler' | 'executor';
  /** 错误信息（失败时） */
  error?: NodeError;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 节点错误信息
 */
export interface NodeError {
  /** 错误码 */
  code: string;
  /** 错误信息 */
  message: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 详细信息 */
  details?: Record<string, unknown>;
}

/**
 * 状态转换记录
 */
export interface StateTransitionRecord {
  nodeId: string;
  dagId: string;
  from: NodeState;
  to: NodeState;
  timestamp: Date;
  context: TransitionContext;
}

// ============================================================================
// 调度
// ============================================================================

/**
 * 可调度节点 — 提交给 SchedulerEngine 的节点信息
 */
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

/**
 * 执行上下文 — 传递给 TaskExecutor 的上下文
 */
export interface ExecutionContext {
  onProgress: (progress: NodeProgress) => void;
  onCancel: () => void;
  signal?: AbortSignal;
}

/**
 * 节点执行结果
 */
export interface NodeExecutionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: NodeError;
}

/**
 * 节点执行进度
 */
export interface NodeProgress {
  nodeId: string;
  phase: TaskPhase;
  current: number;
  total: number;
  speed?: string;
  failed?: number;
}

/**
 * 调度器统计信息
 */
export interface SchedulerStats {
  queueSize: number;
  byPriority: Record<string, number>;
  byTaskType: Record<string, number>;
  strategy: string;
}

// ============================================================================
// 事件与快照
// ============================================================================

/**
 * DAG 事件类型
 */
export type DagEventType =
  | 'dag:created'
  | 'dag:cancelled'
  | 'dag:completed'
  | 'dag:nodeStateChanged'
  | 'dag:nodeCompleted'
  | 'dag:nodeFailed'
  | 'dag:nodeRetrying'
  | 'dag:schedulingDecision'
  | 'dag:resourceAllocated'
  | 'dag:resourceReleased'
  | 'dag:configUpdated'
  | 'dag:systemStarted'
  | 'dag:systemStopped';

/**
 * DAG 事件结构
 */
export interface DagEvent {
  /** 单调递增序列号 */
  seq: number;
  type: DagEventType;
  dagId: string;
  nodeId?: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

/**
 * 节点快照
 */
export interface NodeSnapshot {
  nodeId: string;
  state: NodeState;
  error: NodeError | null;
  history: StateTransitionRecord[];
  result: NodeExecutionResult | null;
}

/**
 * DAG 快照 — 用于 EventStore 恢复
 */
export interface DagSnapshot {
  dagId: string;
  definition: DagDefinition;
  nodeStates: NodeSnapshot[];
  createdAt: Date;
}

// ============================================================================
// 校验
// ============================================================================

/**
 * 校验结果
 */
export interface VerificationResult {
  status: 'passed' | 'failed' | 'skipped';
  /** 修正的记录数 */
  corrected: number;
  reason: string;
}

// ============================================================================
// 异常
// ============================================================================

/**
 * 非法状态转换异常
 */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly fromState: NodeState,
    public readonly toState: NodeState,
  ) {
    super(`非法状态转换: 节点 ${nodeId} 从 ${fromState} 到 ${toState}`);
    this.name = 'IllegalTransitionError';
  }
}
