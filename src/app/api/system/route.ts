import { NextResponse } from 'next/server';
import { dagSystem } from '@/lib/core/orchestrator/dag/init';
import { dagConfig } from '@/lib/core/orchestrator/dag/config';
import { dagOrchestrator } from '@/lib/core/orchestrator/dag/orchestrator';
import { schedulerEngine } from '@/lib/core/orchestrator/scheduler-engine';
import { slotPool } from '@/lib/core/orchestrator/slot/pool';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    dag: {
      initialized: dagSystem.initialized,
      enabled: dagConfig.enabled,
      taskTypes: Array.from(dagConfig.taskTypes),
    },
    scheduler: schedulerEngine.getQueueStats(),
    slotPool: slotPool.getSnapshot(),
    dagStats: dagOrchestrator.getStats(),
  });
}
