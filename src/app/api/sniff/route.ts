import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getSniffer } from '@/lib/sites/sniffer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/sniff — start / stop

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const { action, url } = body;

    const sniffer = getSniffer();

    switch (action) {
      case 'start': {
        if (!url) {
          return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }
        await sniffer.start(url);
        return NextResponse.json({ message: 'Sniffer started', url });
      }
      case 'stop': {
        await sniffer.stop();
        return NextResponse.json({ message: 'Sniffer stopped' });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sniff action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/sniff — status / urls / m3u8

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const sniffer = getSniffer();

    if (type === 'urls') {
      return NextResponse.json(sniffer.getCapturedURLs());
    }

    if (type === 'm3u8') {
      return NextResponse.json(sniffer.getM3U8URLs());
    }

    return NextResponse.json(sniffer.getStatus());
  } catch {
    return NextResponse.json({ error: 'Failed to get sniffer info' }, { status: 500 });
  }
}