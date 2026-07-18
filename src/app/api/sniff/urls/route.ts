import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getSniffer } from '@/lib/sites/sniffer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    const sniffer = getSniffer();
    let urls;

    if (type === 'm3u8') {
      urls = sniffer.getM3U8URLs();
    } else {
      urls = sniffer.getCapturedURLs();
    }

    return NextResponse.json(urls);
  } catch {
    return NextResponse.json({ error: 'Failed to get captured URLs' }, { status: 500 });
  }
}