/**
 * OUO 编排器暂停 API
 *
 * POST /api/ouo/pause
 *   功能: 暂停 OUO 编排器，不再从队列中取出新任务
 *   返回: { paused: true }
 *
 * @date 2026-07-12
 */

import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/ouo-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  orchestrator.pause();
  return NextResponse.json({ paused: true });
}
