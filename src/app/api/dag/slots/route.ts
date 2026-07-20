/**
 * GET /api/dag/slots — Query slot pool usage.
 *
 * Reads from the main-process DagSnapshotCache (populated via IPC from the
 * Worker) instead of calling slotPool directly, since the singleton is only
 * initialised inside the Worker process.
 */

import { NextResponse } from 'next/server';
import { dagSnapshotCache } from '@/lib/core/orchestrator/dag/snapshot-cache';
import { createLogger } from '@/lib/core/infra/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('DAG-API');

export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = dagSnapshotCache.getSlotSnapshot();
    const stats = dagSnapshotCache.getSlotStats();
    const activeHolders = dagSnapshotCache.getActiveHolders();
    const downloadConcurrency = dagSnapshotCache.getDownloadConcurrency();

    logger.info('Query slot pool status', {
      cacheAvailable: dagSnapshotCache.isAvailable(),
    });

    return NextResponse.json({
      success: true,
      data: {
        snapshot,
        stats,
        activeHolders,
        downloadConcurrency,
      },
    });
  } catch (err) {
    logger.error('Failed to query slot pool status', { error: err });
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
