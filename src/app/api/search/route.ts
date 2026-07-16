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
    const { keywords, siteId } = body;

    if (!keywords || typeof keywords !== 'string' || keywords.trim().length === 0) {
      return NextResponse.json({ error: t('api.search.missingKeyword') }, { status: 400 });
    }

    const engine = getSearchEngine();
    const job = await engine.search(keywords, siteId);

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to start search';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const engine = getSearchEngine();
    const jobs = engine.getAllJobs();
    return NextResponse.json(jobs);
  } catch {
    return NextResponse.json({ error: 'Failed to get search jobs' }, { status: 500 });
  }
}
