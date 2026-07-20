import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { eventStore } from '@/lib/core/infra/event-store';
import { dagSnapshotCache } from '@/lib/core/orchestrator/dag/snapshot-cache';
import { createLogger, runWithTraceContext } from '@/lib/core/infra/logger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const logger = createLogger('DAG-API');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dagId: string }> },
): Promise<NextResponse> {
  const { dagId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 1000);
  const fromSeq = parseInt(searchParams.get('fromSeq') || '0', 10) || 0;

  return runWithTraceContext({ dagId }, async () => {
    try {
      const allEvents = await eventStore.getDagEvents(dagId);
      const filtered = allEvents
        .filter((e) => e.seq > fromSeq)
        .slice(-limit);

      logger.info('Query DAG event history', {
        dagId,
        eventCount: filtered.length,
        totalEvents: allEvents.length,
      });

      return NextResponse.json({
        success: true,
        data: {
          dagId,
          events: filtered,
          totalEvents: allEvents.length,
          currentSeq: dagSnapshotCache.isAvailable()
            ? dagSnapshotCache.getCurrentSeq()
            : eventStore.currentSequence,
        },
      });
    } catch (err) {
      logger.error('Failed to query DAG event history', { dagId, error: err instanceof Error ? err.message : String(err) });
      return NextResponse.json(
        { success: false, error: err instanceof Error ? err.message : 'Internal error' },
        { status: 500 },
      );
    }
  });
}
