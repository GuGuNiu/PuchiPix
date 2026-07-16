import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { mapTask } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/event-bus';
import { allocateSeq } from '@/lib/core/seq-allocator';
import { cleanUrl, normalizeUrl } from '@/lib/utils/url-normalizer';
import { checkVideoTaskDuplicate, checkGalleryDuplicate } from '@/lib/utils/task-dedup';
import { getGalleryProvider, scrapeGalleryAsync } from '@/lib/tasks/gallery-handler';
import type { DownloadTask } from '@/types';
import { mapGalleryToTask, mapSniffToTask } from './task-mappers';
import { scrapeVideoAsync, scrapeListingAndEnqueue } from './scrape-helpers';

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
    const body = await request.json();
    const { url: rawUrl } = body;

    if (!rawUrl) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const url = cleanUrl(rawUrl);
    const normalizedUrl = normalizeUrl(url);

    // 图库站点检测
    const galleryProvider = getGalleryProvider(url);
    if (galleryProvider) {
      // 列表页检测
      if (galleryProvider.isListingPage?.(url)) {
        const sniffSeq = await allocateSeq();
        const sniffTask = await prisma.sniffTask.create({
          data: {
            url,
            siteId: galleryProvider.id,
            status: 'pending',
            seq: sniffSeq,
          },
        });

        scrapeListingAndEnqueue(sniffTask.id, url, galleryProvider).catch((err) => {
          console.error(`[Tasks] 嗅探任务 #${sniffTask.id} 异常:`, err);
        });

        return NextResponse.json({
          type: 'sniff',
          sniffId: sniffTask.id,
          seq: sniffTask.seq,
          url,
        }, { status: 201 });
      }

      // 去重检查
      const dedupResult = await checkGalleryDuplicate(url);
      if (dedupResult.duplicate) {
        return NextResponse.json({
          type: 'gallery',
          galleryId: dedupResult.recordId,
          duplicate: true,
          matchType: dedupResult.matchType,
          existingUrl: dedupResult.existingUrl,
          existingStatus: dedupResult.status,
          existingTitle: dedupResult.title,
          message: dedupResult.message,
        }, { status: 409 });
      }

      const seq = await allocateSeq();
      const gallery = await prisma.gallery.upsert({
        where: { sourceUrl: normalizedUrl },
        create: {
          sourceUrl: normalizedUrl,
          siteId: galleryProvider.id,
          status: 'scraping',
          seq,
        },
        update: {
          status: 'scraping',
        },
      });

      eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

      scrapeGalleryAsync(gallery.id, url, galleryProvider).catch((err) => {
        console.error(`[Tasks] 图库 #${gallery.id} 异步爬取异常:`, err);
      });

      return NextResponse.json({
        type: 'gallery',
        galleryId: gallery.id,
        seq: gallery.seq,
      }, { status: 201 });
    }

    // 视频任务
    const videoDedup = await checkVideoTaskDuplicate(url);
    if (videoDedup.duplicate) {
      return NextResponse.json({
        type: 'video',
        taskId: videoDedup.recordId,
        duplicate: true,
        matchType: videoDedup.matchType,
        existingUrl: videoDedup.existingUrl,
        existingStatus: videoDedup.status,
        message: videoDedup.message,
      }, { status: 409 });
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
        videoInfo: {
          create: {
            title: '',
            sourceUrl: normalizedUrl,
          },
        },
      },
      include: { videoInfo: true },
    });

    eventBus.emit('task:created', {
      taskId: task.id,
      title: '',
      source: 'manual',
    });

    scrapeVideoAsync(task.id, url).catch((err) => {
      console.error(`[Tasks] 视频 #${task.id} 异步爬取异常:`, err);
    });

    return NextResponse.json(mapTask(task), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
