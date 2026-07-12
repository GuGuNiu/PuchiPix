import { NextResponse } from 'next/server';
import { getSniffer } from '@/lib/scraper/sniffer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const sniffer = getSniffer();
    const status = sniffer.getStatus();

    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get sniffer status' }, { status: 500 });
  }
}