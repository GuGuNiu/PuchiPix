import { getOrCreateGlobal } from '../infra/global-singleton';
import { slotPool } from './slot-pool';
import { eventStore } from '../infra/event-store';
import { stateReconciler, type DagNodeForVerification } from './state-reconciler';
import { taskExecutorRegistry } from './task-executor';
import { PriorityFairStrategy } from './scheduling-strategy';
import type { SchedulingStrategy } from './scheduling-strategy';
import { eventBus } from '../infra/event-bus';
import {
  NodeState,
  TaskPriority,
  type SchedulableNode,
  type SchedulerStats,
  type NodeProgress,
  type NodeExecutionResult,
} from '@/types/dag';
import type { TaskStateMachine } from './task-state-machine';

/**
 * DagOrchestrator 鐨勬渶灏忔帴鍙ｇ害鏉?
 * 閬垮厤寰幆渚濊禆锛岄€氳繃鎺ュ彛娉ㄥ叆
 */
export interface IDagOrchestrator {
  transitionNode(
    nodeId: string,
    toState: NodeState,
    context: { reason: string; triggeredBy: 'system' | 'user' | 'scheduler' | 'executor'; error?: unknown },
  ): Promise<void>;
  onNodeCompleted(nodeId: string, result: NodeExecutionResult): Promise<void>;
  getNodeForVerification(nodeId: string): DagNodeForVerification | null;
}

class SchedulerEngine {
  private strategy: SchedulingStrategy = new PriorityFairStrategy();
  private readyQueue = new Map<string, SchedulableNode>();
  private dagOrchestrator: IDagOrchestrator | null = null;
  private scheduling = false; // 闃叉閲嶅叆
  private scanTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 队列容量限制：与 SlotPool 槽位上限保持一致
   *
   * 原则：等待队列容量 = 运行槽位上限
   * 从 SlotPool 动态同步，避免硬编码。
   * 默认值仅作为 SlotPool 未初始化时的兜底。
   */
  private readonly maxQueueSizePerSlotType: Record<string, number> = {
    scraping: 5,   // 默认值，初始化时从 SlotPool 同步
    download: 5,
    sniff: 1,
  };

