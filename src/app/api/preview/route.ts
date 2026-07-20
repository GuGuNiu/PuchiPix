import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';


function extractM3U8FromHtml(html: string): string | null {
  const playerMatch = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*[;<]/);
  if (playerMatch) {
    try {
      const playerData = JSON.parse(playerMatch[1]) as { url?: string };
      if (playerData.url && typeof playerData.url === 'string') {
        const url = playerData.url.trim();
        if (url.includes('.m3u8') || url.includes('.m3u')) {
          return url;
        }
        try {
          const decoded = decodeURIComponent(url);
          if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
            return decoded;
          }
        } catch {}
        try {
          const decoded = Buffer.from(url, 'base64').toString('utf-8');
          if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
            return decoded;
          }
        } catch {}
      }
    } catch {}
  }

  const m3u8Matches = html.match(/https?:\/\/[^\s"'<>)\\]+\.m3u8[^\s"'<>)\\]*/gi);
  if (m3u8Matches && m3u8Matches.length > 0) {
    const excludePatterns = ['ad', 'stat', 'analytics', 'tracker', 'beacon'];
    const filtered = m3u8Matches.filter((url) => {
      const lower = url.toLowerCase();
      return !excludePatterns.some((p) => lower.includes(p));
    });
    if (filtered.length > 0) {
      return filtered[0];
    }
    return m3u8Matches[0];
  }

  return null;
}


async function scrapeM3U8WithPlaywright(url: string): Promise<string | null> {
  const { getScraper } = await import('@/lib/sites/scraper');
  const scraper = getScraper();
  const result = await scraper.scrape(url, 20000);
  return result.m3u8_url || null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (res.ok) {
        const html = await res.text();
        const m3u8Url = extractM3U8FromHtml(html);
        if (m3u8Url) {
          return NextResponse.json({ m3u8_url: m3u8Url });
        }
      }
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      console.log(`[Preview] Fetch failed${isAbort ? ' (timeout)' : ''}, falling back to Playwright: ${url}`);
    }

    try {
      const m3u8Url = await scrapeM3U8WithPlaywright(url);
      if (m3u8Url) {
        return NextResponse.json({ m3u8_url: m3u8Url });
      }
      return NextResponse.json(
        { error: 'No m3u8 URL found' },
        { status: 404 }
      );
    } catch (scrapeErr) {
      const message = scrapeErr instanceof Error ? scrapeErr.message : 'Scrape failed';
      console.error(`[Preview] Playwright scrape also failed: ${url} — ${message}`);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
