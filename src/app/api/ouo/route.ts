import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/orchestrator/ouo-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  const status = orchestrator.getStatus();
  const history = orchestrator.getHistory(20);

  return NextResponse.json({ status, history });
}
