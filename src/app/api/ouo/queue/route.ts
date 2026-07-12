/**
 * OUO 任务队列入队 API
 *
 * POST /api/ouo/queue
 *   功能: 将一个或多个 OUO 下载任务加入编排器队列
 *   请求体:
 *     单个: { galleryId: number, ouoUrl: string, manualUrl?: string, maxRetries?: number }
 *     批量: { tasks: Array<{ galleryId, ouoUrl, manualUrl?, maxRetries? }> }
 *   返回: { queued: number, queuePosition?: number }
 *
 * DELETE /api/ouo/queue
 *   功能: 清空队列中的所有待处理任务
 *   返回: { cleared: number }
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
    const orchestrator = getOuoOrchestrator();

    // 批量入队
    if (Array.isArray(body.tasks)) {
      const count = orchestrator.enqueueBatch(body.tasks);
      return NextResponse.json({ queued: count });
    }

    // 单个入队
    const { galleryId, ouoUrl, manualUrl, maxRetries } = body;

    if (!galleryId || !ouoUrl) {
      return NextResponse.json(
        { error: '缺少必需参数: galleryId, ouoUrl' },
        { status: 400 },
      );
    }

    const position = orchestrator.enqueue(galleryId, ouoUrl, manualUrl, maxRetries);

    return NextResponse.json({ queued: 1, queuePosition: position });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enqueue task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  const cleared = orchestrator.clearQueue();
  return NextResponse.json({ cleared });
}
