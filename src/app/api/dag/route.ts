/**
 * GET /api/dag — List all DAGs and their node status summary.
 *
 * Reads from the main-process DagSnapshotCache (populated via IPC from the
 * Worker) instead of calling dagOrchestrator directly, since the singleton
 * is only initialised inside the Worker process.
 */

import { NextResponse } from 'next/server';
import { dagSnapshotCache } from '@/lib/core/orchestrator/dag/snapshot-cache';
import { workerManager } from '@/lib/core/infra/worker-manager';
import { createLogger } from '@/lib/core/infra/logger';
import { NodeState, type NodeSnapshot, type DagSnapshot } from '@/types/dag';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('DAG-API');

function serializeDag(snapshot: DagSnapshot): Record<string, unknown> {
  const nodes = snapshot.nodeStates.map((ns: NodeSnapshot) => ({
    nodeId: ns.nodeId,
    state: ns.state,
    error: ns.error,
    hasResult: ns.result !== null,
    historyCount: ns.history.length,
    lastTransition: ns.history.length > 0
      ? {
          from: ns.history[ns.history.length - 1].from,
          to: ns.history[ns.history.length - 1].to,
          reason: ns.history[ns.history.length - 1].context.reason,
          triggeredBy: ns.history[ns.history.length - 1].context.triggeredBy,
          timestamp: ns.history[ns.history.length - 1].timestamp.toISOString(),
        }
      : null,
  }));

  const nodeStates = nodes.map((n) => n.state);
  const completedCount = nodeStates.filter((s) => s === NodeState.COMPLETED).length;
  const failedCount = nodeStates.filter((s) => s === NodeState.FAILED || s === NodeState.TIMEOUT).length;
  const runningCount = nodeStates.filter((s) =>
    [NodeState.RUNNING, NodeState.ALLOCATED, NodeState.VERIFYING].includes(s)
  ).length;
  const pausedCount = nodeStates.filter((s) => s === NodeState.PAUSED).length;
  const queuedCount = nodeStates.filter((s) =>
    [NodeState.PENDING, NodeState.READY, NodeState.QUEUED].includes(s)
  ).length;

  return {
    dagId: snapshot.dagId,
    taskType: snapshot.definition.taskType,
    sourceUrl: snapshot.definition.metadata.sourceUrl,
    createdAt: snapshot.createdAt.toISOString(),
    nodeCount: nodes.length,
    progress: {
      completed: completedCount,
      failed: failedCount,
      running: runningCount,
      paused: pausedCount,
      queued: queuedCount,
    },
    nodes,
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const snapshots = dagSnapshotCache.getAllDagSnapshots();
    const dagStats = dagSnapshotCache.getDagStats();
    const schedulerStats = dagSnapshotCache.getSchedulerStats();
    const slotSnapshot = dagSnapshotCache.getSlotSnapshot();

    const dags = snapshots.map(serializeDag);

    logger.info('Query all DAG statuses', {
      dagCount: dags.length,
      cacheAvailable: dagSnapshotCache.isAvailable(),
    });

    const workerStats = workerManager.getStats();
    const workerDown = workerStats.status !== 'ready';

    return NextResponse.json({
      success: true,
      data: {
        dags,
        stats: {
          ...dagStats,
          scheduler: schedulerStats,
          slots: slotSnapshot,
        },
        ...(workerDown ? { workerDown: true } : {}),
        ...(dagSnapshotCache.isAvailable() ? {} : { cachePending: true }),
      },
    });
  } catch (err) {
    logger.error('Failed to query DAG list', { error: err });
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
