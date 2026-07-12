/**
 * search/[id]/route.ts — 单个搜索任务状态 API
 *
 * GET    /api/search/:id — 获取搜索任务状态
 * DELETE /api/search/:id — 取消搜索任务
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search/search-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// GET /api/search/:id — 获取搜索任务状态
// ============================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const engine = getSearchEngine();
    const job = engine.getJob(id);

    if (!job) {
      return NextResponse.json({ error: 'Search job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: 'Failed to get search job' }, { status: 500 });
  }
}

// ============================================================
// DELETE /api/search/:id — 取消搜索任务
// ============================================================
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const engine = getSearchEngine();

    if (engine.cancelJob(id)) {
      return NextResponse.json({ message: 'Search job cancelled', id });
    }
    return NextResponse.json({ error: 'Search job not found' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Failed to cancel search job' }, { status: 500 });
  }
}
