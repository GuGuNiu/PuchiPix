import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { workerManager } from '@/lib/core/infra/worker-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const lines = parseInt(searchParams.get('lines') || '50', 10);
    const logs = workerManager.getRecentLogs(lines);
    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get worker logs';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
