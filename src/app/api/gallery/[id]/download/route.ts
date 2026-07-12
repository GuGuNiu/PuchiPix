/**
 * 图库下载 API
 *
 * POST /api/gallery/[id]/download
 *   功能: 触发指定图库的图片和视频下载到本地
 *   请求体（可选）: { concurrency?: number }
 *   返回: { message, success, failed, skipped, savePath }
 *
 * 共享基础设施：
 * - TTL 锁：由 GalleryDownloader 内部管理防重复下载
 * - EventBus：由 GalleryDownloader 内部发布进度事件
 *
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGalleryDownloader } from '@/lib/downloader/gallery-downloader';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const concurrency = body.concurrency || 4;

    const downloader = getGalleryDownloader();
    const result = await downloader.downloadGallery(galleryId, concurrency);

    return NextResponse.json({
      message: '图库下载完成',
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gallery download failed';
    const status = message.includes('正在下载') || message.includes('正在被其他') ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
