import { NextResponse } from 'next/server';
import { getSniffer } from '@/lib/sites/sniffer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    const sniffer = getSniffer();
    await sniffer.stop();

    return NextResponse.json({ message: 'Sniffer stopped' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop sniffer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}