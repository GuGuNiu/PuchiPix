import type { NextRequest } from 'next/server';
import { eventBus } from '@/lib/core/infra/event-bus';
import { dagSnapshotCache } from '@/lib/core/orchestrator/dag/snapshot-cache';
import { createLogger } from '@/lib/core/infra/logger';
import type { DagSnapshot, NodeSnapshot } from '@/types/dag';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('DAG-SSE');

function serializeDagSnapshot(snapshot: DagSnapshot): Record<string, unknown> {
  return {
    dagId: snapshot.dagId,
    taskType: snapshot.definition.taskType,
    sourceUrl: snapshot.definition.metadata.sourceUrl,
    createdAt: snapshot.createdAt.toISOString(),
    nodes: snapshot.nodeStates.map((ns: NodeSnapshot) => ({
      nodeId: ns.nodeId,
      state: ns.state,
      error: ns.error,
      result: ns.result,
      historyCount: ns.history.length,
      lastTransition: ns.history.length > 0
        ? {
            from: ns.history[ns.history.length - 1].from,
            to: ns.history[ns.history.length - 1].to,
            timestamp: ns.history[ns.history.length - 1].timestamp.toISOString(),
            reason: ns.history[ns.history.length - 1].context.reason,
            triggeredBy: ns.history[ns.history.length - 1].context.triggeredBy,
          }
        : null,
    })),
  };
}

/** Collect system stats from the main-process cache (not the Worker singletons). */
function getSystemStats(): Record<string, unknown> {
  const dagStats = dagSnapshotCache.getDagStats();
  const schedulerStats = dagSnapshotCache.getSchedulerStats();
  const slotSnapshot = dagSnapshotCache.getSlotSnapshot();
  return {
    dags: dagStats,
    scheduler: schedulerStats,
    slots: slotSnapshot,
    timestamp: new Date().toISOString(),
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();
  const sseLogger = logger.child({ traceId: `sse-${Date.now()}` });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      sseLogger.info('DAG SSE client connected');

      // ── Push initial full snapshot from cache ─────────────────────────
      try {
        const snapshots = dagSnapshotCache.getAllDagSnapshots();
        const serialized = snapshots.map(serializeDagSnapshot);
        send('initial', { dags: serialized, count: serialized.length });
        sseLogger.info('Initial snapshot pushed', {
          dagCount: serialized.length,
          cacheAvailable: dagSnapshotCache.isAvailable(),
        });
      } catch (err) {
        sseLogger.error('Failed to push initial snapshot', err);
        send('initial', { dags: [], count: 0, error: 'failed to load snapshots' });
      }

      // ── Push system stats ────────────────────────────────────────────
      send('stats', getSystemStats());

      // ── Subscribe to DAG events (forwarded via IPC → EventBus) ───────
      const subs: Array<{ unsubscribe: () => void }> = [];

      // DAG lifecycle events
      subs.push(
        eventBus.on('dag:created', (p) => {
          const snapshot = dagSnapshotCache.getDagSnapshot(p.dagId);
          if (snapshot) {
            send('dag:created', serializeDagSnapshot(snapshot));
          } else {
            send('dag:created', { dagId: p.dagId, taskType: p.taskType });
          }
        }),
      );

      subs.push(
        eventBus.on('dag:completed', (p) => {
          const snapshot = dagSnapshotCache.getDagSnapshot(p.dagId);
          send('dag:completed', {
            dagId: p.dagId,
            snapshot: snapshot ? serializeDagSnapshot(snapshot) : null,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      subs.push(
        eventBus.on('dag:cancelled', (p) => {
          const snapshot = dagSnapshotCache.getDagSnapshot(p.dagId);
          send('dag:cancelled', {
            dagId: p.dagId,
            snapshot: snapshot ? serializeDagSnapshot(snapshot) : null,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      subs.push(
        eventBus.on('dag:paused', (p) => {
          const snapshot = dagSnapshotCache.getDagSnapshot(p.dagId);
          send('dag:paused', {
            dagId: p.dagId,
            pausedCount: p.pausedCount,
            snapshot: snapshot ? serializeDagSnapshot(snapshot) : null,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      subs.push(
        eventBus.on('dag:resumed', (p) => {
          const snapshot = dagSnapshotCache.getDagSnapshot(p.dagId);
          send('dag:resumed', {
            dagId: p.dagId,
            resumedCount: p.resumedCount,
            snapshot: snapshot ? serializeDagSnapshot(snapshot) : null,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      // Node state change events
      subs.push(
        eventBus.on('dag:nodeStateChanged', (p) => {
          send('dag:nodeStateChanged', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            from: p.from,
            to: p.to,
            timestamp: p.timestamp instanceof Date
              ? p.timestamp.toISOString()
              : new Date(p.timestamp).toISOString(),
          });
        }),
      );

      subs.push(
        eventBus.on('dag:nodeCompleted', (p) => {
          send('dag:nodeCompleted', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            result: p.result,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      subs.push(
        eventBus.on('dag:nodeFailed', (p) => {
          send('dag:nodeFailed', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            error: p.error,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      // Scheduling decision events
      subs.push(
        eventBus.on('dag:schedulingDecision', (p) => {
          send('dag:schedulingDecision', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            strategy: p.strategy,
            reason: p.reason,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      // Resource allocation/release events
      subs.push(
        eventBus.on('dag:resourceAllocated', (p) => {
          send('dag:resourceAllocated', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            resources: p.resources,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      subs.push(
        eventBus.on('dag:resourceReleased', (p) => {
          send('dag:resourceReleased', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            resources: p.resources,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      // Node progress events
      subs.push(
        eventBus.on('dag:nodeProgress', (p) => {
          send('dag:nodeProgress', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            phase: p.phase,
            current: p.current,
            total: p.total,
            speed: p.speed,
            failed: p.failed,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      // Node retry events
      subs.push(
        eventBus.on('dag:nodeRetrying', (p) => {
          send('dag:nodeRetrying', {
            dagId: p.dagId,
            nodeId: p.nodeId,
            retryCount: p.retryCount,
            error: p.error,
            timestamp: new Date().toISOString(),
          });
        }),
      );

      // Worker process events (dual-process architecture)
      subs.push(
        eventBus.on('worker:restarting', (p) => {
          send('worker:restarting', p);
        }),
      );

      subs.push(
        eventBus.on('worker:ready', (p) => {
          send('worker:ready', p);
        }),
      );

      subs.push(
        eventBus.on('task:stateReset', (p) => {
          send('task:stateReset', p);
        }),
      );

      const statsTimer = setInterval(() => {
        if (closed) return;
        send('stats', getSystemStats());
      }, 5000);

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, 15000);

      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(statsTimer);
        clearInterval(keepalive);
        for (const sub of subs) {
          sub.unsubscribe();
        }
        subs.length = 0;
        sseLogger.info('DAG SSE client disconnected');
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
