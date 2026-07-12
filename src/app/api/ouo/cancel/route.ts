/**
 * OUO 编排器取消任务 API
 *
 * POST /api/ouo/cancel
 *   功能: 取消队列中指定图库的待处理任务
 *   请求体: { galleryId: number }
 *   返回: { cancelled: boolean }
 *
 * @date 2026-07-12
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/ouo-orchestrator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { galleryId } = body;

    if (!galleryId) {
      return NextResponse.json(
        { error: '缺少必需参数: galleryId' },
        { status: 400 },
      );
    }

    const orchestrator = getOuoOrchestrator();
    const cancelled = orchestrator.cancel(galleryId);

    return NextResponse.json({ cancelled });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
