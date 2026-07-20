
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getSearchEngine } from '@/lib/search';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const engine = getSearchEngine();

    if (type === 'batch') {
      const job = engine.getBatchJob(id);
      if (!job) {
        return NextResponse.json({ error: 'Batch search job not found' }, { status: 404 });
      }
      return NextResponse.json(job);
    }

    const job = engine.getJob(id) ?? engine.getBatchJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Search job not found' }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: 'Failed to get search job' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const engine = getSearchEngine();

    if (type === 'batch') {
      if (engine.cancelBatchJob(id)) {
        return NextResponse.json({ message: 'Batch search job cancelled', id });
      }
      return NextResponse.json({ error: 'Batch search job not found' }, { status: 404 });
    }

    if (engine.cancelJob(id) || engine.cancelBatchJob(id)) {
      return NextResponse.json({ message: 'Search job cancelled', id });
    }
    return NextResponse.json({ error: 'Search job not found' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Failed to cancel search job' }, { status: 500 });
  }
}