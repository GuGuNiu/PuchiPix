import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { taskQueueManager } from '@/lib/core/task-queue-manager';

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
    return NextResponse.json({ error: 'Failed to read task settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { maxConcurrentTasks, maxConcurrentSniffTasks, maxScrapingTasks, tsSegmentConcurrent, galleryImageConcurrent } = body;

    if (maxConcurrentTasks !== undefined) {
      const v = Number(maxConcurrentTasks);
      if (isNaN(v) || v < 1 || v > 50) {
        return NextResponse.json(
          { error: '同时运行任务数必须在 1~50 之间' },
          { status: 400 },
        );
      }
    }

    if (maxConcurrentSniffTasks !== undefined) {
      const v = Number(maxConcurrentSniffTasks);
      if (isNaN(v) || v < 1 || v > 10) {
        return NextResponse.json(
          { error: '嗅探最大并发数必须在 1~10 之间' },
          { status: 400 },
        );
      }
    }

    if (maxScrapingTasks !== undefined) {
      const v = Number(maxScrapingTasks);
      if (isNaN(v) || v < 1 || v > 50) {
        return NextResponse.json(
          { error: '识别中最大数量必须在 1~50 之间' },
          { status: 400 },
        );
      }
    }

    if (tsSegmentConcurrent !== undefined) {
      const v = Number(tsSegmentConcurrent);
      if (isNaN(v) || v < 1 || v > 200) {
        return NextResponse.json(
          { error: 'TS 分片并发数必须在 1~200 之间' },
          { status: 400 },
        );
      }
    }

    if (galleryImageConcurrent !== undefined) {
      const v = Number(galleryImageConcurrent);
      if (isNaN(v) || v < 1 || v > 50) {
        return NextResponse.json(
          { error: '图库图片并发数必须在 1~50 之间' },
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
