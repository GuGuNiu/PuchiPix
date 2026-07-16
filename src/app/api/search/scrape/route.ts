import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search/search-engine';
import { t, setServerLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();
    const { jobId, pageUrl, all } = body;

    if (!jobId || typeof jobId !== 'string') {
      return NextResponse.json({ error: t('api.search.missingJobId') }, { status: 400 });
    }

    const engine = getSearchEngine();

    // 批量爬取
    if (all === true) {
      // 异步执行批量爬取，不阻塞响应
      engine.scrapeAll(jobId).catch((err) => {
        console.error(`[ScrapeAll] 批量爬取失败: ${err.message}`);
      });
      return NextResponse.json({ message: t('api.search.batchScrapeStarted'), jobId });
    }

    // 单个爬取
    if (!pageUrl || typeof pageUrl !== 'string') {
      return NextResponse.json({ error: t('api.search.missingPageUrl') }, { status: 400 });
    }

    const updatedItem = await engine.scrapeVideo(jobId, pageUrl);

    if (!updatedItem) {
      return NextResponse.json({ error: t('api.search.videoNotFound') }, { status: 404 });
    }

    return NextResponse.json(updatedItem);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to scrape video';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
