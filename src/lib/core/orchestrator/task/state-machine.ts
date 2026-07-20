import {
  NodeState,
  canTransition,
  IllegalTransitionError,
  type TransitionContext,
  type StateTransitionRecord,
  type NodeError,
  type TaskPhase,
  type TaskType,
  type DagNodeDefinition,
  type TransitionPolicy,
  type StateMachineContext,
} from '@/types/dag';
import type { EventStore } from '../../infra/event-store';
import { loggers } from '../../infra/logger';
import { taskTypeRegistry } from './type-registry';

const logger = loggers.taskStateMachine();

const MAX_HISTORY_LENGTH = 100;

export function mapNodeStateToDBStatus(
  state: NodeState,
  phase: TaskPhase,
): string {
  switch (state) {
    case NodeState.PENDING:
      return 'pending';
    case NodeState.READY:
    case NodeState.QUEUED:
      return phase === 'download' ? 'download_pending' : 'scrape_pending';
    case NodeState.ALLOCATED:
    case NodeState.RUNNING:
      return phase === 'scrape' ? 'scraping' : 'downloading';
    case NodeState.PAUSED:
      return 'paused';
    case NodeState.VERIFYING:
    case NodeState.RESUME_VERIFY:
      return phase === 'download' ? 'downloading' : 'scraping';
    case NodeState.COMPLETED:
      return 'completed';
    case NodeState.FAILED:
      return 'failed';
    case NodeState.CANCELLED:
      return 'cancelled';
    case NodeState.TIMEOUT:
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * DefaultAggregationStrategy——not Register TaskType fallback
 */
function defaultAggregate(nodes: Array<{ state: NodeState; phase: TaskPhase; error: NodeError | null }>): string {
  if (nodes.some((n) => n.state === NodeState.CANCELLED)) return 'cancelled';
  if (nodes.some((n) => n.state === NodeState.FAILED)) return 'failed';
  if (nodes.some((n) => n.state === NodeState.TIMEOUT)) return 'failed';
  if (nodes.some((n) => n.state === NodeState.PAUSED)) return 'paused';
  if (nodes.every((n) => n.state === NodeState.COMPLETED)) return 'completed';
  return 'pending';
}



export function deserializeNodeState(value: string): NodeState {
  const knownStates = new Set(Object.values(NodeState));
  if (knownStates.has(value as NodeState)) {
    return value as NodeState;
  }
  loggers.taskStateMachine().warn(`Unknown node state "${value}", falling back to FAILED`);
  return NodeState.FAILED;
}

export function aggregateTaskStatus(
  taskType: TaskType,
  nodes: Array<{ state: NodeState; phase: TaskPhase; error: NodeError | null }>,
): string {
  const aggregator = taskTypeRegistry.getAggregator(taskType);
  if (aggregator) {
    return aggregator(nodes);
  }
  return defaultAggregate(nodes);
}

export class TaskStateMachine {
  private _state: NodeState;
  private readonly _nodeId: string;
  private readonly _dagId: string;
  private readonly _phase: TaskPhase;
  private readonly _policy: TransitionPolicy;
  private _context: StateMachineContext;
  private _history: StateTransitionRecord[] = [];
  private _error: NodeError | null = null;
  private _enteredAt: Partial<Record<NodeState, Date>> = {};

  constructor(
    dagId: string,
    nodeId: string,
    phase: TaskPhase,
    definition: DagNodeDefinition,
    options: {
      initialState?: NodeState;
      policy?: TransitionPolicy;
    } = {},
  ) {
    this._dagId = dagId;
    this._nodeId = nodeId;
    this._phase = phase;
    this._state = options.initialState ?? NodeState.PENDING;
    this._policy = options.policy ?? definition.transitionPolicy ?? {};
    this._context = {
      definition,
      retryCount: 0,
      lastError: null,
      enteredAt: new Date(),
      accumulatedDuration: 0,
      extras: {},
    };
    this._enteredAt[this._state] = new Date();
  }

  get state(): NodeState {
    return this._state;
  }

  get error(): NodeError | null {
    return this._error;
  }

  get nodeId(): string {
    return this._nodeId;
  }

  get dagId(): string {
    return this._dagId;
  }

  get phase(): TaskPhase {
    return this._phase;
  }

  get context(): Readonly<StateMachineContext> {
    return this._context;
  }

  /** Reset retry count — used when user manually retries to bypass maxAttempts */
  resetRetryCount(): void {
    this._context.retryCount = 0;
  }

  async transition(
    toState: NodeState,
    context: TransitionContext,
    eventStore?: EventStore,
  ): Promise<void> {
    const resolvedTo = this.resolveTargetState(toState, context);

    if (!this.canTransitionTo(resolvedTo, context)) {
      throw new IllegalTransitionError(this._nodeId, this._state, resolvedTo);
    }

    const timestamp = new Date();
    const record: StateTransitionRecord = {
      nodeId: this._nodeId,
      dagId: this._dagId,
      from: this._state,
      to: resolvedTo,
      timestamp,
      context,
    };
    this._history.push(record);
    if (this._history.length > MAX_HISTORY_LENGTH) {
      this._history.shift();
    }

    const prevState = this._state;

    const prevEnteredAt = this._enteredAt[prevState];
    if (prevEnteredAt) {
      this._context.accumulatedDuration += timestamp.getTime() - prevEnteredAt.getTime();
    }

    this._state = resolvedTo;
    this._enteredAt[resolvedTo] = timestamp;
    this._context.enteredAt = timestamp;

    if (resolvedTo === NodeState.FAILED || resolvedTo === NodeState.TIMEOUT) {
      this._error = context.error || null;
      this._context.lastError = context.error || null;
    }

    if (
      (prevState === NodeState.FAILED || prevState === NodeState.TIMEOUT) &&
      resolvedTo === NodeState.READY
    ) {
      this._context.retryCount++;
    }

    if (eventStore) {
      await eventStore.append({
        seq: 0,
        type: 'dag:nodeStateChanged',
        dagId: this._dagId,
        nodeId: this._nodeId,
        timestamp,
        payload: {
          from: prevState,
          to: resolvedTo,
          context,
        },
      });
    }

    logger.info(
      `Node ${this._nodeId} state transition: ${prevState} -> ${resolvedTo} (${context.reason})`,
    );

    await this.runActions(prevState, resolvedTo, context);
  }

  canTransitionTo(toState: NodeState, context?: TransitionContext): boolean {
    const rules = this._policy.transitions?.[this._state];
    if (rules && rules.length > 0 && context) {
      const hasMatch = rules.some((rule) => {
        if (!rule.cond) return true;
        const guard = this._policy.guards?.[rule.cond];
        return guard ? guard(this._context, { to: toState, context }) : false;
      });
      if (hasMatch) return true;
    }
    return canTransition(this._state, toState);
  }

  
  private resolveTargetState(toState: NodeState, context: TransitionContext): NodeState {
    const rules = this._policy.transitions?.[this._state];
    if (!rules || rules.length === 0) {
      return toState;
    }
    for (const rule of rules) {
      if (!rule.cond) return rule.target;
      const guard = this._policy.guards?.[rule.cond];
      if (!guard) {
        logger.warn(`Guard "${rule.cond}" not found in transitionPolicy, skipping`);
        continue;
      }
      if (guard(this._context, { to: toState, context })) {
        return rule.target;
      }
    }
    return toState;
  }

  
  private async runActions(
    from: NodeState,
    to: NodeState,
    context: TransitionContext,
  ): Promise<void> {
    const rules = this._policy.transitions?.[from];
    const matchedRule = rules?.find((r) => r.target === to);
    const actionNames = matchedRule?.actions ?? [];
    for (const actionName of actionNames) {
      const action = this._policy.actions?.[actionName];
      if (!action) {
        logger.warn(`Action "${actionName}" not found in transitionPolicy, skipping`);
        continue;
      }
      try {
        await action(this._context, { from, to, context });
      } catch (err) {
        logger.error(`Action "${actionName}" failed`, { error: err });
      }
    }
  }

  getHistory(): StateTransitionRecord[] {
    return [...this._history];
  }

  /**
   * FromSnapshotResumehistoryLogandErrorState
   *
   * - Resume `_error` field（FAILED/TIMEOUT Node Error info）
   *
   */
  restoreFromSnapshot(
    history: StateTransitionRecord[],
    error: NodeError | null = null,
  ): void {
    this._history = history.length > MAX_HISTORY_LENGTH
      ? history.slice(-MAX_HISTORY_LENGTH)
      : [...history];
    this._error = error;

    this._enteredAt = {};
    for (const record of this._history) {
      this._enteredAt[record.to] = record.timestamp;
    }

    if (this._history.length === 0) {
      this._enteredAt[this._state] = new Date();
    }

    // FromHistoryRecordrestorecontextStatus
    this._context.lastError = error;
    this._context.retryCount = history.filter(
      (r) =>
        (r.from === NodeState.FAILED || r.from === NodeState.TIMEOUT) &&
        r.to === NodeState.READY,
    ).length;
    this._context.enteredAt =
      this._enteredAt[this._state] ?? new Date();
  }

  getDurationInState(state: NodeState): number | null {
    const entered = this._enteredAt[state];
    if (!entered) return null;
    const exited = this._history.find((r) => r.from === state)?.timestamp || new Date();
    return exited.getTime() - entered.getTime();
  }

  getEnteredAt(state: NodeState): Date | undefined {
    return this._enteredAt[state];
  }

  getDBStatus(): string {
    return mapNodeStateToDBStatus(this._state, this._phase);
  }
}
