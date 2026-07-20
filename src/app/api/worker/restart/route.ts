import { NextResponse } from 'next/server';
import { workerManager } from '@/lib/core/infra/worker-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  try {
    const result = await workerManager.restart();
    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to restart worker';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
