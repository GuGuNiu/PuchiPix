/**
 * OUO 编排器恢复 API
 *
 * POST /api/ouo/resume
 *   功能: 恢复 OUO 编排器，继续处理队列中的任务
 *   返回: { resumed: true }
 *
 * @date 2026-07-12
 */

import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/ouo-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  orchestrator.resume();
  return NextResponse.json({ resumed: true });
}
