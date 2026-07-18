import {
  NodeState,
  canTransition,
  IllegalTransitionError,
  type TransitionContext,
  type StateTransitionRecord,
  type NodeError,
  type TaskPhase,
} from '@/types/dag';
import type { EventStore } from '../infra/event-store';

/** 鐘舵€佸巻鍙叉渶澶ч暱搴?*/
const MAX_HISTORY_LENGTH = 100;

/**
 * 灏嗚妭鐐圭姸鎬佹槧灏勫埌 DB 浠诲姟鐘舵€?
 */
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
 * 浠?DAG 鑺傜偣鐘舵€佽仛鍚堝嚭浠诲姟鏁翠綋鐘舵€?
 */
export function aggregateTaskStatus(
  nodes: Array<{ state: NodeState; phase: TaskPhase; error: NodeError | null }>,
): string {
  // 浼樺厛绾э細cancelled > failed > timeout > not_found > paused >
  //         downloading > download_pending > scraping > scrape_pending > pending > completed

  if (nodes.some((n) => n.state === NodeState.CANCELLED)) return 'cancelled';
  if (nodes.some((n) => n.state === NodeState.FAILED)) {
    // not_found 鏄瘑鍒妭鐐圭殑鐗瑰畾澶辫触
    const scrapeNode = nodes.find((n) => n.phase === 'scrape');
    if (scrapeNode?.state === NodeState.FAILED && scrapeNode?.error?.code === 'NOT_FOUND') {
      return 'not_found';
    }
    return 'failed';
  }
  if (nodes.some((n) => n.state === NodeState.TIMEOUT)) return 'failed';

  if (nodes.some((n) => n.state === NodeState.PAUSED)) return 'paused';

  const downloadNode = nodes.find((n) => n.phase === 'download');
  if (
    downloadNode &&
    (downloadNode.state === NodeState.RUNNING ||
      downloadNode.state === NodeState.ALLOCATED ||
      downloadNode.state === NodeState.VERIFYING)
  ) {
    return 'downloading';
  }
  if (
    downloadNode &&
    (downloadNode.state === NodeState.QUEUED || downloadNode.state === NodeState.READY)
  ) {
    return 'download_pending';
  }

  const scrapeNode = nodes.find((n) => n.phase === 'scrape');
  if (
    scrapeNode &&
    (scrapeNode.state === NodeState.RUNNING ||
      scrapeNode.state === NodeState.ALLOCATED ||
      scrapeNode.state === NodeState.VERIFYING)
  ) {
    return 'scraping';
  }

  if (
    scrapeNode &&
    (scrapeNode.state === NodeState.QUEUED || scrapeNode.state === NodeState.READY)
  ) {
    return 'scrape_pending';
  }

  if (nodes.every((n) => n.state === NodeState.COMPLETED)) return 'completed';

  return 'pending';
}

export class TaskStateMachine {
  private _state: NodeState;
  private readonly _nodeId: string;
  private readonly _dagId: string;
  private readonly _phase: TaskPhase;
  private _history: StateTransitionRecord[] = [];
  private _error: NodeError | null = null;
  private _enteredAt: Partial<Record<NodeState, Date>> = {};

  constructor(
    dagId: string,
    nodeId: string,
    phase: TaskPhase,
    initialState: NodeState = NodeState.PENDING,
  ) {
    this._dagId = dagId;
    this._nodeId = nodeId;
    this._phase = phase;
    this._state = initialState;
    this._enteredAt[initialState] = new Date();
  }

  /** 褰撳墠鐘舵€侊紙鍙锛?*/
  get state(): NodeState {
    return this._state;
  }

  /** 褰撳墠閿欒淇℃伅锛堝彧璇伙級 */
  get error(): NodeError | null {
    return this._error;
  }

  /** 鑺傜偣 ID */
  get nodeId(): string {
    return this._nodeId;
  }

  /** DAG ID */
  get dagId(): string {
    return this._dagId;
  }

  /** 闃舵 */
  get phase(): TaskPhase {
    return this._phase;
  }

  /**
   * 鐘舵€佽浆鎹紙鏍稿績鏂规硶锛?
   *
   * @param toState - 鐩爣鐘舵€?
   * @param context - 杞崲涓婁笅鏂囷紙璋併€佷负浠€涔堛€佷粈涔堟椂闂达級
   * @param eventStore - 浜嬩欢瀛樺偍锛堝彲閫夛紝浼犲叆鍒欒拷鍔犱簨浠讹級
   * @throws {IllegalTransitionError} 濡傛灉杞崲涓嶅悎娉?
   */
  async transition(
    toState: NodeState,
    context: TransitionContext,
    eventStore?: EventStore,
  ): Promise<void> {
    // 1. 鏍￠獙鍚堟硶鎬?
    if (!canTransition(this._state, toState)) {
      throw new IllegalTransitionError(this._nodeId, this._state, toState);
    }

    // 2. 璁板綍鍘嗗彶
    const timestamp = new Date();
    const record: StateTransitionRecord = {
      nodeId: this._nodeId,
      dagId: this._dagId,
      from: this._state,
      to: toState,
      timestamp,
      context,
    };
    this._history.push(record);
    if (this._history.length > MAX_HISTORY_LENGTH) {
      this._history.shift();
    }

    // 3. 鏇存柊鐘舵€?
    const prevState = this._state;
    this._state = toState;
    this._enteredAt[toState] = timestamp;

    // 4. 濡傛灉鏄け璐?瓒呮椂鐘舵€侊紝璁板綍閿欒
    if (toState === NodeState.FAILED || toState === NodeState.TIMEOUT) {
      this._error = context.error || null;
    }

    // 5. 鍚屾杩藉姞浜嬩欢鍒?EventStore锛堜繚璇侀『搴忥級
    if (eventStore) {
      await eventStore.append({
        seq: 0, // EventStore 浼氬垎閰嶇湡瀹?seq
        type: 'dag:nodeStateChanged',
        dagId: this._dagId,
        nodeId: this._nodeId,
        timestamp,
        payload: {
          from: prevState,
          to: toState,
          context,
        },
      });
    }

    console.log(
      `[FSM] 鑺傜偣 ${this._nodeId} 鐘舵€佽浆鎹? ${prevState} 鈫?${toState} (${context.reason})`,
    );
  }

  /**
   * 妫€鏌ユ槸鍚﹀彲浠ヨ浆鎹㈠埌鐩爣鐘舵€?
   */
  canTransitionTo(toState: NodeState): boolean {
    return canTransition(this._state, toState);
  }

  /**
   * 鑾峰彇鐘舵€佸巻鍙?
   */
  getHistory(): StateTransitionRecord[] {
    return [...this._history];
  }

  /**
   * 鑾峰彇鍦ㄦ煇涓姸鎬佺殑鎸佺画鏃堕棿锛坢s锛?
   */
  getDurationInState(state: NodeState): number | null {
    const entered = this._enteredAt[state];
    if (!entered) return null;
    const exited = this._history.find((r) => r.from === state)?.timestamp || new Date();
    return exited.getTime() - entered.getTime();
  }

  /**
   * 鑾峰彇褰撳墠鐘舵€佺殑杩涘叆鏃堕棿
   */
  getEnteredAt(state: NodeState): Date | undefined {
    return this._enteredAt[state];
  }

  /**
   * 鑾峰彇褰撳墠鐘舵€佹槧灏勭殑 DB 鐘舵€?
   */
  getDBStatus(): string {
    return mapNodeStateToDBStatus(this._state, this._phase);
  }
}
