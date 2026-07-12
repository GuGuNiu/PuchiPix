/**
 * history/route.ts — 下载历史 API
 *
 * GET    /api/history — 获取已完成/失败/取消的历史任务
 * DELETE /api/history — 清空历史记录
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { mapTask } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// GET /api/history — 获取历史记录
// ============================================================
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const tasks = await prisma.downloadTask.findMany({
      where: {
        status: { in: ['completed', 'failed', 'cancelled'] },
      },
      include: { videoInfo: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return NextResponse.json(tasks.map(mapTask));
  } catch {
    return NextResponse.json({ error: 'Failed to get history' }, { status: 500 });
  }
}

// ============================================================
// DELETE /api/history — 清空历史记录
// ============================================================
export async function DELETE(): Promise<NextResponse> {
  try {
    await prisma.downloadTask.deleteMany({
      where: {
        status: { in: ['completed', 'failed', 'cancelled'] },
      },
    });

    return NextResponse.json({ message: 'History cleared' });
  } catch {
    return NextResponse.json({ error: 'Failed to clear history' }, { status: 500 });
  }
}