  /**
   * 从 SlotPool 同步队列容量限制
   *
   * 在 SlotPool 初始化完成后调用，确保队列容量与槽位上限一致。
   * 原则：等待队列容量 = 运行槽位上限
   */
  syncQueueCapacityFromSlotPool(): void {
    const snapshot = slotPool.getSnapshot();
    for (const [slotType, usage] of Object.entries(snapshot)) {
      this.maxQueueSizePerSlotType[slotType] = usage.max;
    }
    console.log(
      `[Scheduler] 队列容量已同步: ${Object.entries(this.maxQueueSizePerSlotType)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );
  }

  /**
   * 璁剧疆 DAG 缂栨帓鍣ㄥ紩鐢紙閬垮厤寰幆渚濊禆锛?
   */
  setDagOrchestrator(orchestrator: IDagOrchestrator): void {
    this.dagOrchestrator = orchestrator;
  }

  /**
   * 鎻愪氦鑺傜偣鍒拌皟搴﹂槦鍒?
   *
   * 鑳屽帇鏈哄埗锛氬綋绛夊緟闃熷垪杈惧埌瀹归噺涓婇檺鏃讹紝鎷掔粷鍏ラ槦銆?
   * 瀹归噺涓婇檺涓庡搴旀Ы浣嶇被鍨嬩笂闄愪繚鎸佷竴鑷淬€?
   */
  submit(node: SchedulableNode): boolean {
    // 妫€鏌ラ槦鍒楀閲忛檺鍒?
    for (const req of node.resourceRequirements) {
      const maxSize = this.maxQueueSizePerSlotType[req.slotType];
      if (maxSize !== undefined) {
        // 璁＄畻褰撳墠浣跨敤璇ユЫ浣嶇被鍨嬬殑鎺掗槦鑺傜偣鏁?
        const queuedCount = this.getQueuedCountBySlotType(req.slotType);
        if (queuedCount >= maxSize) {
          console.warn(
            `[Scheduler] 闃熷垪宸叉弧 (${req.slotType}: ${queuedCount}/${maxSize})锛岃妭鐐?${node.nodeId} 琚嫆缁濆叆闃焋,
          );
          return false;
        }
      }
    }

    this.readyQueue.set(node.nodeId, node);
    console.log(
      `[Scheduler] 鑺傜偣 ${node.nodeId} 鍔犲叆闃熷垪 (浼樺厛绾? ${TaskPriority[node.priority]}, 闃熷垪澶у皬: ${this.readyQueue.size})`,
    );
    this.schedule();
    return true;
  }

  /**
   * 鑾峰彇鎸囧畾妲戒綅绫诲瀷鐨勬帓闃熻妭鐐规暟
   */
  private getQueuedCountBySlotType(slotType: string): number {
    let count = 0;
    for (const node of this.readyQueue.values()) {
      if (node.resourceRequirements.some((r) => r.slotType === slotType)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 鎵ц璋冨害
   *
   * 浠庡氨缁槦鍒椾腑閫夋嫨鑺傜偣锛屽垎閰嶈祫婧愶紝椹卞姩鎵ц銆?
   * 浣跨敤 scheduling 鏍囧織浣嶉槻姝㈤噸鍏ャ€?
   */
  async schedule(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;

    try {
      while (this.readyQueue.size > 0) {
        const snapshot = slotPool.getSnapshot();

        const readyNodes = Array.from(this.readyQueue.values());

        const selected = this.strategy.selectNext(readyNodes, snapshot);
        if (!selected) break; // 鏃犲彲璋冨害鑺傜偣

        const acquired = slotPool.acquireBatch(
          selected.resourceRequirements,
          selected.nodeId,
        );

        if (!acquired) {
          break;
        }

        this.readyQueue.delete(selected.nodeId);

        if (this.dagOrchestrator) {
          await this.dagOrchestrator.transitionNode(
            selected.nodeId,
            NodeState.ALLOCATED,
            { reason: 'resources allocated', triggeredBy: 'scheduler' },
          );
        }

        await eventStore.append({
          seq: 0,
          type: 'dag:schedulingDecision',
          dagId: selected.dagId,
          nodeId: selected.nodeId,
          timestamp: new Date(),
          payload: {
            strategy: this.strategy.name,
            priority: selected.priority,
            resources: selected.resourceRequirements,
          },
        });

        this.executeNode(selected);
      }
    } finally {
      this.scheduling = false;
    }
  }
  private async executeNode(node: SchedulableNode): Promise<void> {
    const executor = taskExecutorRegistry.get(node.executorKey) ||
      taskExecutorRegistry.getByPhase(node.phase, node.taskType);

    if (!executor) {
      console.error(`[Scheduler] 鎵句笉鍒版墽琛屽櫒: ${node.executorKey}`);
      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.nodeId,
          NodeState.FAILED,
          {
            reason: `executor not found: ${node.executorKey}`,
            triggeredBy: 'scheduler',
            error: {
              code: 'EXECUTOR_NOT_FOUND',
              message: `鎵ц鍣ㄦ湭娉ㄥ唽: ${node.executorKey}`,
              retryable: false,
            },
          },
        );
      }
      slotPool.releaseAll(node.nodeId);
      this.schedule();
      return;
    }

    try {
      // 鐘舵€佽浆鎹細ALLOCATED 鈫?RUNNING
      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.nodeId,
          NodeState.RUNNING,
          { reason: 'execution started', triggeredBy: 'scheduler' },
        );
      }

      console.log(`[Scheduler] 鎵ц鑺傜偣 ${node.nodeId} (executor: ${executor.key})`);

      const result = await executor.execute(node, {
        onProgress: (progress: NodeProgress) => {
          this.onNodeProgress(node.nodeId, progress);
        },
        onCancel: () => {
          this.onNodeCancel(node.nodeId);
        },
      });

      // 鐘舵€佽浆鎹細RUNNING 鈫?VERIFYING
      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.nodeId,
          NodeState.VERIFYING,
          { reason: 'execution completed, verifying', triggeredBy: 'executor' },
        );
      }

      // 鏍￠獙浜у嚭鐗?
      const verifyNode = this.dagOrchestrator?.getNodeForVerification(node.nodeId);
      if (verifyNode) {
        const verification = await stateReconciler.verifyNode(verifyNode);

        if (verification.status === 'passed') {
          // 鏍￠獙閫氳繃 鈫?COMPLETED
          if (this.dagOrchestrator) {
            await this.dagOrchestrator.transitionNode(
              node.nodeId,
              NodeState.COMPLETED,
              { reason: `verification passed (${verification.reason})`, triggeredBy: 'system' },
            );
          }
        } else {
          // 鏍￠獙澶辫触 鈫?FAILED
          if (this.dagOrchestrator) {
            await this.dagOrchestrator.transitionNode(
              node.nodeId,
              NodeState.FAILED,
              {
                reason: `verification failed: ${verification.reason}`,
                triggeredBy: 'system',
                error: {
                  code: 'VERIFICATION_FAILED',
                  message: verification.reason,
                  retryable: true,
                },
              },
            );
          }
        }
      } else {
        // 鏃犻渶鏍￠獙锛岀洿鎺ュ畬鎴?
        if (this.dagOrchestrator) {
          await this.dagOrchestrator.transitionNode(
            node.nodeId,
            NodeState.COMPLETED,
            { reason: 'execution completed', triggeredBy: 'executor' },
          );
        }
      }

      // 閲婃斁璧勬簮
      slotPool.releaseAll(node.nodeId);

      // 瑙﹀彂鍚庣画璋冨害
      this.schedule();

      // 閫氱煡 DAG 缂栨帓鍣ㄦ鏌ュ悗缁妭鐐?
      if (this.dagOrchestrator) {
        await this.dagOrchestrator.onNodeCompleted(node.nodeId, result);
      }
    } catch (err) {
      console.error(`[Scheduler] 鑺傜偣 ${node.nodeId} 鎵ц寮傚父:`, err);

      const errMsg = err instanceof Error ? err.message : String(err);

      // 鎵ц寮傚父 鈫?FAILED
      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.nodeId,
          NodeState.FAILED,
          {
            reason: errMsg,
            triggeredBy: 'executor',
            error: {
              code: 'EXECUTION_ERROR',
              message: errMsg,
              retryable: true,
            },
          },
        );
      }

      // 閲婃斁璧勬簮
      slotPool.releaseAll(node.nodeId);

      // 瑙﹀彂閲嶆柊璋冨害
      this.schedule();
    }
  }

  /**
   * 妲戒綅閲婃斁鏃剁殑鍥炶皟
   */
  onSlotFreed(_slotType: string): void {
    console.log(`[Scheduler] 妲戒綅 ${_slotType} 閲婃斁锛岃Е鍙戦噸鏂拌皟搴);
    this.schedule();
  }

  /**
   * 璁剧疆璋冨害绛栫暐
   */
  setStrategy(strategy: SchedulingStrategy): void {
    this.strategy = strategy;
    console.log(`[Scheduler] 璋冨害绛栫暐鍒囨崲涓? ${strategy.name}`);
    this.schedule();
  }

  /**
   * 鍙栨秷鑺傜偣璋冨害
   */
  cancelNode(nodeId: string): void {
    this.readyQueue.delete(nodeId);
    slotPool.releaseAll(nodeId);
    console.log(`[Scheduler] 鑺傜偣 ${nodeId} 宸插彇娑堣皟搴);
  }

  /**
   * 鑾峰彇闃熷垪缁熻
   */
  getQueueStats(): SchedulerStats {
    const nodes = Array.from(this.readyQueue.values());
    return {
      queueSize: nodes.length,
      byPriority: this.groupByPriority(nodes),
      byTaskType: this.groupByTaskType(nodes),
      strategy: this.strategy.name,
    };
  }

  /**
   * 鍚姩瀹氭椂鎵弿锛堥槻姝㈣皟搴﹂仐婕忥級
   */
  startScanTimer(intervalMs: number = 1000): void {
    if (this.scanTimer) return;
    this.scanTimer = setInterval(() => {
      if (this.readyQueue.size > 0) {
        this.schedule();
      }
    }, intervalMs);
    console.log(`[Scheduler] 瀹氭椂鎵弿鍚姩: 姣?${intervalMs}ms`);
  }

  /**
   * 鍋滄瀹氭椂鎵弿
   */
  stopScanTimer(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
      console.log('[Scheduler] 瀹氭椂鎵弿宸插仠姝?);
    }
  }

  // ===== 绉佹湁鏂规硶 =====

  private onNodeProgress(nodeId: string, progress: NodeProgress): void {
    eventBus.emit('notification:info', {
      message: `[DAG] 鑺傜偣 ${nodeId} 杩涘害: ${progress.current}/${progress.total}`,
    });
  }

  private onNodeCancel(nodeId: string): void {
    console.log(`[Scheduler] 鑺傜偣 ${nodeId} 琚彇娑坄);
    this.cancelNode(nodeId);
  }

  private groupByPriority(nodes: SchedulableNode[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const n of nodes) {
      const key = TaskPriority[n.priority];
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  }

  private groupByTaskType(nodes: SchedulableNode[]): Record<string, number> {
    const result: Record<string, number> = {};
    for (const n of nodes) {
      result[n.taskType] = (result[n.taskType] || 0) + 1;
    }
    return result;
  }
}

export const schedulerEngine = getOrCreateGlobal(
  '__puchipix_scheduler_engine__',
  () => new SchedulerEngine(),
);
