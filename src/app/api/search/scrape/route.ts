import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search/search-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { jobId, pageUrl, all } = body;

    if (!jobId || typeof jobId !== 'string') {
      return NextResponse.json({ error: '请提供 jobId' }, { status: 400 });
    }

    const engine = getSearchEngine();

    // 批量爬取
    if (all === true) {
      // 异步执行批量爬取，不阻塞响应
      engine.scrapeAll(jobId).catch((err) => {
        console.error(`[ScrapeAll] 批量爬取失败: ${err.message}`);
      });
      return NextResponse.json({ message: '批量爬取已启动', jobId });
    }

    // 单个爬取
    if (!pageUrl || typeof pageUrl !== 'string') {
      return NextResponse.json({ error: '请提供 pageUrl' }, { status: 400 });
    }

    const updatedItem = await engine.scrapeVideo(jobId, pageUrl);

    if (!updatedItem) {
      return NextResponse.json({ error: '未找到对应的视频项' }, { status: 404 });
    }

    return NextResponse.json(updatedItem);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to scrape video';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
