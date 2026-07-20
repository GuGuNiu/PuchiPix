import { NextResponse } from 'next/server';
import { lifecycle } from '@/lib/core/infra/lifecycle';
import { eventBus } from '@/lib/core/infra/event-bus';
import { ttlLock } from '@/lib/core/infra/ttl-lock';
import { workerManager } from '@/lib/core/infra/worker-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const health = lifecycle.getHealthInfo();
  const busStats = eventBus.getStats();
  const lockStats = ttlLock.getStats();
  const activeLocks = ttlLock.getActiveLocks();

  let ouoStatus: unknown = null;
  let domainHealth: unknown = null;

  try {
    const { getOuoOrchestrator } = await import('@/lib/core/orchestrator/ouo-orchestrator');
    ouoStatus = getOuoOrchestrator().getStatus();
  } catch {
  }

  try {
    const { getDomainHealthTracker } = await import('@/lib/core/domain/domain-health-tracker');
    const tracker = getDomainHealthTracker();
    domainHealth = {
      rateLimitedDomains: tracker.getRateLimitedDomains(),
    };
  } catch {
  }

  return NextResponse.json({
    status: lifecycle.isHealthy() ? 'ok' : 'degraded',
    lifecycle: health,
    worker: workerManager.getStats(),
    eventBus: busStats,
    locks: {
      active: lockStats.activeLocks,
      waiters: lockStats.totalWaiters,
      reentrant: lockStats.reentrantLocks,
      details: activeLocks,
    },
    ouo: ouoStatus,
    domainHealth,
    time: Date.now(),
    version: '2.5.0',
  });
}
