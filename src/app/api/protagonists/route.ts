/**
 * 主角展示架 API
 *
 * GET /api/protagonists
 *   功能: 获取所有主角列表及其图库统计
 *   返回: { protagonists: [{ name, count, coverUrl }] }
 *
 * GET /api/protagonists?name={主角名}
 *   功能: 获取指定主角的详细信息（包含别名）
 *   返回: { name, count, aliases: [{ name, count }], galleries: [...] }
 *
 * @date 2026-07-11
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProtagonistService } from '@/lib/protagonist/protagonist-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// GET /api/protagonists — 获取主角列表或详情
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');

    const service = getProtagonistService();

    if (name) {
      // 获取指定主角的详细信息
      const stats = await service.getProtagonistStats(name);

      if (!stats) {
        return NextResponse.json(
          { error: '未找到该主角的图库' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        data: stats,
      });
    } else {
      // 获取所有主角列表
      const protagonists = await service.getAllProtagonists();

      return NextResponse.json({
        success: true,
        data: {
          total: protagonists.length,
          protagonists,
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '获取主角信息失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
