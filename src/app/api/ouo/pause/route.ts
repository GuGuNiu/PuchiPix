import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/orchestrator/ouo-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  orchestrator.pause();
  return NextResponse.json({ paused: true });
}
