import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';
import { workerManager } from '@/lib/core/infra/worker-manager';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const stats = taskQueueManager.getStats();
    return NextResponse.json({
      maxConcurrentTasks: stats.maxConcurrentTasks,
      maxConcurrentSniffTasks: stats.maxConcurrentSniffTasks,
      maxScrapingTasks: stats.maxScrapingTasks,
      tsSegmentConcurrent: stats.tsSegmentConcurrent,
      galleryImageConcurrent: stats.galleryImageConcurrent,
      stats: {
        runningNormal: stats.runningNormal,
        runningSniff: stats.runningSniff,
        runningScraping: stats.runningScraping,
        queueLength: stats.queueLength,
        queueItems: stats.queueItems,
      },
    });
  } catch {
    return NextResponse.json({ error: t('api.common.internalError') }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();
    const { maxConcurrentTasks, maxConcurrentSniffTasks, maxScrapingTasks, tsSegmentConcurrent, galleryImageConcurrent } = body;

    if (maxConcurrentTasks !== undefined) {
      const v = Number(maxConcurrentTasks);
      if (isNaN(v) || v < 1 || v > 50) {
        return NextResponse.json(
          { error: t('api.validation.maxConcurrentTasks') },
          { status: 400 },
        );
      }
    }

    if (maxConcurrentSniffTasks !== undefined) {
      const v = Number(maxConcurrentSniffTasks);
      if (isNaN(v) || v < 1 || v > 10) {
        return NextResponse.json(
          { error: t('api.validation.maxSniffConcurrent') },
          { status: 400 },
        );
      }
    }

    if (maxScrapingTasks !== undefined) {
      const v = Number(maxScrapingTasks);
      if (isNaN(v) || v < 1 || v > 50) {
        return NextResponse.json(
          { error: t('api.validation.maxScrapingSlots') },
          { status: 400 },
        );
      }
    }

    if (tsSegmentConcurrent !== undefined) {
      const v = Number(tsSegmentConcurrent);
      if (isNaN(v) || v < 1 || v > 200) {
        return NextResponse.json(
          { error: t('api.validation.tsSegmentConcurrent') },
          { status: 400 },
        );
      }
    }

    if (galleryImageConcurrent !== undefined) {
      const v = Number(galleryImageConcurrent);
      if (isNaN(v) || v < 1 || v > 50) {
        return NextResponse.json(
          { error: t('api.validation.galleryImageConcurrent') },
          { status: 400 },
        );
      }
    }

    const stats = taskQueueManager.getStats();
    const newMax = maxConcurrentTasks !== undefined ? Number(maxConcurrentTasks) : stats.maxConcurrentTasks;
    const newSniffMax =
      maxConcurrentSniffTasks !== undefined
        ? Number(maxConcurrentSniffTasks)
        : stats.maxConcurrentSniffTasks;
    const newMaxScraping =
      maxScrapingTasks !== undefined
        ? Number(maxScrapingTasks)
        : stats.maxScrapingTasks;
    const newTsSegment =
      tsSegmentConcurrent !== undefined
        ? Number(tsSegmentConcurrent)
        : stats.tsSegmentConcurrent;
    const newGalleryImage =
      galleryImageConcurrent !== undefined
        ? Number(galleryImageConcurrent)
        : stats.galleryImageConcurrent;

    await taskQueueManager.updateSettings(newMax, newSniffMax, newTsSegment, newGalleryImage, newMaxScraping);

    const configUpdates: Array<{ key: string; value: string }> = [];
    if (maxConcurrentTasks !== undefined) {
      configUpdates.push({ key: 'maxConcurrentTasks', value: String(newMax) });
    }
    if (maxConcurrentSniffTasks !== undefined) {
      configUpdates.push({ key: 'maxConcurrentSniffTasks', value: String(newSniffMax) });
    }
    if (maxScrapingTasks !== undefined) {
      configUpdates.push({ key: 'maxScrapingTasks', value: String(newMaxScraping) });
    }
    if (tsSegmentConcurrent !== undefined) {
      configUpdates.push({ key: 'tsSegmentConcurrent', value: String(newTsSegment) });
    }
    if (galleryImageConcurrent !== undefined) {
      configUpdates.push({ key: 'galleryImageConcurrent', value: String(newGalleryImage) });
    }

    for (const { key, value } of configUpdates) {
      workerManager.send({ type: 'config:update', payload: { key, value } });
    }

    const updated = taskQueueManager.getStats();
    return NextResponse.json({
      success: true,
      maxConcurrentTasks: updated.maxConcurrentTasks,
      maxConcurrentSniffTasks: updated.maxConcurrentSniffTasks,
      maxScrapingTasks: updated.maxScrapingTasks,
      tsSegmentConcurrent: updated.tsSegmentConcurrent,
      galleryImageConcurrent: updated.galleryImageConcurrent,
      stats: {
        runningNormal: updated.runningNormal,
        runningSniff: updated.runningSniff,
        runningScraping: updated.runningScraping,
        queueLength: updated.queueLength,
        queueItems: updated.queueItems,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update task settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
