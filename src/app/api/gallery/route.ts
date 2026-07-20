import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getGalleryProvider, createGalleryRecord } from '@/lib/downloader/gallery-handler';
import { cleanUrl } from '@/lib/utils/url-normalizer';
import { rateLimiter } from '@/lib/core/infra/rate-limiter';
import { workerManager } from '@/lib/core/infra/worker-manager';
import { t, setLocaleFromHeaders } from '@/lib/i18n/server';
import type { GalleryData } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type GalleryWithRelations = {
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
  images?: {
    id: number;
    galleryId: number;
    url: string;
    localPath: string;
    fileName: string;
    pageIndex: number;
    orderIndex: number;
    status: string;
  }[];
  videos?: {
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
};

function mapGallery(g: GalleryWithRelations): GalleryData {
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
    Images: g.images?.map((img) => ({
      ID: img.id,
      GalleryID: img.galleryId,
      URL: img.url,
      LocalPath: img.localPath,
      FileName: img.fileName,
      PageIndex: img.pageIndex,
      OrderIndex: img.orderIndex,
      Status: img.status,
    })),
    Videos: g.videos?.map((vid) => ({
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

interface BatchResult {
  url: string;
  status: 'completed' | 'not_found' | 'failed' | 'skipped';
  galleryId?: number;
  title?: string;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  setLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();

    const { urls, url: rawUrl } = body;
    if (urls && Array.isArray(urls) && urls.length > 0) {
      const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
      if (!rateLimiter.checkLimit(`batch:${ip}`, 60_000, 3)) {
        return NextResponse.json({ error: t('api.gallery.tooManyRequests') }, { status: 429 });
      }

      const results: BatchResult[] = [];

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i].trim();
        if (!url) {
          results.push({ url, status: 'failed', error: t('api.gallery.batchEmptyUrl') });
          continue;
        }

        const provider = getGalleryProvider(url);
        if (!provider) {
          results.push({ url, status: 'failed', error: t('api.gallery.noProvider') });
          continue;
        }

        try {
          const result = await createGalleryRecord(url, provider);
          if (result.duplicate) {
            results.push({ url, status: 'skipped', galleryId: result.galleryId, title: result.existingTitle });
          } else {
            workerManager.send({
              type: 'task:create',
              payload: { taskType: 'gallery', galleryId: result.galleryId, url },
            });
            results.push({ url, status: 'completed', galleryId: result.galleryId });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          results.push({ url, status: 'failed', error: errMsg });
        }

        if (i < urls.length - 1) {
          const delay = 3000 + Math.floor(Math.random() * 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const summary = {
        total: results.length,
        completed: results.filter((r) => r.status === 'completed').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        not_found: results.filter((r) => r.status === 'not_found').length,
        failed: results.filter((r) => r.status === 'failed').length,
      };

      return NextResponse.json({ results, summary });
    }

    if (!rawUrl) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const url = cleanUrl(rawUrl);
    const provider = getGalleryProvider(url);

    if (!provider) {
      return NextResponse.json({ error: t('api.gallery.noProvider') }, { status: 400 });
    }

    const result = await createGalleryRecord(url, provider);
    if (result.duplicate) {
      return NextResponse.json({
        duplicate: true,
        matchType: result.matchType,
        galleryId: result.galleryId,
        existingUrl: result.existingUrl,
        existingStatus: result.existingStatus,
        existingTitle: result.existingTitle,
        message: result.message,
      }, { status: 409 });
    }

    workerManager.send({
      type: 'task:create',
      payload: { taskType: 'gallery', galleryId: result.galleryId, url },
    });

    return NextResponse.json({
      message: t('api.gallery.scrapeStarted'),
      data: { ID: result.galleryId, SourceURL: url, Status: 'pending' },
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gallery scrape failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const protagonist = searchParams.get('protagonist') || '';
    const status = searchParams.get('status') || '';
    const withCount = searchParams.get('withCount') === 'true';

    const where: {
      protagonist?: { contains: string };
      status?: string;
    } = {};

    if (protagonist) {
      where.protagonist = { contains: protagonist };
    }
    if (status) {
      where.status = status;
    }

    const galleries = await prisma.gallery.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { downloadInfo: true },
    });

    const total = withCount ? await prisma.gallery.count({ where }) : undefined;

    return NextResponse.json({
      data: galleries.map((g: typeof galleries[number]) => mapGallery(g as GalleryWithRelations)),
      total,
      page,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch galleries';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
