/**
 * GET  /api/dag/[dagId]      — Get full snapshot of a specific DAG
 * POST /api/dag/[dagId]      — Control a DAG (body.action = pause|resume|retry|cancel)
 *
 * GET reads from the main-process DagSnapshotCache (populated via IPC from the
 * Worker). POST sends an IPC command to the Worker via workerManager.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { dagSnapshotCache } from '@/lib/core/orchestrator/dag/snapshot-cache';
import { createLogger, runWithTraceContext } from '@/lib/core/infra/logger';
import { workerManager } from '@/lib/core/infra/worker-manager';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';
import type { NodeSnapshot, DagSnapshot } from '@/types/dag';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('DAG-API');

function serializeDagDetail(snapshot: DagSnapshot): Record<string, unknown> {
  return {
    dagId: snapshot.dagId,
    taskType: snapshot.definition.taskType,
    sourceUrl: snapshot.definition.metadata.sourceUrl,
    providerId: snapshot.definition.metadata.providerId,
    createdAt: snapshot.createdAt.toISOString(),
    definition: {
      nodeCount: snapshot.definition.nodes.length,
      nodes: snapshot.definition.nodes.map((n) => ({
        id: n.id,
        phase: n.phase,
        executor: n.executor,
        priority: n.priority,
        dependencies: n.dependencies,
        resourceRequirements: n.resourceRequirements,
        timeout: n.timeout,
        maxRetries: n.maxRetries,
      })),
    },
    nodes: snapshot.nodeStates.map((ns: NodeSnapshot) => ({
      nodeId: ns.nodeId,
      state: ns.state,
      error: ns.error,
      result: ns.result,
      history: ns.history.map((h) => ({
        from: h.from,
        to: h.to,
        timestamp: h.timestamp.toISOString(),
        reason: h.context.reason,
        triggeredBy: h.context.triggeredBy,
        error: h.context.error,
      })),
    })),
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dagId: string }> },
): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  const { dagId } = await params;

  return runWithTraceContext({ dagId }, () => {
    try {
      const snapshot = dagSnapshotCache.getDagSnapshot(dagId);
      if (!snapshot) {
        logger.warn('DAG not found', { dagId, cacheAvailable: dagSnapshotCache.isAvailable() });
        return NextResponse.json(
          { success: false, error: t('api.dag.notFound', { dagId }) },
          { status: 404 },
        );
      }

      logger.info('Query DAG detail', { dagId });
      const workerStats = workerManager.getStats();
      const workerDown = workerStats.status !== 'ready';
      return NextResponse.json({
        success: true,
        data: {
          ...serializeDagDetail(snapshot),
          ...(workerDown ? { workerDown: true } : {}),
        },
      });
    } catch (err) {
      logger.error('Failed to query DAG detail', { dagId, error: err });
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'Internal error' },
        { status: 500 },
      );
    }
  });
}

interface ControlBody {
  action: 'pause' | 'resume' | 'retry' | 'cancel';
  nodeId?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ dagId: string }> },
): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  const { dagId } = await params;

  return runWithTraceContext({ dagId }, async () => {
    try {
      const body: ControlBody = await request.json();
      const { action, nodeId } = body;

      if (!action || !['pause', 'resume', 'retry', 'cancel'].includes(action)) {
        return NextResponse.json(
          { success: false, error: t('api.dag.invalidAction', { action }) },
          { status: 400 },
        );
      }

      const workerStats = workerManager.getStats();
      if (workerStats.status !== 'ready') {
        return NextResponse.json(
          { success: false, error: 'Worker offline, cannot execute control command' },
          { status: 503 },
        );
      }

      logger.info('DAG control operation', { dagId, action, nodeId });

      const sent = workerManager.send({
        type: 'dag:command',
        payload: { dagId, command: action, nodeId },
      });

      if (!sent) {
        return NextResponse.json(
          { success: false, error: 'Worker unavailable' },
          { status: 503 },
        );
      }

      logger.info('DAG control command sent to worker', { dagId, action });

      return NextResponse.json({
        success: true,
        data: {
          dagId,
          action,
          snapshot: null,
        },
      });
    } catch (err) {
      logger.error('DAG control operation failed', { dagId, error: err });
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'Internal error' },
        { status: 500 },
      );
    }
  });
}
