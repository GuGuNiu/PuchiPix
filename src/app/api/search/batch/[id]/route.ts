/**
 * search/batch/[id]/route.ts — 单个批量搜索任务状态 API
 *
 * GET    /api/search/batch/:id — 获取批量搜索任务状态
 * DELETE /api/search/batch/:id — 取消批量搜索任务
 *
 * @date 2026-07-09
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search/search-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// GET /api/search/batch/:id — 获取批量搜索任务状态
// ============================================================
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const engine = getSearchEngine();
    const job = engine.getBatchJob(id);

    if (!job) {
      return NextResponse.json({ error: 'Batch search job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: 'Failed to get batch search job' }, { status: 500 });
  }
}

// ============================================================
// DELETE /api/search/batch/:id — 取消批量搜索任务
// ============================================================
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const engine = getSearchEngine();

    if (engine.cancelBatchJob(id)) {
      return NextResponse.json({ message: 'Batch search job cancelled', id });
    }
    return NextResponse.json({ error: 'Batch search job not found' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Failed to cancel batch search job' }, { status: 500 });
  }
}
