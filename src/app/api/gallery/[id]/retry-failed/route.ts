import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getGalleryDownloader } from '@/lib/downloader/gallery';
import { getGalleryProvider, scrapeGalleryAsync } from '@/lib/downloader/gallery-handler';
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

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: { images: true, videos: true },
    });

    if (!gallery) {
      return NextResponse.json({ error: t('api.gallery.notFound') }, { status: 404 });
    }

    const hasNoImagesOrVideos = gallery.images.length === 0 && gallery.videos.length === 0;

    if (hasNoImagesOrVideos) {
      const provider = getGalleryProvider(gallery.sourceUrl);
      if (!provider) {
        return NextResponse.json(
          { error: t('api.gallery.noProviderMatch') },
          { status: 400 }
        );
      }

      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'scrape_pending', errorMsg: '', imageCount: 0, videoCount: 0 },
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

      return NextResponse.json({
        message: t('api.gallery.rescrapeStarted'),
        galleryId,
        reason: t('api.gallery.rescrapeReason'),
      });
    }

    taskQueueManager.acquireSlot('gallery', galleryId).then(async (acquired) => {
      if (!acquired) {
        console.log(logT('log.galleryHandler.cancelledInQueue', { id: galleryId }));
        return;
      }

      const downloader = getGalleryDownloader();
      downloader
        .retryFailedImages(galleryId)
        .then(() => {
        })
        .catch((err) => {
          console.error(`[Gallery] 图库 #${galleryId} 重试失败:`, err);
          eventBus.emit('gallery:downloadFailed', { galleryId, error: err.message });
        });
    });

      return NextResponse.json({
        message: t('api.gallery.retryFailedStarted'),
        galleryId,
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry failed';
    const status =
      message.includes('正在下载') || message.includes('正在被其他') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
