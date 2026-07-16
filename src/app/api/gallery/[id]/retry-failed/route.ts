import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getGalleryDownloader } from '@/lib/downloader/gallery-downloader';
import { getGalleryProvider, scrapeGalleryAsync } from '@/lib/tasks/gallery-handler';
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

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: { images: true, videos: true },
    });

    if (!gallery) {
      return NextResponse.json({ error: t('api.gallery.notFound') }, { status: 404 });
    }

    const hasNoImagesOrVideos = gallery.images.length === 0 && gallery.videos.length === 0;

    if (hasNoImagesOrVideos) {
      // 爬取阶段失败：重新触发爬取流程
      const provider = getGalleryProvider(gallery.sourceUrl);
      if (!provider) {
        return NextResponse.json(
          { error: t('api.gallery.noProviderMatch') },
          { status: 400 }
        );
      }

      // 重置Gallery状态为pending，准备重新爬取
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'pending', errorMsg: '', imageCount: 0, videoCount: 0 },
      });

      // 立即通知前端状态已变更（scraping），避免用户感觉点击无反应
      eventBus.emit('gallery:scrapeStarted', { galleryId, url: gallery.sourceUrl });

      // 异步触发重新爬取
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

    // 有图片/视频记录：使用断点续传重试下载失败的文件
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
