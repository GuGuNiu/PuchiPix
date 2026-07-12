import { NextResponse } from 'next/server';
import { lifecycle } from '@/lib/core/lifecycle';
import { eventBus } from '@/lib/core/event-bus';
import { ttlLock } from '@/lib/core/ttl-lock';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const health = lifecycle.getHealthInfo();
  const busStats = eventBus.getStats();
  const activeLocks = ttlLock.getActiveLocks();

  return NextResponse.json({
    status: lifecycle.isHealthy() ? 'ok' : 'degraded',
    lifecycle: health,
    eventBus: busStats,
    activeLocks: activeLocks.length,
    time: Date.now(),
    version: '2.0.0',
  });
}
