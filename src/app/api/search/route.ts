import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';


export async function GET(): Promise<NextResponse> {
  try {
    const engine = getSearchEngine();
    return NextResponse.json({
      jobs: engine.getAllJobs(),
      batchJobs: engine.getAllBatchJobs(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to get search jobs' }, { status: 500 });
  }
}

// POST /api/search — search / batch / scrape

export async function POST(request: NextRequest): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();
    const { action, ...rest } = body;
    const engine = getSearchEngine();

    switch (action) {
      case 'search':
      default: {
        const { keywords, siteId } = rest;
        if (!keywords || typeof keywords !== 'string' || keywords.trim().length === 0) {
          return NextResponse.json({ error: t('api.search.missingKeyword') }, { status: 400 });
        }
        const job = await engine.search(keywords, siteId);
        return NextResponse.json(job, { status: 201 });
      }

      case 'batch': {
        const { titles, siteId } = rest;
        if (!titles || typeof titles !== 'string' || titles.trim().length === 0) {
          return NextResponse.json({ error: t('api.search.missingVideoTitle') }, { status: 400 });
        }
        const job = await engine.batchSearch(titles, siteId);
        return NextResponse.json(job, { status: 201 });
      }

      case 'scrape': {
        const { jobId, pageUrl, all } = rest;
        if (!jobId || typeof jobId !== 'string') {
          return NextResponse.json({ error: t('api.search.missingJobId') }, { status: 400 });
        }

        if (all === true) {
          engine.scrapeAll(jobId).catch((err) => {
            console.error(`[ScrapeAll] Batch scrape failed: ${err.message}`);
          });
          return NextResponse.json({ message: t('api.search.batchScrapeStarted'), jobId });
        }

        if (!pageUrl || typeof pageUrl !== 'string') {
          return NextResponse.json({ error: t('api.search.missingPageUrl') }, { status: 400 });
        }

        const updatedItem = await engine.scrapeVideo(jobId, pageUrl);

        if (!updatedItem) {
          return NextResponse.json({ error: t('api.search.videoNotFound') }, { status: 404 });
        }

        return NextResponse.json(updatedItem);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start search';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}