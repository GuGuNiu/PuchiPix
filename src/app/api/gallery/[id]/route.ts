/**
 * 单个图库详情 API
 *
 * GET /api/gallery/[id]
 *   功能: 获取指定图库的详细信息（含图片和视频列表）
 *   返回: GalleryData（含 Images 和 Videos）
 *
 * DELETE /api/gallery/[id]
 *   功能: 删除指定图库及其所有图片和视频记录
 *
 * @date 2026-07-11
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import type { GalleryData } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 将 Prisma Gallery 对象映射为 API 响应格式（含关联数据） */
function mapGalleryWithRelations(g: {
  id: number;
  seq?: number | null;
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
    tags = g.tags ? JSON.parse(g.tags) : [];
  } catch {
    tags = [];
  }

  let gameCharacters: string[] = [];
  try {
    gameCharacters = g.gameCharacters ? JSON.parse(g.gameCharacters) : [];
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

/** DELETE /api/gallery/[id] — 删除图库 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const galleryId = parseInt(id);

    if (isNaN(galleryId)) {
      return NextResponse.json({ error: 'Invalid gallery ID' }, { status: 400 });
    }

    await prisma.gallery.delete({
      where: { id: galleryId },
    });

    eventBus.emit('gallery:deleted', { galleryId });

    return NextResponse.json({ message: 'Gallery deleted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete gallery';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
