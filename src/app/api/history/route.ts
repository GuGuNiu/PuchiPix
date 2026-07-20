import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 *
 * ?limit=50 — LimitReturnamount（default 50，max 200）
 * ?offset=0 — paginationoffset
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');
    const status = searchParams.get('status');
    const url = searchParams.get('url');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (url) {
      const history = await prisma.downloadHistory.findFirst({
        where: { url },
        select: { id: true, status: true, imageCount: true, videoCount: true, updatedAt: true },
      });
      return NextResponse.json({ exists: !!history, history });
    }

    const where: {
      siteId?: string;
      status?: string;
    } = {};
    if (siteId) where.siteId = siteId;
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.downloadHistory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.downloadHistory.count({ where }),
    ]);

    return NextResponse.json({ items, total, limit, offset });
  } catch {
    return NextResponse.json({ error: 'Failed to query download history' }, { status: 500 });
  }
}
