import { NextResponse } from 'next/server';
import { lifecycle } from '@/lib/core/lifecycle';
import { eventBus } from '@/lib/core/event-bus';
import { ttlLock } from '@/lib/core/ttl-lock';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const health = lifecycle.getHealthInfo();
  const busStats = eventBus.getStats();
  const lockStats = ttlLock.getStats();
  const activeLocks = ttlLock.getActiveLocks();

  // 收集各组件状态（延迟加载，避免初始化未就绪时报错）
  let ouoStatus: unknown = null;
  let domainHealth: unknown = null;

  try {
    const { getOuoOrchestrator } = await import('@/lib/core/ouo-orchestrator');
    ouoStatus = getOuoOrchestrator().getStatus();
  } catch {
  }

  try {
    const { getGlobalDomainHealthTracker } = await import('@/lib/core/domain-health-tracker');
    const tracker = getGlobalDomainHealthTracker();
    domainHealth = {
      rateLimitedDomains: tracker.getRateLimitedDomains(),
    };
  } catch {
  }

  return NextResponse.json({
    status: lifecycle.isHealthy() ? 'ok' : 'degraded',
    lifecycle: health,
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
