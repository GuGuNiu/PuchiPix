import { getOrCreateGlobal } from '../infra/global-singleton';
import { slotPool } from './slot/pool';
import { eventStore } from '../infra/event-store';
import { stateReconciler, type DagNodeForVerification } from './state-reconciler';
import { taskExecutorRegistry } from './task/executor';
import { PriorityFairStrategy } from './scheduling-strategy';
import type { SchedulingStrategy } from './scheduling-strategy';
import { eventBus } from '../infra/event-bus';
import { createLogger } from '../infra/logger';
import {
  NodeState,
  TaskPriority,
  type SchedulableNode,
  type SchedulerStats,
  type NodeProgress,
  type NodeExecutionResult,
} from '@/types/dag';
export interface IDagOrchestrator {
  transitionNode(
    dagId: string,
    nodeId: string,
    toState: NodeState,
    context: { reason: string; triggeredBy: 'system' | 'user' | 'scheduler' | 'executor'; error?: unknown },
  ): Promise<void>;
  onNodeCompleted(dagId: string, nodeId: string, result: NodeExecutionResult): Promise<void>;
  getNodeForVerification(dagId: string, nodeId: string): DagNodeForVerification | null;
  /**
   * Reactivate READY nodes across all DAGs.
   * Called by the scheduler scan timer and onSlotFreed to re-submit
   * nodes that were previously rejected due to a full queue.
   */
  reactivateReadyNodes(): Promise<void>;
}

class SchedulerEngine {
  private strategy: SchedulingStrategy = new PriorityFairStrategy();
  private readyQueue = new Map<string, SchedulableNode>();
  private dagOrchestrator: IDagOrchestrator | null = null;
  private scheduling = false;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private readonly logger = createLogger('Scheduler');

  private readonly maxQueueSizePerSlotType: Record<string, number> = {
    scraping: 5,
    download: 5,
    sniff: 1,
  };

  syncQueueCapacityFromSlotPool(): void {
    const snapshot = slotPool.getSnapshot();
    for (const [slotType, usage] of Object.entries(snapshot)) {
      this.maxQueueSizePerSlotType[slotType] = usage.max;
    }
    this.logger.info('Queue capacity synced', {
      capacities: Object.entries(this.maxQueueSizePerSlotType)
        .map(([k, v]) => `${k}=${v}`)
        .join(', '),
    });
  }

  setDagOrchestrator(orchestrator: IDagOrchestrator): void {
    this.dagOrchestrator = orchestrator;
  }

  submit(node: SchedulableNode): boolean {
    for (const req of node.resourceRequirements) {
      const maxSize = this.maxQueueSizePerSlotType[req.slotType];
      if (maxSize !== undefined) {
        const queuedCount = this.getQueuedCountBySlotType(req.slotType);
        if (queuedCount >= maxSize) {
        this.logger.warn('Queue full, node rejected', {
          slotType: req.slotType,
          queued: queuedCount,
          max: maxSize,
          nodeId: node.nodeId,
          dagId: node.dagId,
        });
          return false;
        }
      }
    }

    const queueKey = `${node.dagId}:${node.nodeId}`;
    this.readyQueue.set(queueKey, node);
    this.logger.info('Node enqueued', {
      nodeId: node.nodeId,
      dagId: node.dagId,
      priority: TaskPriority[node.priority],
      queueSize: this.readyQueue.size,
    });
    this.schedule();
    return true;
  }

  private getQueuedCountBySlotType(slotType: string): number {
    let count = 0;
    for (const node of this.readyQueue.values()) {
      if (node.resourceRequirements.some((r) => r.slotType === slotType)) {
        count++;
      }
    }
    return count;
  }

