/**
 * search/batch/route.ts — 批量搜索任务 API
 *
 * POST /api/search/batch — 启动批量搜索任务（按标题模糊搜索 → 自动下载）
 * GET  /api/search/batch — 获取所有批量搜索任务列表
 *
 * 请求体示例：
 *   {
 *     "titles": "视频标题1\n视频标题2\n视频标题3",
 *     "siteId": "kanav"        // 可选，默认使用 kanav
 *   }
 *
 * @date 2026-07-09
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search/search-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// POST /api/search/batch — 启动批量搜索任务
// ============================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { titles, siteId } = body;

    if (!titles || typeof titles !== 'string' || titles.trim().length === 0) {
      return NextResponse.json({ error: '请提供视频标题' }, { status: 400 });
    }

    const engine = getSearchEngine();
    const job = await engine.batchSearch(titles, siteId);

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start batch search';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ============================================================
// GET /api/search/batch — 获取所有批量搜索任务
// ============================================================
export async function GET(): Promise<NextResponse> {
  try {
    const engine = getSearchEngine();
    const jobs = engine.getAllBatchJobs();
    return NextResponse.json(jobs);
  } catch {
    return NextResponse.json({ error: 'Failed to get batch search jobs' }, { status: 500 });
  }
}
