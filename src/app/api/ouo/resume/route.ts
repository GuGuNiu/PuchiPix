import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/ouo-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();

  // 如果编排器未运行（被 stop 过），先 start 再 resume
  // 否则直接 resume
  if (!orchestrator.getStatus().running) {
    orchestrator.start();
  } else {
    orchestrator.resume();
  }

  return NextResponse.json({ resumed: true });
}
