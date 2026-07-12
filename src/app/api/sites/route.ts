/**
 * sites/route.ts — 站点列表 API
 *
 * GET /api/sites — 获取所有已注册的站点信息
 *
 * 返回示例：
 *   [
 *     { "id": "kanav", "name": "KanAV", "baseUrl": "https://kanav.ad", "enabled": true }
 *   ]
 */

import { NextResponse } from 'next/server';
import { getSiteRegistry } from '@/lib/sites';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// GET /api/sites — 获取所有站点信息
// ============================================================
export async function GET(): Promise<NextResponse> {
  try {
    const registry = getSiteRegistry();
    const sites = registry.getSiteInfos();
    return NextResponse.json(sites);
  } catch {
    return NextResponse.json({ error: 'Failed to get sites' }, { status: 500 });
  }
}
