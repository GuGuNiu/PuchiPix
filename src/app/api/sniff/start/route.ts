import { NextRequest, NextResponse } from 'next/server';
import { getSniffer } from '@/lib/scraper/sniffer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const sniffer = getSniffer();
    await sniffer.start(url);

    return NextResponse.json({ message: 'Sniffer started', url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start sniffer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}