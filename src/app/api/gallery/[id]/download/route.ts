import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getGalleryDownloader } from '@/lib/downloader/gallery';
import { eventBus } from '@/lib/core/infra/event-bus';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import { t, logT, setLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const concurrency = body.concurrency || taskQueueManager.getDownloadConcurrency().galleryImageConcurrent;

    taskQueueManager.acquireSlot('gallery', galleryId).then(async (acquired) => {
      if (!acquired) {
        console.log(logT('log.galleryHandler.cancelledInQueue', { id: galleryId }));
        return;
      }

      const gallery = await prisma.gallery.findUnique({
        where: { id: galleryId },
        include: { images: true, videos: true },
      });
      if (!gallery || gallery.status === 'completed' || gallery.status === 'not_found') {
        taskQueueManager.releaseSlot('gallery', galleryId);
        return;
      }

      if (gallery.status === 'scraping') {
        taskQueueManager.releaseSlot('gallery', galleryId);
        eventBus.emit('gallery:downloadFailed', {
          galleryId,
          error: t('api.gallery.identifying'),
        });
        return;
      }

      // download_pending 状态：识别完成，等待下载槽位
      if (gallery.status === 'download_pending') {
        // 更新状态为 downloading，然后继续下载
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { status: 'downloading' },
        });
        eventBus.emit('gallery:downloadStarted', { galleryId, total: gallery.images.length + gallery.videos.length });
        const downloader = getGalleryDownloader();
        downloader
          .downloadGallery(galleryId, concurrency)
          .then(() => {
          })
          .catch((err) => {
            console.error(logT('log.galleryHandler.asyncScrapeError', { id: galleryId }), err);
            eventBus.emit('gallery:downloadFailed', { galleryId, error: err.message });
          });
        return;
      }

      const hasNoImagesOrVideos = gallery.images.length === 0 && gallery.videos.length === 0;
      // scrape_pending 状态：等待识别槽位，或 pending 且无数据 → 触发重新爬取
      if (gallery.status === 'scrape_pending' || (gallery.status === 'pending' && hasNoImagesOrVideos)) {
        taskQueueManager.releaseSlot('gallery', galleryId);

        const { getGalleryProvider, scrapeGalleryAsync } = await import('@/lib/tasks/gallery-handler');
        const provider = getGalleryProvider(gallery.sourceUrl);
        if (!provider) {
          eventBus.emit('gallery:downloadFailed', {
            galleryId,
            error: t('api.gallery.noProviderForRescrape'),
          });
          return;
        }

        // 重置状态并触发重新爬取
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { status: 'pending', errorMsg: '', imageCount: 0, videoCount: 0 },
        });

        eventBus.emit('gallery:scrapeStarted', { galleryId, url: gallery.sourceUrl });

        scrapeGalleryAsync(galleryId, gallery.sourceUrl, provider).catch((err) => {
          console.error(logT('log.galleryHandler.asyncScrapeError', { id: galleryId }), err);
          eventBus.emit('gallery:scrapeFailed', {
            galleryId,
            url: gallery.sourceUrl,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        return;
      }

      const downloader = getGalleryDownloader();
      downloader
        .downloadGallery(galleryId, concurrency)
        .then(() => {
        })
        .catch((err) => {
          console.error(logT('log.galleryHandler.asyncScrapeError', { id: galleryId }), err);
          eventBus.emit('gallery:downloadFailed', { galleryId, error: err.message });
        });
    });

    return NextResponse.json({
      message: t('api.gallery.downloadStarted'),
      galleryId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gallery download failed';
    const status =
      message.includes('正在下载') || message.includes('正在被其他') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
