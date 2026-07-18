import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search/search-engine';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();
    const { titles, siteId } = body;

    if (!titles || typeof titles !== 'string' || titles.trim().length === 0) {
      return NextResponse.json({ error: t('api.search.missingVideoTitle') }, { status: 400 });
    }

    const engine = getSearchEngine();
    const job = await engine.batchSearch(titles, siteId);

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start batch search';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const engine = getSearchEngine();
    const jobs = engine.getAllBatchJobs();
    return NextResponse.json(jobs);
  } catch {
    return NextResponse.json({ error: 'Failed to get batch search jobs' }, { status: 500 });
  }
}
