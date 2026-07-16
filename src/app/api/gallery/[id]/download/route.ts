import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getGalleryDownloader } from '@/lib/downloader/gallery-downloader';
import { eventBus } from '@/lib/core/event-bus';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import { t, logT, setServerLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
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
          error: '图库正在识别中，请等待识别完成后再开始下载',
        });
        return;
      }

      const hasNoImagesOrVideos = gallery.images.length === 0 && gallery.videos.length === 0;
      if (gallery.status === 'pending' && hasNoImagesOrVideos) {
        taskQueueManager.releaseSlot('gallery', galleryId);

        const { getGalleryProvider, scrapeGalleryAsync } = await import('@/lib/tasks/gallery-handler');
        const provider = getGalleryProvider(gallery.sourceUrl);
        if (!provider) {
          eventBus.emit('gallery:downloadFailed', {
            galleryId,
            error: '无法匹配图库提供商，无法重新爬取',
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
