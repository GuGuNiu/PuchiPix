import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../../infra/global-singleton';
import { schedulerEngine, type IDagOrchestrator } from '../scheduler-engine';
import { slotPool } from '../slot/pool';
import { eventStore } from '../../infra/event-store';
import { TaskStateMachine, aggregateTaskStatus } from '../task/state-machine';
import { logT } from '@/lib/i18n/server';
import { loggers } from '../../infra/logger';
import type { DagNodeForVerification } from '../state-reconciler';
import { stateReconciler } from '../state-reconciler';
import {
  NodeState,
  TaskPriority,
  isTerminalState,
  type DagDefinition,
  type DagNodeDefinition,
  type DagSnapshot,
  type NodeSnapshot,
  type DagEvent,
  type NodeExecutionResult,
  type TransitionContext,
  type SchedulableNode,
} from '@/types/dag';

interface DagNodeInstance {
  definition: DagNodeDefinition;
  fsm: TaskStateMachine;
  result: NodeExecutionResult | null;
}

interface DagInstance {
  id: string;
  definition: DagDefinition;
  nodes: Map<string, DagNodeInstance>;
  createdAt: Date;
}

class DagOrchestrator implements IDagOrchestrator {
  private readonly logger = loggers.dagOrchestrator();
  private dags = new Map<string, DagInstance>();
  private _initialized = false;

  async initialize(): Promise<void> {
    if (this._initialized) return;

    slotPool.setSchedulerCallback((slotType) => {
      schedulerEngine.onSlotFreed(slotType);
    });

    schedulerEngine.setDagOrchestrator(this);

    await eventStore.initialize();
    await this.restoreFromSnapshots();

    this._initialized = true;
    this.logger.infoT('log.dagOrchestrator.initComplete');
  }

  async submitDag(definition: DagDefinition): Promise<string> {
    const dagId = definition.id;

    const dag: DagInstance = {
      id: dagId,
      definition,
      nodes: new Map(),
      createdAt: new Date(),
    };

    for (const nodeDef of definition.nodes) {
      const fsm = new TaskStateMachine(dagId, nodeDef.id, nodeDef.phase, nodeDef);
      dag.nodes.set(nodeDef.id, {
        definition: nodeDef,
        fsm,
        result: null,
      });
    }

    this.dags.set(dagId, dag);

    await eventStore.append({
      seq: 0,
      type: 'dag:created',
      dagId,
      timestamp: new Date(),
      payload: {
        taskType: definition.taskType,
        nodeCount: definition.nodes.length,
        sourceUrl: definition.metadata.sourceUrl,
      },
    });

    this.logger.infoT('log.dagOrchestrator.dagSubmitted', { dagId, nodeCount: definition.nodes.length });

    await this.activateReadyNodes(dagId);

    return dagId;
  }

