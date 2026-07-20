import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getOuoOrchestrator } from '@/lib/core/orchestrator/ouo-orchestrator';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/ouo — State + history

export async function GET(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  const status = orchestrator.getStatus();
  const history = orchestrator.getHistory(20);

  return NextResponse.json({ status, history });
}

// POST /api/ouo — cancel / pause / resume / queue

export async function POST(request: NextRequest): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const body = await request.json().catch(() => ({}));
    const { action, ...rest } = body;
    const orchestrator = getOuoOrchestrator();

    switch (action) {
      case 'cancel': {
        const { galleryId } = rest;
        if (!galleryId) {
          return NextResponse.json(
            { error: t('api.ouo.missingGalleryId') },
            { status: 400 },
          );
        }
        const cancelled = orchestrator.cancel(galleryId);
        return NextResponse.json({ cancelled });
      }

      case 'pause': {
        orchestrator.pause();
        return NextResponse.json({ paused: true });
      }

      case 'resume': {
        if (!orchestrator.getStatus().running) {
          orchestrator.start();
        } else {
          orchestrator.resume();
        }
        return NextResponse.json({ resumed: true });
      }

      case 'queue': {
        if (Array.isArray(rest.tasks)) {
          const count = orchestrator.enqueueBatch(rest.tasks);
          return NextResponse.json({ queued: count });
        }

        const { galleryId: gid, ouoUrl, manualUrl, maxRetries } = rest;
        if (!gid || !ouoUrl) {
          return NextResponse.json(
            { error: t('api.ouo.missingParams') },
            { status: 400 },
          );
        }

        const position = orchestrator.enqueueOuo(gid, ouoUrl, manualUrl, maxRetries);
        return NextResponse.json({ queued: 1, queuePosition: position });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OUO action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


export async function DELETE(): Promise<NextResponse> {
  const orchestrator = getOuoOrchestrator();
  const cleared = orchestrator.clearQueue();
  return NextResponse.json({ cleared });
}