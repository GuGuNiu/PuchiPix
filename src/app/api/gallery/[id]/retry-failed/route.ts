import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getGalleryDownloader } from '@/lib/downloader/gallery-downloader';
import { eventBus } from '@/lib/core/event-bus';
import { taskQueueManager } from '@/lib/core/task-queue-manager';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 仅重试失败的图片和视频（断点续传）
 *
 * POST /api/gallery/[id]/retry-failed
 *
 * 已下载完成的文件自动跳过，仅重新下载状态为 failed 或 pending 的文件。
 * 支持网络中断后按需重试，无需重新下载整个图库。
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
    if (!gallery) {
      return NextResponse.json({ error: '图库不存在' }, { status: 404 });
    }

    taskQueueManager.acquireSlot('gallery', galleryId).then(async (acquired) => {
      if (!acquired) {
        console.log(`[Gallery] 图库 #${galleryId} 在排队等待中被取消`);
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
      message: '失败文件重试已启动',
      galleryId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry failed';
    const status =
      message.includes('正在下载') || message.includes('正在被其他') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