  private async activateReadyNodes(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    for (const [nodeId, node] of dag.nodes) {
      // Phase 1: Activate PENDING nodes whose dependencies are all completed
      if (node.fsm.state === NodeState.PENDING) {
        const deps = node.definition.dependencies;
        const allDepsCompleted = deps.every((depId) => {
          const depNode = dag.nodes.get(depId);
          return depNode?.fsm.state === NodeState.COMPLETED;
        });

        if (allDepsCompleted) {
          await node.fsm.transition(
            NodeState.READY,
            { reason: 'dependencies satisfied', triggeredBy: 'system' },
            eventStore,
          );
        } else {
          continue;
        }
      }

      /*
       * Phase 2: Submit READY nodes to scheduler (handles both newly activated
       * and previously rolled-back nodes from queue-full rejections)
       */
      if (node.fsm.state === NodeState.READY) {
        await node.fsm.transition(
          NodeState.QUEUED,
          { reason: 'submitted to scheduler', triggeredBy: 'system' },
          eventStore,
        );

        const schedulableNode: SchedulableNode = {
          nodeId,
          dagId,
          taskType: node.definition.taskType,
          phase: node.definition.phase,
          executorKey: node.definition.executor,
          priority: node.definition.priority,
          resourceRequirements: node.definition.resourceRequirements,
          config: node.definition.config,
          submittedAt: new Date(),
        };

        const submitted = schedulerEngine.submit(schedulableNode);

        if (!submitted) {
          await node.fsm.transition(
            NodeState.READY,
            { reason: 'submit failed, rolling back', triggeredBy: 'system' },
            eventStore,
          );
          this.logger.warn(
            logT('log.dagOrchestrator.nodeSubmitFailedQueueFull', { nodeId }),
          );
        }
      }

      /*
       * Phase 3: Recover orphaned QUEUED nodes (in QUEUED state but not in
       * scheduler's ready queue — can happen after retryDag failed to check
       * submit() return value, or after a crash/restart that lost the
       * in-memory readyQueue but preserved QUEUED state in snapshots).
       */
      if (node.fsm.state === NodeState.QUEUED && !schedulerEngine.hasNode(dagId, nodeId)) {
        this.logger.info('Recovering orphaned QUEUED node', { dagId, nodeId });
        // Roll back to READY so Phase 2 can re-submit on the next cycle
        await node.fsm.transition(
          NodeState.READY,
          { reason: 'orphaned QUEUED recovery, rolling back for re-submit', triggeredBy: 'system' },
          eventStore,
        );
        // Re-submit immediately
        const schedulableNode: SchedulableNode = {
          nodeId,
          dagId,
          taskType: node.definition.taskType,
          phase: node.definition.phase,
          executorKey: node.definition.executor,
          priority: node.definition.priority,
          resourceRequirements: node.definition.resourceRequirements,
          config: node.definition.config,
          submittedAt: new Date(),
        };
        const submitted = schedulerEngine.submit(schedulableNode);
        if (!submitted) {
          await node.fsm.transition(
            NodeState.READY,
            { reason: 're-submit failed, rolling back', triggeredBy: 'system' },
            eventStore,
          );
          this.logger.warn(
            logT('log.dagOrchestrator.nodeSubmitFailedQueueFull', { nodeId }),
          );
        } else {
          await node.fsm.transition(
            NodeState.QUEUED,
            { reason: 're-submitted to scheduler after orphan recovery', triggeredBy: 'system' },
            eventStore,
          );
        }
      }
    }
  }

  /**
   * Reactivate READY nodes across all DAGs.
   *
   * Called by the scheduler scan timer and onSlotFreed to re-submit
   * nodes that were previously rejected due to a full queue.
   * This prevents READY-state deadlock where nodes are stuck indefinitely.
   */
  async reactivateReadyNodes(): Promise<void> {
    for (const dagId of this.dags.keys()) {
      try {
        await this.activateReadyNodes(dagId);
      } catch (err) {
        this.logger.error(`Failed to reactivate READY nodes for DAG ${dagId}`, { error: err });
      }
    }
  }

  async onNodeCompleted(dagId: string, nodeId: string, result: NodeExecutionResult): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    const node = dag.nodes.get(nodeId);
    if (!node) return;

    node.result = result;

      await eventStore.append({
        seq: 0,
        type: 'dag:nodeCompleted',
        dagId,
        nodeId,
        timestamp: new Date(),
        payload: { result },
      });

      await this.activateReadyNodes(dagId);

