/**
 * GET /api/dag/scheduler — Query scheduler statistics.
 *
 * Reads from the main-process DagSnapshotCache (populated via IPC from the
 * Worker) instead of calling schedulerEngine directly, since the singleton
 * is only initialised inside the Worker process.
 */

import { NextResponse } from 'next/server';
import { dagSnapshotCache } from '@/lib/core/orchestrator/dag/snapshot-cache';
import { createLogger } from '@/lib/core/infra/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('DAG-API');

export async function GET(): Promise<NextResponse> {
  try {
    const stats = dagSnapshotCache.getSchedulerStats();
    logger.info('Query scheduler stats', {
      cacheAvailable: dagSnapshotCache.isAvailable(),
    });
    return NextResponse.json({ success: true, data: stats });
  } catch (err) {
    logger.error('Failed to query scheduler stats', { error: err });
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
