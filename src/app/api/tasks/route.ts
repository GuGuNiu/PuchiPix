import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { mapTask } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/infra/event-bus';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { cleanUrl, normalizeUrl } from '@/lib/utils/url-normalizer';
import { checkVideoTaskDuplicate } from '@/lib/utils/task-dedup';
import { getGalleryProvider, createGalleryRecord } from '@/lib/downloader/gallery-handler';
import { rateLimiter } from '@/lib/core/infra/rate-limiter';
import { workerManager } from '@/lib/core/infra/worker-manager';
import type { DownloadTask } from '@/types';
import { mapGalleryToTask, mapSniffToTask } from './task-mappers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where = status ? { status } : {};

    const [tasks, galleries, sniffTasks] = await Promise.all([
      prisma.downloadTask.findMany({
        where,
        include: { videoInfo: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.gallery.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          downloadInfo: true,
          _count: {
            select: {
              images: { where: { status: 'downloaded' } },
              videos: { where: { status: 'completed' } },
            },
          },
        },
      }),
      prisma.sniffTask.findMany({
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const videoTasks = tasks.map(mapTask);
    const galleryTasks = galleries
      .map(mapGalleryToTask)
      .filter((t: DownloadTask) => !status || t.Status === status);
    const sniffTaskList = sniffTasks
      .map(mapSniffToTask)
      .filter((t: DownloadTask) => !status || t.Status === status);

    const all = [...videoTasks, ...galleryTasks, ...sniffTaskList].sort(
      (a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime(),
    );

    return NextResponse.json(all);
  } catch {
    return NextResponse.json({ error: 'Failed to list tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    if (!rateLimiter.checkLimit(`tasks:${ip}`, 60_000, 10)) {
      return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
    }

    const body = await request.json();
    const { url: rawUrl } = body;
    if (!rawUrl) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const url = cleanUrl(rawUrl);
    const normalizedUrl = normalizeUrl(url);

    const galleryProvider = getGalleryProvider(url);

    if (galleryProvider?.isListingPage?.(url)) {
      const sniffSeq = await allocateSeq();
      const sniffTask = await prisma.sniffTask.create({
        data: { url, siteId: galleryProvider.id, status: 'pending', seq: sniffSeq },
      });
      workerManager.send({
        type: 'task:create',
        payload: { taskType: 'sniff', sniffId: sniffTask.id, url, siteId: galleryProvider.id },
      });
      return NextResponse.json(
        { type: 'sniff', sniffId: sniffTask.id, seq: sniffTask.seq, url },
        { status: 201 },
      );
    }

    if (galleryProvider) {
      const result = await createGalleryRecord(url, galleryProvider);
      if (result.duplicate) {
        return NextResponse.json(
          {
            type: 'gallery',
            galleryId: result.galleryId,
            duplicate: true,
            matchType: result.matchType,
            existingUrl: result.existingUrl,
            existingStatus: result.existingStatus,
            existingTitle: result.existingTitle,
            message: result.message,
          },
          { status: 409 },
        );
      }
      workerManager.send({
        type: 'task:create',
        payload: { taskType: 'gallery', galleryId: result.galleryId, url },
      });
      return NextResponse.json(
        { type: 'gallery', galleryId: result.galleryId, seq: result.seq },
        { status: 201 },
      );
    }

    const videoDedup = await checkVideoTaskDuplicate(url);
    if (videoDedup.duplicate) {
      return NextResponse.json(
        {
          type: 'video',
          taskId: videoDedup.recordId,
          duplicate: true,
          matchType: videoDedup.matchType,
          existingUrl: videoDedup.existingUrl,
          existingStatus: videoDedup.status,
          message: videoDedup.message,
        },
        { status: 409 },
      );
    }

    const isDirectM3u8 = url.endsWith('.m3u8');
    const videoSeq = await allocateSeq();
    const task = await prisma.downloadTask.create({
      data: {
        url: normalizedUrl,
        m3u8Url: isDirectM3u8 ? url : '',
        format: 'mp4',
        status: isDirectM3u8 ? 'pending' : 'scraping',
        seq: videoSeq,
        videoInfo: { create: { title: '', sourceUrl: normalizedUrl } },
      },
      include: { videoInfo: true },
    });

    eventBus.emit('task:created', { taskId: task.id, title: '', source: 'manual' });
    workerManager.send({
      type: 'task:create',
      payload: { taskType: 'video', taskId: task.id, url },
    });

    return NextResponse.json(mapTask(task), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
