/**
 * OUO 任务编排器 API
 *
 * GET /api/ouo
 *   功能: 查询编排器状态和历史记录
 *   返回: { status, history }
 *
 * @date 2026-07-12
 */

import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/ouo-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  const status = orchestrator.getStatus();
  const history = orchestrator.getHistory(20);

  return NextResponse.json({ status, history });
}