  async schedule(): Promise<void> {
    if (this.scheduling) return;
    this.scheduling = true;

    try {
      while (this.readyQueue.size > 0) {
        const snapshot = slotPool.getSnapshot();

        const readyNodes = Array.from(this.readyQueue.values());

        const selected = this.strategy.selectNext(readyNodes, snapshot);
        if (!selected) break;

        const holderId = `${selected.dagId}:${selected.nodeId}`;
        const acquired = slotPool.acquireBatch(
          selected.resourceRequirements,
          holderId,
        );

        if (!acquired) {
          continue;
        }

        eventBus.emit('dag:resourceAllocated', {
          dagId: selected.dagId,
          nodeId: selected.nodeId,
          resources: selected.resourceRequirements,
        });

        this.readyQueue.delete(`${selected.dagId}:${selected.nodeId}`);

        if (this.dagOrchestrator) {
          await this.dagOrchestrator.transitionNode(
            selected.dagId,
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
      this.logger.error('Executor not found', { executorKey: node.executorKey, nodeId: node.nodeId, dagId: node.dagId });
      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.dagId,
          node.nodeId,
          NodeState.FAILED,
          {
            reason: `executor not found: ${node.executorKey}`,
            triggeredBy: 'scheduler',
            error: {
              code: 'EXECUTOR_NOT_FOUND',
              message: `Executor not found: ${node.executorKey}`,
              retryable: false,
            },
          },
        );
      }
      slotPool.releaseAll(`${node.dagId}:${node.nodeId}`);
      this.schedule();
      return;
    }

    try {
      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.dagId,
          node.nodeId,
          NodeState.RUNNING,
          { reason: 'execution started', triggeredBy: 'scheduler' },
        );
      }

      this.logger.info('Node execution started', { nodeId: node.nodeId, executor: executor.key });

      const result = await executor.execute(node, {
        onProgress: (progress: NodeProgress) => {
          this.onNodeProgress(node.dagId, node.nodeId, progress);
        },
        onCancel: () => {
          this.onNodeCancel(node.dagId, node.nodeId);
        },
      });

      // Check if node was paused during execution
      const pausedCheck = this.dagOrchestrator?.getNodeForVerification(node.dagId, node.nodeId);
      if (pausedCheck && pausedCheck.state === NodeState.PAUSED) {
        this.logger.info('Node paused during execution, skipping state transition', { nodeId: node.nodeId, dagId: node.dagId });
        slotPool.releaseAll(`${node.dagId}:${node.nodeId}`);
        this.schedule();
        return;
      }

      /*
       * If execution failed with a non-retryable error, skip verification and
       * transition directly to FAILED.  This prevents the verification loop from
       * re-executing an executor that will always return the same non-retryable
       * error (e.g., GALLERY_NOT_FOUND when the gallery status is 'completed').
       */
      if (!result.success && result.error && !result.error.retryable) {
        this.logger.info('Execution failed (non-retryable), skipping verification', {
          nodeId: node.nodeId,
          dagId: node.dagId,
          code: result.error.code,
        });
        if (this.dagOrchestrator) {
          await this.dagOrchestrator.transitionNode(
            node.dagId,
            node.nodeId,
            NodeState.FAILED,
            {
              reason: result.error.message,
              triggeredBy: 'executor',
              error: result.error,
            },
          );
        }
        slotPool.releaseAll(`${node.dagId}:${node.nodeId}`);
        this.schedule();
        if (this.dagOrchestrator) {
          await this.dagOrchestrator.onNodeCompleted(node.dagId, node.nodeId, result);
        }
        return;
      }

      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.dagId,
          node.nodeId,
          NodeState.VERIFYING,
          { reason: 'execution completed, verifying', triggeredBy: 'executor' },
        );
      }

      const verifyNode = this.dagOrchestrator?.getNodeForVerification(node.dagId, node.nodeId);
      if (verifyNode && verifyNode.state === NodeState.VERIFYING) {
        /*
         * Support needs_retry: re-execute the node when verification detects
         * missing data (e.g., scrape was interrupted before saving to DB).
         */
        const MAX_VERIFY_RETRIES = 3;
        let verifyRetries = 0;
        let verification = await stateReconciler.verifyNode(verifyNode);

        while (verification.status === 'needs_retry' && verifyRetries < MAX_VERIFY_RETRIES) {
          verifyRetries++;
          this.logger.info('Verification needs retry, re-executing node', {
            nodeId: node.nodeId,
            dagId: node.dagId,
            attempt: `${verifyRetries}/${MAX_VERIFY_RETRIES}`,
            reason: verification.reason,
          });

          // Re-execute the executor (node stays in VERIFYING state)
          await executor.execute(node, {
            onProgress: (progress: NodeProgress) => {
              this.onNodeProgress(node.dagId, node.nodeId, progress);
            },
            onCancel: () => {
              this.onNodeCancel(node.dagId, node.nodeId);
            },
          });

          // Re-verify
          const reverifyNode = this.dagOrchestrator?.getNodeForVerification(node.dagId, node.nodeId);
          if (reverifyNode && reverifyNode.state === NodeState.VERIFYING) {
            verification = await stateReconciler.verifyNode(reverifyNode);
          } else {
            break;
          }
        }

        if (verification.status === 'passed') {
          if (this.dagOrchestrator) {
            await this.dagOrchestrator.transitionNode(
              node.dagId,
              node.nodeId,
              NodeState.COMPLETED,
              { reason: `verification passed (${verification.reason})`, triggeredBy: 'system' },
            );
          }
        } else {
          if (this.dagOrchestrator) {
            await this.dagOrchestrator.transitionNode(
              node.dagId,
              node.nodeId,
              NodeState.FAILED,
              {
                reason: `verification failed: ${verification.reason}` +
                  (verifyRetries > 0 ? ` (after ${verifyRetries} retries)` : ''),
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
      } else if (verifyNode && verifyNode.state === NodeState.COMPLETED) {
        this.logger.info('Node skipped verification via transitionPolicy guard', { nodeId: node.nodeId, dagId: node.dagId });
      } else if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.dagId,
          node.nodeId,
          NodeState.COMPLETED,
          { reason: 'execution completed', triggeredBy: 'executor' },
        );
      }

      const releasedSlotTypes = node.resourceRequirements.map((r) => r.slotType);
      eventBus.emit('dag:resourceReleased', {
        dagId: node.dagId,
        nodeId: node.nodeId,
        resources: releasedSlotTypes,
      });

      slotPool.releaseAll(`${node.dagId}:${node.nodeId}`);

      this.schedule();

      if (this.dagOrchestrator) {
        await this.dagOrchestrator.onNodeCompleted(node.dagId, node.nodeId, result);
      }
    } catch (err) {
      this.logger.error('Node execution failed', { nodeId: node.nodeId, dagId: node.dagId, error: err });

      // Check if node was paused during execution
      const pausedCheck = this.dagOrchestrator?.getNodeForVerification(node.dagId, node.nodeId);
      if (pausedCheck && pausedCheck.state === NodeState.PAUSED) {
        this.logger.info('Node paused during failed execution, skipping FAILED transition', { nodeId: node.nodeId, dagId: node.dagId });
        slotPool.releaseAll(`${node.dagId}:${node.nodeId}`);
        this.schedule();
        return;
      }

      const errMsg = err instanceof Error ? err.message : String(err);

      if (this.dagOrchestrator) {
        await this.dagOrchestrator.transitionNode(
          node.dagId,
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

      slotPool.releaseAll(`${node.dagId}:${node.nodeId}`);

      this.schedule();
    }
  }

  onSlotFreed(slotType: string): void {
    this.logger.debug('Slot freed', { slotType });
    this.schedule();
    // Re-activate READY nodes that were previously rejected due to full queue
    void this.dagOrchestrator?.reactivateReadyNodes();
  }

  setStrategy(strategy: SchedulingStrategy): void {
    this.strategy = strategy;
    this.logger.info('Strategy switched', { strategy: strategy.name });
    this.schedule();
  }

  /**
   * Check if a node is currently in the scheduler's ready queue.
   * Used by the orchestrator to detect orphaned QUEUED nodes
   * (nodes in QUEUED state but not actually in the scheduler queue).
   */
  hasNode(dagId: string, nodeId: string): boolean {
    return this.readyQueue.has(`${dagId}:${nodeId}`);
  }

  /**
   * Get all node IDs currently in the ready queue.
   * Used for diagnostics and orphan detection.
   */
  getQueuedNodeIds(): Array<{ dagId: string; nodeId: string }> {
    return Array.from(this.readyQueue.values()).map((n) => ({
      dagId: n.dagId,
      nodeId: n.nodeId,
    }));
  }

  cancelNode(dagId: string, nodeId: string): void {
    const holderId = `${dagId}:${nodeId}`;
    this.readyQueue.delete(holderId);
    // Also scan for any entries where nodeId matches (backward compat)
    for (const [key, node] of this.readyQueue) {
      if (node.nodeId === nodeId && node.dagId === dagId) {
        this.readyQueue.delete(key);
      }
    }
    slotPool.releaseAll(holderId);
    this.logger.info('Node cancelled', { dagId, nodeId });
  }

  getQueueStats(): SchedulerStats {
    const nodes = Array.from(this.readyQueue.values());
    return {
      queueSize: nodes.length,
      byPriority: this.groupByPriority(nodes),
      byTaskType: this.groupByTaskType(nodes),
      strategy: this.strategy.name,
    };
  }

  startScanTimer(intervalMs: number = 1000): void {
    if (this.scanTimer) return;
    this.scanTimer = setInterval(() => {
      if (this.readyQueue.size > 0) {
        this.schedule();
      }
      // Re-activate READY nodes that were rolled back due to full queue
      void this.dagOrchestrator?.reactivateReadyNodes();
    }, intervalMs);
    this.logger.info('Scan timer started', { intervalMs });
  }

  stopScanTimer(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
      this.logger.info('Scan timer stopped');
    }
  }

  private onNodeProgress(dagId: string, nodeId: string, progress: NodeProgress): void {
    eventBus.emit('dag:nodeProgress', {
      dagId,
      nodeId,
      phase: progress.phase,
      current: progress.current,
      total: progress.total,
      speed: progress.speed,
      failed: progress.failed,
    });
  }

  private onNodeCancel(dagId: string, nodeId: string): void {
    this.logger.info('Node cancelled by executor', { nodeId, dagId });
    this.cancelNode(dagId, nodeId);
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
