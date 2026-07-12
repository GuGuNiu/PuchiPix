/**
 * search/route.ts — 搜索引擎 API
 *
 * POST /api/search       — 启动搜索任务（支持指定站点）
 * GET  /api/search       — 获取所有搜索任务列表
 * DELETE /api/search     — 取消搜索任务
 *
 * 请求体示例：
 *   {
 *     "keywords": "女仆, 天使, 调教",
 *     "siteId": "kanav"        // 可选，默认使用 kanav
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search/search-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// POST /api/search — 启动搜索任务
// ============================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { keywords, siteId } = body;

    if (!keywords || typeof keywords !== 'string' || keywords.trim().length === 0) {
      return NextResponse.json({ error: '请提供搜索关键词' }, { status: 400 });
    }

    const engine = getSearchEngine();
    const job = await engine.search(keywords, siteId);

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start search';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ============================================================
// GET /api/search — 获取所有搜索任务
// ============================================================
export async function GET(): Promise<NextResponse> {
  try {
    const engine = getSearchEngine();
    const jobs = engine.getAllJobs();
    return NextResponse.json(jobs);
  } catch {
    return NextResponse.json({ error: 'Failed to get search jobs' }, { status: 500 });
  }
}
