import { NextResponse } from 'next/server';
import { workerManager } from '@/lib/core/infra/worker-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const stats = workerManager.getStats();
    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get worker status';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
