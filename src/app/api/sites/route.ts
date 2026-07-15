import { NextResponse } from 'next/server';
import { getSiteRegistry } from '@/lib/sites';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const registry = getSiteRegistry();
    const sites = registry.getSiteInfos();
    return NextResponse.json(sites);
  } catch {
    return NextResponse.json({ error: 'Failed to get sites' }, { status: 500 });
  }
}