      await this.checkDagCompletion(dagId);
  }

  async transitionNode(
    dagId: string,
    nodeId: string,
    toState: NodeState,
    context: TransitionContext,
  ): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) {
      this.logger.warnT('log.dagOrchestrator.dagNotFoundCannotTransition', { nodeId });
      return;
    }

    const node = dag.nodes.get(nodeId);
    if (!node) {
      this.logger.warnT('log.dagOrchestrator.nodeNotFoundCannotTransition', { nodeId });
      return;
    }

    await node.fsm.transition(toState, context, eventStore);

    const actualState = node.fsm.state;
    if (isTerminalState(actualState) || actualState === NodeState.RUNNING) {
      await this.updateDBTaskStatus(dagId);
    }
  }

  getNodeForVerification(dagId: string, nodeId: string): DagNodeForVerification | null {
    const dag = this.dags.get(dagId);
    if (!dag) return null;

    const node = dag.nodes.get(nodeId);
    if (!node) return null;

    return {
      nodeId,
      dagId,
      state: node.fsm.state,
      phase: node.definition.phase,
      config: node.definition.config,
      fsm: node.fsm,
    };
  }

  private async checkDagCompletion(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    const allNodes = Array.from(dag.nodes.values());
    const allCompleted = allNodes.every((n) => n.fsm.state === NodeState.COMPLETED);
    const anyFailed = allNodes.some(
      (n) => n.fsm.state === NodeState.FAILED || n.fsm.state === NodeState.TIMEOUT,
    );
    const anyCancelled = allNodes.some((n) => n.fsm.state === NodeState.CANCELLED);

    if (allCompleted) {
      await eventStore.append({
        seq: 0,
        type: 'dag:completed',
        dagId,
        timestamp: new Date(),
        payload: {},
      });
      this.logger.infoT('log.dagOrchestrator.dagCompleted', { dagId });

      await this.updateDBTaskStatus(dagId);
    } else if (anyFailed || anyCancelled) {
      const allTerminal = allNodes.every((n) => isTerminalState(n.fsm.state));
      if (allTerminal) {
        this.logger.infoT('log.dagOrchestrator.dagEndedWithFailure', { dagId });
        await this.updateDBTaskStatus(dagId);
      }
    }
  }

  private async updateDBTaskStatus(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    const nodes = Array.from(dag.nodes.values()).map((n) => ({
      state: n.fsm.state,
      phase: n.definition.phase,
      error: n.fsm.error,
    }));

    const taskStatus = aggregateTaskStatus(dag.definition.taskType, nodes);

    if (dag.definition.taskType === 'gallery') {
      const galleryId = parseInt(dagId.replace('gallery-', ''), 10);
      if (!isNaN(galleryId)) {
        try {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: taskStatus },
          });
        } catch (err) {
          this.logger.errorT('log.dagOrchestrator.updateGalleryStatusFailed', { galleryId }, { error: err });
        }
      }
    }
  }

  async pauseDag(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) {
      this.logger.warnT('log.dagOrchestrator.dagNotFoundCannotPause', { dagId });
      return;
    }

    let pausedCount = 0;
    for (const [nodeId, node] of dag.nodes) {
      if (isTerminalState(node.fsm.state) || node.fsm.state === NodeState.PAUSED) continue;

      schedulerEngine.cancelNode(dagId, nodeId);
      slotPool.releaseAll(`${dagId}:${nodeId}`);

      const policy = node.definition.transitionPolicy;
      const onPauseResult = policy?.onPause?.(node.fsm.context);

      if (onPauseResult !== undefined && onPauseResult !== null) {
        if (onPauseResult !== node.fsm.state && node.fsm.canTransitionTo(onPauseResult)) {
          await node.fsm.transition(
            onPauseResult,
            { reason: 'user paused', triggeredBy: 'user' },
            eventStore,
          );
        }
        pausedCount++;
      } else if (node.fsm.canTransitionTo(NodeState.PAUSED)) {
        await node.fsm.transition(
          NodeState.PAUSED,
          { reason: 'user paused', triggeredBy: 'user' },
          eventStore,
        );
        pausedCount++;
      } else if (node.fsm.state === NodeState.PENDING) {
        if (node.fsm.canTransitionTo(NodeState.READY)) {
          await node.fsm.transition(
            NodeState.READY,
            { reason: 'transition before pause', triggeredBy: 'system' },
            eventStore,
          );
        }
        if (node.fsm.canTransitionTo(NodeState.PAUSED)) {
          await node.fsm.transition(
            NodeState.PAUSED,
            { reason: 'user paused', triggeredBy: 'user' },
            eventStore,
          );
          pausedCount++;
        }
      }
    }

    await eventStore.append({
      seq: 0,
      type: 'dag:paused',
      dagId,
      timestamp: new Date(),
      payload: { reason: 'user paused', pausedCount },
    });

    this.logger.info(
      logT('log.dagOrchestrator.dagPaused', { dagId, pausedCount }),
    );

    await this.updateDBTaskStatus(dagId);
  }

  async cancelDag(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    for (const [nodeId, node] of dag.nodes) {
      if (!isTerminalState(node.fsm.state)) {
        schedulerEngine.cancelNode(dagId, nodeId);

        slotPool.releaseAll(`${dagId}:${nodeId}`);

        if (node.fsm.canTransitionTo(NodeState.CANCELLED)) {
          await node.fsm.transition(
            NodeState.CANCELLED,
            { reason: 'user cancelled', triggeredBy: 'user' },
            eventStore,
          );
        }
      }
    }

    await eventStore.append({
      seq: 0,
      type: 'dag:cancelled',
      dagId,
      timestamp: new Date(),
      payload: {},
    });

    this.logger.infoT('log.dagOrchestrator.dagCancelled', { dagId });

    await this.updateDBTaskStatus(dagId);
  }

  async resumeDag(dagId: string, nodeId?: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) {
      this.logger.warnT('log.dagOrchestrator.dagNotFoundCannotResume', { dagId });
      return;
    }

    const nodesToResume = nodeId
      ? [dag.nodes.get(nodeId)!].filter(Boolean)
      : Array.from(dag.nodes.values()).filter(
          (n) => n.fsm.state === NodeState.PAUSED,
        );

    let resumedCount = 0;
    for (const node of nodesToResume) {
      if (!node || node.fsm.state !== NodeState.PAUSED) continue;

      const policy = node.definition.transitionPolicy;
      const resumePath = policy?.onResume?.(node.fsm.context);

      if (resumePath && resumePath.length > 0) {
        for (const targetState of resumePath) {
          await node.fsm.transition(
            targetState,
            { reason: 'user resumed, policy-driven path', triggeredBy: 'user' },
            eventStore,
          );
        }
      } else {
        await node.fsm.transition(
          NodeState.READY,
          { reason: 'user resumed, preparing for re-scheduling', triggeredBy: 'user' },
          eventStore,
        );

        await node.fsm.transition(
          NodeState.QUEUED,
          { reason: 're-submitted to scheduler after resume', triggeredBy: 'system' },
          eventStore,
        );
      }

      const schedulableNode: SchedulableNode = {
        nodeId: node.definition.id,
        dagId,
        taskType: node.definition.taskType,
        phase: node.definition.phase,
        executorKey: node.definition.executor,
        priority: node.definition.priority,
        resourceRequirements: node.definition.resourceRequirements,
        config: node.definition.config,
        submittedAt: new Date(),
      };

      const submitted = schedulerEngine.submit(schedulableNode);

      if (submitted) {
        resumedCount++;
      } else {
        await node.fsm.transition(
          NodeState.READY,
          { reason: 're-submit failed, rolling back', triggeredBy: 'system' },
          eventStore,
        );
        this.logger.warn(
          logT('log.dagOrchestrator.resumeNodeFailedQueueFull', { nodeId: node.definition.id }),
        );
      }
    }

    await eventStore.append({
      seq: 0,
      type: 'dag:resumed',
      dagId,
      timestamp: new Date(),
      payload: { resumedCount, totalCount: nodesToResume.length },
    });

    this.logger.info(
      logT('log.dagOrchestrator.dagResumeComplete', { dagId, resumedCount, totalCount: nodesToResume.length }),
    );

    if (dag.definition.taskType === 'gallery') {
      const galleryId = parseInt(dagId.replace('gallery-', ''), 10);
      if (!isNaN(galleryId)) {
        try {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { errorMsg: '' },
          });
        } catch (err) {
          this.logger.errorT('log.dagOrchestrator.clearErrorMsgFailed', { galleryId }, { error: err });
        }
      }
    }

    await this.updateDBTaskStatus(dagId);
  }

  async retryDag(dagId: string, nodeId?: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    const isRetryable = (n: DagNodeInstance | undefined): n is DagNodeInstance =>
      !!n && (n.fsm.state === NodeState.FAILED || n.fsm.state === NodeState.TIMEOUT);

    const nodesToRetry = nodeId
      ? [dag.nodes.get(nodeId)].filter(isRetryable)
      : Array.from(dag.nodes.values()).filter(isRetryable);

    if (nodesToRetry.length === 0) {
      this.logger.warn(
        `DAG ${dagId} node ${nodeId || '(all)'} has no retryable nodes (FAILED/TIMEOUT required)`,
      );
      return;
    }

    for (const node of nodesToRetry) {
      if (!node) continue;

      const policy = node.definition.transitionPolicy;
      const ctx = node.fsm.context;

      /*
       * User-initiated retries bypass maxAttempts — reset retryCount so the
       * policy doesn't block manual recovery attempts.
       */
      node.fsm.resetRetryCount();
      ctx.extras.userTriggered = true;

      await eventStore.append({
        seq: 0,
        type: 'dag:nodeRetrying',
        dagId,
        nodeId: node.definition.id,
        timestamp: new Date(),
        payload: {
          retryCount: ctx.retryCount + 1,
          error: ctx.lastError ?? { code: 'UNKNOWN', message: 'Unknown error' },
        },
      });

      const backoff = policy?.retryPolicy?.backoff?.(ctx) ?? 0;
      if (backoff > 0) {
        this.logger.info(`Node ${node.definition.id} retry backoff: ${backoff}ms`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      const retryPriority = policy?.retryPolicy?.priority?.(ctx) ?? TaskPriority.CRITICAL;
      node.definition.priority = retryPriority;

      await node.fsm.transition(
        NodeState.READY,
        { reason: 'user retry', triggeredBy: 'user' },
        eventStore,
      );

      await node.fsm.transition(
        NodeState.QUEUED,
        { reason: 're-submitted to scheduler', triggeredBy: 'system' },
        eventStore,
      );

      const schedulableNode: SchedulableNode = {
        nodeId: node.definition.id,
        dagId,
        taskType: node.definition.taskType,
        phase: node.definition.phase,
        executorKey: node.definition.executor,
        priority: node.definition.priority,
        resourceRequirements: node.definition.resourceRequirements,
        config: node.definition.config,
        submittedAt: new Date(),
      };

      const submitted = schedulerEngine.submit(schedulableNode);
      if (!submitted) {
        // Queue full — roll back to READY so reactivateReadyNodes can re-submit later
        await node.fsm.transition(
          NodeState.READY,
          { reason: 'retry submit failed (queue full), rolling back', triggeredBy: 'system' },
          eventStore,
        );
        this.logger.warn(
          logT('log.dagOrchestrator.nodeSubmitFailedQueueFull', { nodeId: node.definition.id }),
        );
      }
    }

    this.logger.infoT('log.dagOrchestrator.retryNodes', { dagId, nodeCount: nodesToRetry.length });
  }

  getDagStatus(dagId: string): { nodes: Array<{ nodeId: string; state: NodeState; phase: string }> } | null {
    const dag = this.dags.get(dagId);
    if (!dag) return null;

    return {
      nodes: Array.from(dag.nodes.entries()).map(([id, node]) => ({
        nodeId: id,
        state: node.fsm.state,
        phase: node.definition.phase,
      })),
    };
  }

  getDagSnapshot(dagId: string): DagSnapshot | null {
    const dag = this.dags.get(dagId);
    if (!dag) return null;

    const nodeStates: NodeSnapshot[] = Array.from(dag.nodes.entries()).map(
      ([id, node]) => ({
        nodeId: id,
        state: node.fsm.state,
        error: node.fsm.error,
        history: node.fsm.getHistory(),
        result: node.result,
      }),
    );

    return {
      dagId,
      definition: dag.definition,
      nodeStates,
      createdAt: dag.createdAt,
    };
  }

  getAllDagSnapshots(): DagSnapshot[] {
    return Array.from(this.dags.keys())
      .map((id) => this.getDagSnapshot(id)!)
      .filter(Boolean);
  }

  async restoreDag(snapshot: DagSnapshot): Promise<void> {
    const dag: DagInstance = {
      id: snapshot.dagId,
      definition: snapshot.definition,
      nodes: new Map(),
      createdAt: snapshot.createdAt,
    };

    for (const nodeState of snapshot.nodeStates) {
      const nodeDef = snapshot.definition.nodes.find((n) => n.id === nodeState.nodeId);
      if (!nodeDef) continue;

      const fsm = new TaskStateMachine(
        snapshot.dagId,
        nodeState.nodeId,
        nodeDef.phase,
        nodeDef,
        { initialState: nodeState.state },
      );
      fsm.restoreFromSnapshot(nodeState.history, nodeState.error);
      dag.nodes.set(nodeState.nodeId, {
        definition: nodeDef,
        fsm,
        result: nodeState.result,
      });
    }

    this.dags.set(snapshot.dagId, dag);
    this.logger.info(
      logT('log.dagOrchestrator.restoreDag', { dagId: snapshot.dagId, nodeCount: snapshot.nodeStates.length }),
    );
  }

  async applyEvent(event: DagEvent): Promise<void> {
    if (!event.nodeId) return;

    for (const [, dag] of this.dags) {
      const node = dag.nodes.get(event.nodeId);
      if (!node) continue;

      switch (event.type) {
        case 'dag:nodeStateChanged': {
          const payload = event.payload as {
            from: NodeState;
            to: NodeState;
            context: TransitionContext;
          };
          // Only apply if current state matches 'from' and transition is valid
          if (
            node.fsm.state === payload.from &&
            node.fsm.canTransitionTo(payload.to)
          ) {
            await node.fsm.transition(payload.to, payload.context);
          }
          break;
        }
        case 'dag:nodeCompleted': {
          const payload = event.payload as { result: NodeExecutionResult };
          node.result = payload.result;
          break;
        }
        default:
          break;
      }
      break;
    }
  }

  private async restoreFromSnapshots(): Promise<void> {
    await eventStore.restoreFromSnapshot(
      async (snapshot) => {
        await this.restoreDag(snapshot);
      },
      async (event) => {
        await this.applyEvent(event);
      },
    );

    let totalPausedCount = 0;
    for (const [dagId, dag] of this.dags) {
      let dagPausedCount = 0;
      for (const [nodeId, node] of dag.nodes) {
        const activeStates = [
          NodeState.RUNNING,
          NodeState.ALLOCATED,
          NodeState.READY,
          NodeState.QUEUED,
          NodeState.VERIFYING,
        ];

        if (activeStates.includes(node.fsm.state)) {
          slotPool.releaseAll(`${dagId}:${nodeId}`);
          schedulerEngine.cancelNode(dagId, nodeId);

          if (node.fsm.state === NodeState.VERIFYING) {
            const policy = node.definition.transitionPolicy;
            const onRestartResult = policy?.onRestart?.(node.fsm.context);

            if (onRestartResult !== undefined && onRestartResult !== null) {
              if (onRestartResult !== NodeState.VERIFYING) {
                if (node.fsm.canTransitionTo(onRestartResult)) {
                  await node.fsm.transition(
                    onRestartResult,
                    {
                      reason: 'restart recovery, policy-driven',
                      triggeredBy: 'system',
                    },
                    eventStore,
                  );
                  dagPausedCount++;
                  totalPausedCount++;
                }
              } else {
                this.logger.info(
                  `Node ${nodeId} kept VERIFYING for resumable verification (retryCount=${node.fsm.context.retryCount})`,
                );
              }
            } else {
              if (node.fsm.canTransitionTo(NodeState.FAILED)) {
                await node.fsm.transition(
                  NodeState.FAILED,
                  {
                    reason: 'verification interrupted by service restart',
                    triggeredBy: 'system',
                    error: {
                      code: 'VERIFICATION_INTERRUPTED',
                      message: 'Verification interrupted by service restart',
                      retryable: true,
                    },
                  },
                  eventStore,
                );
                dagPausedCount++;
                totalPausedCount++;
              }
            }
          } else if (node.fsm.canTransitionTo(NodeState.PAUSED)) {
            await node.fsm.transition(
              NodeState.PAUSED,
              {
                reason: 'service restarted, task suspended for manual recovery',
                triggeredBy: 'system',
              },
              eventStore,
            );
            dagPausedCount++;
            totalPausedCount++;
          } else {
            if (node.fsm.state !== NodeState.READY && node.fsm.canTransitionTo(NodeState.READY)) {
              await node.fsm.transition(
                NodeState.READY,
                { reason: 'reset before pause', triggeredBy: 'system' },
                eventStore,
              );
            }
            if (node.fsm.canTransitionTo(NodeState.PAUSED)) {
              await node.fsm.transition(
                NodeState.PAUSED,
                {
                  reason: 'service restarted, task suspended for manual recovery',
                  triggeredBy: 'system',
                },
                eventStore,
              );
              dagPausedCount++;
              totalPausedCount++;
            }
          }
        }
      }

      if (dagPausedCount > 0) {
        await this.updateDBTaskStatus(dagId);
      }
    }

    if (totalPausedCount > 0) {
      this.logger.info(
        logT('log.dagOrchestrator.restartRecoveryComplete', { pausedCount: totalPausedCount }),
      );
    }

    for (const [dagId, dag] of this.dags) {
      for (const [nodeId, node] of dag.nodes) {
        if (node.fsm.state !== NodeState.RESUME_VERIFY) continue;

        try {
          const verifyNode = this.getNodeForVerification(dagId, nodeId);
          if (!verifyNode) continue;

          const result = await stateReconciler.verifyNode(verifyNode);

          if (result.status === 'passed') {
            await node.fsm.transition(
              NodeState.COMPLETED,
              { reason: `resume verify passed (${result.reason})`, triggeredBy: 'system' },
              eventStore,
            );
          } else {
            await node.fsm.transition(
              NodeState.FAILED,
              {
                reason: `resume verify failed: ${result.reason}`,
                triggeredBy: 'system',
                error: {
                  code: 'VERIFICATION_FAILED',
                  message: result.reason,
                  retryable: true,
                },
              },
              eventStore,
            );
          }
        } catch (err) {
          this.logger.error(`Failed to resume verify node ${nodeId}`, { error: err });
          if (node.fsm.canTransitionTo(NodeState.FAILED)) {
            await node.fsm.transition(
              NodeState.FAILED,
              {
                reason: 'resume verify error',
                triggeredBy: 'system',
                error: {
                  code: 'RESUME_VERIFY_ERROR',
                  message: err instanceof Error ? err.message : String(err),
                  retryable: true,
                },
              },
              eventStore,
            );
          }
        }
      }
    }

    for (const dagId of this.dags.keys()) {
      try {
        await this.activateReadyNodes(dagId);
      } catch (err) {
        this.logger.error(`Failed to activate PENDING nodes for DAG ${dagId}`, { error: err });
      }
    }
  }

  async createSnapshot(): Promise<void> {
    const snapshots = this.getAllDagSnapshots();
    if (snapshots.length > 0) {
      await eventStore.snapshot(snapshots);
    }
  }

  getStats(): { totalDags: number; activeDags: number; totalNodes: number } {
    let activeDags = 0;
    let totalNodes = 0;
    for (const [, dag] of this.dags) {
      const nodes = Array.from(dag.nodes.values());
      const hasActive = nodes.some((n) => !isTerminalState(n.fsm.state));
      if (hasActive) activeDags++;
      totalNodes += nodes.length;
    }
    return { totalDags: this.dags.size, activeDags, totalNodes };
  }
}

export const dagOrchestrator = getOrCreateGlobal(
  '__puchipix_dag_orchestrator__',
  () => new DagOrchestrator(),
);
