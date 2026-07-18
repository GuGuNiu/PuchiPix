import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { schedulerEngine, type IDagOrchestrator } from './scheduler-engine';
import { slotPool } from './slot-pool';
import { eventStore } from '../infra/event-store';
import { TaskStateMachine, aggregateTaskStatus } from './task-state-machine';
import { eventBus } from '../infra/event-bus';
import type { DagNodeForVerification } from './state-reconciler';
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
  private dags = new Map<string, DagInstance>();
  private _initialized = false;

  /**
   * 鍒濆鍖栫紪鎺掑櫒
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    // 璁剧疆璋冨害鍣ㄥ洖璋?
    slotPool.setSchedulerCallback((slotType) => {
      schedulerEngine.onSlotFreed(slotType);
    });

    // 璁剧疆璋冨害鍣ㄧ殑缂栨帓鍣ㄥ紩鐢?
    schedulerEngine.setDagOrchestrator(this);

    // 浠?EventStore 鎭㈠
    await eventStore.initialize();
    await this.restoreFromSnapshots();

    this._initialized = true;
    console.log('[DagOrchestrator] 鍒濆鍖栧畬鎴?);
  }

  /**
   * 鎻愪氦 DAG
   */
  async submitDag(definition: DagDefinition): Promise<string> {
    const dagId = definition.id;

    // 1. 鍒涘缓 DAG 瀹炰緥
    const dag: DagInstance = {
      id: dagId,
      definition,
      nodes: new Map(),
      createdAt: new Date(),
    };

    // 2. 涓烘瘡涓妭鐐瑰垱寤虹姸鎬佹満
    for (const nodeDef of definition.nodes) {
      const fsm = new TaskStateMachine(dagId, nodeDef.id, nodeDef.phase, NodeState.PENDING);
      dag.nodes.set(nodeDef.id, {
        definition: nodeDef,
        fsm,
        result: null,
      });
    }

    // 3. 瀛樺偍鍒板唴瀛?
    this.dags.set(dagId, dag);

    // 4. 杩藉姞浜嬩欢
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

    // 5. 鍙戝皠 EventBus 浜嬩欢
    eventBus.emit('dag:created', { dagId, taskType: definition.taskType });

    console.log(`[DagOrchestrator] DAG ${dagId} 宸叉彁浜?(${definition.nodes.length} 涓妭鐐?`);

    // 6. 婵€娲绘棤渚濊禆鐨勮妭鐐?
    await this.activateReadyNodes(dagId);

    return dagId;
  }

  /**
   * 激活就绪节点
   *
   * 检查所有 PENDING 节点的依赖是否已完成。
   * 先提交到调度器，提交成功后才将状态转为 QUEUED，
   * 避免队列满时状态与调度器不一致。
   */
  private async activateReadyNodes(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    for (const [nodeId, node] of dag.nodes) {
      if (node.fsm.state !== NodeState.PENDING) continue;

      // 检查所有依赖是否已完成
      const deps = node.definition.dependencies;
      const allDepsCompleted = deps.every((depId) => {
        const depNode = dag.nodes.get(depId);
        return depNode?.fsm.state === NodeState.COMPLETED;
      });

      if (allDepsCompleted) {
        // 依赖已满足 → 转换为 READY
        await node.fsm.transition(
          NodeState.READY,
          { reason: 'dependencies satisfied', triggeredBy: 'system' },
          eventStore,
        );

        // 先提交给调度器，提交成功后再转 QUEUED
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

        if (submitted) {
          // 提交成功 → 转换为 QUEUED
          await node.fsm.transition(
            NodeState.QUEUED,
            { reason: 'submitted to scheduler', triggeredBy: 'system' },
            eventStore,
          );
        } else {
          // 队列满，保持 READY 状态，等待槽位释放后重新调度
          // 调度器定时扫描会重新触发调度
          console.warn(
            `[DagOrchestrator] 节点 ${nodeId} 提交失败（队列满），保持 READY 状态等待重试`,
          );
        }
      }
    }
  }

  /**
   * 鑺傜偣瀹屾垚鍥炶皟
   */
  async onNodeCompleted(nodeId: string, result: NodeExecutionResult): Promise<void> {
    // 鏌ユ壘鑺傜偣鎵€灞炵殑 DAG
    for (const [dagId, dag] of this.dags) {
      const node = dag.nodes.get(nodeId);
      if (!node) continue;

      // 瀛樺偍鎵ц缁撴灉锛堜紶閫掔粰鍚庣画鑺傜偣锛?
      node.result = result;

      // 杩藉姞浜嬩欢
      await eventStore.append({
        seq: 0,
        type: 'dag:nodeCompleted',
        dagId,
        nodeId,
        timestamp: new Date(),
        payload: { result },
      });

      // 婵€娲诲悗缁妭鐐?
      await this.activateReadyNodes(dagId);

      // 妫€鏌?DAG 鏄惁鍏ㄩ儴瀹屾垚
      await this.checkDagCompletion(dagId);

      return;
    }
  }

  /**
   * 鑺傜偣鐘舵€佽浆鎹紙渚?SchedulerEngine 璋冪敤锛?
   */
  async transitionNode(
    nodeId: string,
    toState: NodeState,
    context: TransitionContext,
  ): Promise<void> {
    for (const [, dag] of this.dags) {
      const node = dag.nodes.get(nodeId);
      if (node) {
        await node.fsm.transition(toState, context, eventStore);

        // 濡傛灉杩涘叆缁堟€侊紝鏇存柊 DB 鐘舵€?
        if (isTerminalState(toState) || toState === NodeState.RUNNING) {
          await this.updateDBTaskStatus(dag.id);
        }
        return;
      }
    }
    console.warn(`[DagOrchestrator] 鑺傜偣 ${nodeId} 鏈壘鍒帮紝鏃犳硶杞崲鐘舵€乣);
  }

  /**
   * 鑾峰彇鑺傜偣鐢ㄤ簬鏍￠獙鐨勪俊鎭?
   */
  getNodeForVerification(nodeId: string): DagNodeForVerification | null {
    for (const [, dag] of this.dags) {
      const node = dag.nodes.get(nodeId);
      if (node) {
        return {
          nodeId,
          dagId: dag.id,
          state: node.fsm.state,
          phase: node.definition.phase,
          config: node.definition.config,
          fsm: node.fsm,
        };
      }
    }
    return null;
  }

  /**
   * 妫€鏌?DAG 鏄惁鍏ㄩ儴瀹屾垚
   */
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
      eventBus.emit('dag:completed', { dagId });
      console.log(`[DagOrchestrator] DAG ${dagId} 鍏ㄩ儴瀹屾垚 鉁卄);

      await this.updateDBTaskStatus(dagId);
    } else if (anyFailed || anyCancelled) {
      // 妫€鏌ユ槸鍚︽墍鏈夎妭鐐归兘宸插埌缁堟€?
      const allTerminal = allNodes.every((n) => isTerminalState(n.fsm.state));
      if (allTerminal) {
        console.log(`[DagOrchestrator] DAG ${dagId} 宸茬粨鏉燂紙鍚け璐?鍙栨秷锛塦);
        await this.updateDBTaskStatus(dagId);
      }
    }
  }

  /**
   * 鏇存柊 DB 浠诲姟鐘舵€侊紙鑱氬悎鎵€鏈夎妭鐐圭姸鎬侊級
   */
  private async updateDBTaskStatus(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    const nodes = Array.from(dag.nodes.values()).map((n) => ({
      state: n.fsm.state,
      phase: n.definition.phase,
      error: n.fsm.error,
    }));

    const taskStatus = aggregateTaskStatus(nodes);

    // 鏍规嵁 DAG 绫诲瀷鏇存柊瀵瑰簲鐨?DB 琛?
    if (dag.definition.taskType === 'gallery') {
      const galleryId = parseInt(dagId.replace('gallery-', ''), 10);
      if (!isNaN(galleryId)) {
        try {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: taskStatus },
          });
        } catch (err) {
          console.error(`[DagOrchestrator] 鏇存柊鍥惧簱 ${galleryId} 鐘舵€佸け璐?`, err);
        }
      }
    }
  }

  /**
   * 鍙栨秷 DAG
   */
  async cancelDag(dagId: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    for (const [nodeId, node] of dag.nodes) {
      if (!isTerminalState(node.fsm.state)) {
        // 鍙栨秷璋冨害
        schedulerEngine.cancelNode(nodeId);

        // 閲婃斁璧勬簮
        slotPool.releaseAll(nodeId);

        // 鐘舵€佽浆鎹?
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

    eventBus.emit('dag:cancelled', { dagId });
    console.log(`[DagOrchestrator] DAG ${dagId} 宸插彇娑坄);

    await this.updateDBTaskStatus(dagId);
  }

  /**
   * 恢复被挂起的 DAG（用于服务重启后手动恢复）
   *
   * 将所有 PAUSED 节点重新提交到调度器。
   * 设计理由：
   * - 服务重启后所有活跃节点转为 PAUSED，需要用户确认后手动恢复
   * - 恢复时保留原有优先级和配置
   * - 提交失败（队列满）的节点保持 READY 状态，等待调度器扫描重试
   */
  async resumeDag(dagId: string, nodeId?: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) {
      console.warn(`[DagOrchestrator] DAG ${dagId} 未找到，无法恢复`);
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

      // PAUSED → READY
      await node.fsm.transition(
        NodeState.READY,
        { reason: 'user resumed after restart', triggeredBy: 'user' },
        eventStore,
      );

      // 提交到调度器
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
        // 提交成功 → QUEUED
        await node.fsm.transition(
          NodeState.QUEUED,
          { reason: 're-submitted after resume', triggeredBy: 'system' },
          eventStore,
        );
        resumedCount++;
      } else {
        // 队列满，保持 READY 状态等待重试
        console.warn(
          `[DagOrchestrator] 恢复节点 ${node.definition.id} 提交失败（队列满），保持 READY 状态`,
        );
      }
    }

    console.log(
      `[DagOrchestrator] DAG ${dagId} 恢复完成: ${resumedCount}/${nodesToResume.length} 个节点已重新提交`,
    );

    await this.updateDBTaskStatus(dagId);
  }

  /**
   * 閲嶈瘯 DAG 涓殑澶辫触鑺傜偣
   */
  async retryDag(dagId: string, nodeId?: string): Promise<void> {
    const dag = this.dags.get(dagId);
    if (!dag) return;

    const nodesToRetry = nodeId
      ? [dag.nodes.get(nodeId)!].filter(Boolean)
      : Array.from(dag.nodes.values()).filter(
          (n) =>
            n.fsm.state === NodeState.FAILED ||
            n.fsm.state === NodeState.TIMEOUT,
        );

    for (const node of nodesToRetry) {
      if (!node) continue;

      // 鐘舵€佽浆鎹細FAILED 鈫?READY
      await node.fsm.transition(
        NodeState.READY,
        { reason: 'user retry', triggeredBy: 'user' },
        eventStore,
      );

      // 璁剧疆楂樹紭鍏堢骇
      node.definition.priority = TaskPriority.CRITICAL;

      // 閲嶆柊鎻愪氦
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

      schedulerEngine.submit(schedulableNode);
    }

    console.log(`[DagOrchestrator] DAG ${dagId} 閲嶈瘯 ${nodesToRetry.length} 涓妭鐐筦);
  }

  /**
   * 鑾峰彇 DAG 鐘舵€?
   */
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

  /**
   * 鑾峰彇 DAG 蹇収锛堢敤浜?EventStore 鎭㈠锛?
   */
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

  /**
   * 鑾峰彇鎵€鏈?DAG 蹇収
   */
  getAllDagSnapshots(): DagSnapshot[] {
    return Array.from(this.dags.keys())
      .map((id) => this.getDagSnapshot(id)!)
      .filter(Boolean);
  }

  /**
   * 浠庡揩鐓ф仮澶?DAG
   */
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
        nodeState.state, // 鎭㈠鍒板揩鐓ф椂鐨勭姸鎬?
      );
      dag.nodes.set(nodeState.nodeId, {
        definition: nodeDef,
        fsm,
        result: nodeState.result,
      });
    }

    this.dags.set(snapshot.dagId, dag);
    console.log(
      `[DagOrchestrator] 鎭㈠ DAG ${snapshot.dagId} (${snapshot.nodeStates.length} 涓妭鐐?`,
    );
  }

  /**
   * 搴旂敤浜嬩欢锛堜粠 EventStore 鍥炴斁锛?
   */
  async applyEvent(_event: DagEvent): Promise<void> {
    // 浜嬩欢鍥炴斁涓昏鐢ㄤ簬鎭㈠鐘舵€佹満
    // 鐢变簬鐘舵€佹満鐨?transition() 鏂规硶宸茬粡鏍￠獙鍚堟硶鎬э紝
    // 鍥炴斁鏃跺彧闇€纭繚鐘舵€佷竴鑷存€?
    // 鍏蜂綋瀹炵幇鍙栧喅浜庝簨浠剁被鍨?
  }

  /**
   * 从快照恢复所有 DAG
   *
   * 服务重启后的恢复策略：
   * 1. 从 EventStore 快照恢复所有 DAG 实例
   * 2. 将所有活跃节点（RUNNING/ALLOCATED/READY/QUEUED/VERIFYING）转为 PAUSED
   * 3. 释放槽位、取消调度，等待用户手动恢复
   *
   * 设计理由：
   * - 服务重启意味着所有执行上下文已丢失，自动恢复执行可能产生数据不一致
   * - 转为 PAUSED 让用户确认后手动恢复，确保安全
   * - 关联日志：260717/12-dag-startup-recovery-fix.md
   */
  private async restoreFromSnapshots(): Promise<void> {
    await eventStore.restoreFromSnapshot(
      async (snapshot) => {
        await this.restoreDag(snapshot);
      },
      async (event) => {
        await this.applyEvent(event);
      },
    );

    // 恢复后，将所有活跃节点转为 PAUSED 状态
    let pausedCount = 0;
    for (const [dagId, dag] of this.dags) {
      for (const [nodeId, node] of dag.nodes) {
        // 活跃状态：这些状态意味着服务崩溃前节点正在执行或排队中
        const activeStates = [
          NodeState.RUNNING,
          NodeState.ALLOCATED,
          NodeState.READY,
          NodeState.QUEUED,
          NodeState.VERIFYING,
        ];

        if (activeStates.includes(node.fsm.state)) {
          // 释放可能残留的槽位
          slotPool.releaseAll(nodeId);
          // 取消调度器中的排队
          schedulerEngine.cancelNode(nodeId);

          // 尝试转为 PAUSED
          if (node.fsm.canTransitionTo(NodeState.PAUSED)) {
            await node.fsm.transition(
              NodeState.PAUSED,
              {
                reason: 'service restarted, task suspended for manual recovery',
                triggeredBy: 'system',
              },
              eventStore,
            );
            pausedCount++;
          } else {
            // 如果无法直接转 PAUSED（如 VERIFYING 状态），先重置到 READY 再转 PAUSED
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
              pausedCount++;
            }
          }
        }
      }

      // 更新 DB 任务状态
      if (pausedCount > 0) {
        await this.updateDBTaskStatus(dagId);
      }
    }

    if (pausedCount > 0) {
      console.log(
        `[DagOrchestrator] 重启恢复完成: ${pausedCount} 个节点已挂起，等待用户手动恢复`,
      );
    }
  }

  /**
   * 鍒涘缓瀹氭椂蹇収
   */
  async createSnapshot(): Promise<void> {
    const snapshots = this.getAllDagSnapshots();
    if (snapshots.length > 0) {
      await eventStore.snapshot(snapshots);
    }
  }

  /**
   * 鑾峰彇鎵€鏈夋椿璺?DAG 鐨勭粺璁?
   */
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
