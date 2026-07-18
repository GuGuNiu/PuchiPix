import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import { safeDeleteDir, safeDeleteFile, summarizeDeleteResults } from '@/lib/utils/safe-delete';
import type { GalleryData } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 将 Prisma Gallery 对象映射为 API 响应格式（含关联数据） */
function mapGalleryWithRelations(g: {
  id: number;
  seq?: string | null;
  sourceUrl: string;
  siteId: string;
  scrapedDomain: string;
  title: string;
  protagonist: string;
  description: string;
  category: string;
  tags: string;
  coverUrl: string;
  coverLocalPath: string;
  gameCharacters: string | null;
  publishTime: string | null;
  imageCount: number;
  videoCount: number;
  pageCount: number;
  status: string;
  downloadMethod: string;
  expectedImageCount: number;
  expectedVideoCount: number;
  contentVerified: boolean;
  savePath: string;
  totalSize: bigint;
  downloadedSize: bigint;
  createdAt: Date;
  updatedAt: Date;
  images: {
    id: number;
    galleryId: number;
    url: string;
    localPath: string;
    fileName: string;
    pageIndex: number;
    orderIndex: number;
    status: string;
  }[];
  videos: {
    id: number;
    galleryId: number;
    url: string;
    localPath: string;
    fileName: string;
    status: string;
  }[];
  downloadInfo?: {
    id: number;
    galleryId: number;
    title: string;
    fileCount: number;
    fileSizeText: string;
    imageDimensions: string;
    password: string;
    downloadUrl: string;
    downloadSource: string;
    ouoUrl: string;
    resolvedDirectUrl: string;
    provider: string;
    requiresLogin: boolean;
    requiresEmail: boolean;
    status: string;
    localPath: string;
    extractedPath: string;
    actualSize: bigint;
    zipFileName: string;
    parallelism: number;
    avgSpeed: number;
    verifiedCount: number;
    countMatched: boolean;
  } | null;
}): GalleryData {
  let tags: string[] = [];
  try {
    tags = g.tags ? JSON.parse(g.tags) as string[] : [];
  } catch {
    tags = [];
  }

  let gameCharacters: string[] = [];
  try {
    gameCharacters = g.gameCharacters ? JSON.parse(g.gameCharacters) as string[] : [];
  } catch {
    gameCharacters = [];
  }

  return {
    ID: g.id,
    Seq: g.seq ?? undefined,
    SourceURL: g.sourceUrl,
    SiteID: g.siteId,
    ScrapedDomain: g.scrapedDomain || '',
    Title: g.description || g.title,
    Protagonist: g.protagonist,
    Description: g.description,
    Category: g.category,
    Tags: tags,
    CoverURL: g.coverUrl,
    CoverLocalPath: g.coverLocalPath || '',
    PublishTime: g.publishTime || undefined,
    ImageCount: g.imageCount,
    VideoCount: g.videoCount,
    PageCount: g.pageCount,
    Status: g.status,
    DownloadMethod: g.downloadMethod || 'pending',
    ExpectedImageCount: g.expectedImageCount || 0,
    ExpectedVideoCount: g.expectedVideoCount || 0,
    ContentVerified: g.contentVerified || false,
    SavePath: g.savePath,
    TotalSize: Number(g.totalSize || BigInt(0)),
    DownloadedSize: Number(g.downloadedSize || BigInt(0)),
    CreatedAt: g.createdAt.toISOString(),
    UpdatedAt: g.updatedAt.toISOString(),
    Images: g.images.map((img) => ({
      ID: img.id,
      GalleryID: img.galleryId,
      URL: img.url,
      LocalPath: img.localPath,
      FileName: img.fileName,
      PageIndex: img.pageIndex,
      OrderIndex: img.orderIndex,
      Status: img.status,
    })),
    Videos: g.videos.map((vid) => ({
      ID: vid.id,
      GalleryID: vid.galleryId,
      URL: vid.url,
      LocalPath: vid.localPath,
      FileName: vid.fileName,
      Status: vid.status,
    })),
    DownloadInfo: g.downloadInfo ? {
      ID: g.downloadInfo.id,
      GalleryID: g.downloadInfo.galleryId,
      Title: g.downloadInfo.title,
      FileCount: g.downloadInfo.fileCount,
      FileSizeText: g.downloadInfo.fileSizeText,
      ImageDimensions: g.downloadInfo.imageDimensions,
      Password: g.downloadInfo.password,
      DownloadURL: g.downloadInfo.downloadUrl,
      DownloadSource: g.downloadInfo.downloadSource || 'unknown',
      OuoURL: g.downloadInfo.ouoUrl || '',
      ResolvedDirectURL: g.downloadInfo.resolvedDirectUrl || '',
      Provider: g.downloadInfo.provider,
      RequiresLogin: g.downloadInfo.requiresLogin,
      RequiresEmail: g.downloadInfo.requiresEmail,
      Status: g.downloadInfo.status,
      LocalPath: g.downloadInfo.localPath,
      ExtractedPath: g.downloadInfo.extractedPath,
      ActualSize: Number(g.downloadInfo.actualSize || BigInt(0)),
      ZipFileName: g.downloadInfo.zipFileName || '',
      Parallelism: g.downloadInfo.parallelism || 0,
      AvgSpeed: g.downloadInfo.avgSpeed || 0,
      VerifiedCount: g.downloadInfo.verifiedCount || 0,
      CountMatched: g.downloadInfo.countMatched || false,
    } : undefined,
    GameCharacters: gameCharacters,
  };
}

