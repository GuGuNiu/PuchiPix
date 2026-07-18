import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getScraper } from '@/lib/sites/scraper';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const scraper = getScraper();
    const result = await scraper.scrape(url);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scrape failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}