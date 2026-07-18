import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/orchestrator/ouo-orchestrator';
import { t, setServerLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();
    const orchestrator = getOuoOrchestrator();

    // 批量入队
    if (Array.isArray(body.tasks)) {
      const count = orchestrator.enqueueBatch(body.tasks);
      return NextResponse.json({ queued: count });
    }

    // 单个入队
    const { galleryId, ouoUrl, manualUrl, maxRetries } = body;

    if (!galleryId || !ouoUrl) {
      return NextResponse.json(
        { error: t('api.ouo.missingParams') },
        { status: 400 },
      );
    }

    const position = orchestrator.enqueueOuo(galleryId, ouoUrl, manualUrl, maxRetries);

    return NextResponse.json({ queued: 1, queuePosition: position });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enqueue task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  const cleared = orchestrator.clearQueue();
  return NextResponse.json({ cleared });
}