/** GET /api/gallery/[id] — 获取图库详情 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: {
        images: { orderBy: { orderIndex: 'asc' } },
        videos: { orderBy: { id: 'asc' } },
        downloadInfo: true,
      },
    });

    if (!gallery) {
      return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
    }

    return NextResponse.json({ data: mapGalleryWithRelations(gallery) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch gallery';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/gallery/[id] — 更新图库（重新解析主角名等）
 *
 * 支持的 action：
 * - reparseProtagonist: 使用智能解析系统重新提取主角名
 *
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'reparseProtagonist': {
        const gallery = await prisma.gallery.findUnique({
          where: { id: galleryId },
          select: { title: true, tags: true },
        });

        if (!gallery) {
          return NextResponse.json({ error: 'Gallery not found' }, { status: 404 });
        }

        // 解析标签
        let tags: string[] = [];
        try {
          tags = JSON.parse(gallery.tags) as string[];
        } catch {
          tags = [];
        }

        // 使用智能解析系统重新提取主角名
        const { getProtagonistService } = await import('@/lib/protagonist/protagonist-service');
        const service = getProtagonistService();
        const newProtagonist = await service.extractFromTitleSmart(gallery.title, tags);

        // 自动学习
        if (newProtagonist) {
          service.learnPerson(newProtagonist).catch(() => {});
        }

        await prisma.gallery.update({
          where: { id: galleryId },
          data: { protagonist: newProtagonist },
        });

        return NextResponse.json({
          data: {
            galleryId,
            oldProtagonist: (await prisma.gallery.findUnique({
              where: { id: galleryId },
              select: { protagonist: true },
            }))?.protagonist || '',
            newProtagonist,
          },
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update gallery';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/gallery/[id] — 删除图库
 *
 * 全链路删除：取消下载后读取图库信息，删除本地文件和数据库记录，最后通知前端。
 *
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const galleryId = parseInt(id);

  if (isNaN(galleryId)) {
    return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
  }

try {
taskQueueManager.cancelAcquire('gallery', galleryId);
// 取消排队中的识别槽位请求
taskQueueManager.cancelScrapingAcquire('gallery', galleryId);

// 取消正在进行的下载
    try {
      const { getGalleryDownloader } = await import('@/lib/downloader/gallery');
      getGalleryDownloader().cancelDownload(galleryId);
    } catch {
    }

    // 释放已持有的识别槽位和普通槽位（如果任务处于 scraping/downloading 阶段）
    taskQueueManager.releaseScrapingSlot('gallery', galleryId);
    taskQueueManager.releaseSlot('gallery', galleryId);

    // 读取图库信息，用于后续本地文件清理
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: {
        downloadInfo: true,
      },
    });

    if (!gallery) {
      // 图库不存在，视为已删除
      eventBus.emit('gallery:deleted', { galleryId });
      return NextResponse.json({ success: true });
    }

    // 删除本地文件，带重试
    const galleryRoot = process.env.GALLERY_PATH || './data/galleries';
    const zipRoot = process.env.GALLERY_ZIP_PATH || './data/gallery_zips';
    const resolvedGalleryRoot = path.resolve(galleryRoot);
    const resolvedZipRoot = path.resolve(zipRoot);

    const deleteResults = [];

    // 删除图库爬取文件夹
    if (gallery.savePath) {
      const savePathResolved = path.resolve(gallery.savePath);
      // 安全检查：确保路径在 galleries 目录下，防止误删
      if (savePathResolved.startsWith(resolvedGalleryRoot) || savePathResolved.startsWith(resolvedZipRoot)) {
        deleteResults.push(await safeDeleteDir(savePathResolved));
      } else {
        // 如果不在预期目录下，也尝试删除（可能是自定义路径）
        deleteResults.push(await safeDeleteDir(savePathResolved));
      }
    }

    // 删除 ZIP 下载文件和解压目录
    if (gallery.downloadInfo) {
      // ZIP 文件
      if (gallery.downloadInfo.localPath) {
        const zipPath = path.resolve(gallery.downloadInfo.localPath);
        // 安全检查：确保路径在预期目录下
        if (zipPath.startsWith(resolvedZipRoot) || zipPath.startsWith(resolvedGalleryRoot)) {
          deleteResults.push(await safeDeleteFile(zipPath));
        } else {
          deleteResults.push(await safeDeleteFile(zipPath));
        }
      }

      // 解压目录
      if (gallery.downloadInfo.extractedPath) {
        const extractPath = path.resolve(gallery.downloadInfo.extractedPath);
        deleteResults.push(await safeDeleteDir(extractPath));
      }
    }

    const tempZipDir = path.join(resolvedZipRoot, `gallery_${galleryId}`);
    deleteResults.push(await safeDeleteDir(tempZipDir));

    console.log(`[GalleryDelete] 图库 #${galleryId}: ${summarizeDeleteResults(deleteResults)}`);

    await prisma.$transaction(async (tx) => {
      await tx.gallery.delete({
        where: { id: galleryId },
      });
    });

    eventBus.emit('gallery:deleted', { galleryId });

    console.log(`[GalleryDelete] 图库 #${galleryId} 删除完成`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete gallery';
    console.error(`[GalleryDelete] 图库 #${galleryId} 删除失败:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
