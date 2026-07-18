import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getSiteRegistry, extractDomainFromUrl } from '@/lib/sites';
import { getGalleryDownloader } from '@/lib/downloader/gallery';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { ttlLock } from '@/lib/core/infra/ttl-lock';
import { eventBus } from '@/lib/core/infra/event-bus';
import { createStealthPage } from '@/lib/core/stealth/anti-crawler';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { parseTitleCount, detectDownloadSource } from '@/lib/downloader/gallery-content-verifier';
import { cleanUrl, normalizeUrl } from '@/lib/utils/url-normalizer';
import { checkGalleryDuplicate } from '@/lib/utils/task-dedup';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import type { GallerySiteProvider, SiteProvider } from '@/lib/sites';
import type { GalleryData } from '@/types';
import { t, setServerLocaleFromHeaders } from '@/lib/i18n/server';

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

/**
 * 爬取图库并异步触发下载
 *
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  setServerLocaleFromHeaders(request.headers);
  try {
    const body = await request.json();
    const { url: rawUrl } = body;

    if (!rawUrl) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // 清洗 URL：去除首尾空白、不可见字符、零宽字符等
    const url = cleanUrl(rawUrl);
    const normalizedUrl = normalizeUrl(url);

    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);

    if (!provider) {
      return NextResponse.json({ error: t('api.gallery.noProvider') }, { status: 400 });
    }

    const galleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
    if (!galleryProvider.scrapeGallery) {
      return NextResponse.json(
        { error: `站点 ${provider.name} 不支持图库爬取` },
        { status: 400 }
      );
    }

    // 去重检查：精确匹配 + 镜像域名匹配 + 路径签名匹配
    const dedupResult = await checkGalleryDuplicate(url);
    if (dedupResult.duplicate) {
      return NextResponse.json({
        duplicate: true,
        matchType: dedupResult.matchType,
        galleryId: dedupResult.recordId,
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
        siteId: provider.id,
        status: 'scraping',
        seq,
      },
      update: {
        status: 'scraping',
      },
    });

    eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

    // TTL 锁防止同一 URL 被并发爬取
    const lockKey = `gallery:scrape:${url}`;
    const lockHandle = await ttlLock.acquire(lockKey, {
      ttl: 120000,
      waitTimeout: 5000,
    });

    if (!lockHandle) {
      return NextResponse.json(
        { error: t('api.gallery.alreadyScraping') },
        { status: 409 }
      );
    }

    const browser = await getSharedBrowser();
    const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

    try {
      const adaptiveProvider = galleryProvider as SiteProvider & Partial<{
        getAdaptiveUrls: (url: string) => string[];
        markDomainRateLimited: (domain: string) => void;
        markDomainHealthy: (domain: string) => void;
      }>;
      const urlsToTry = adaptiveProvider.getAdaptiveUrls ? adaptiveProvider.getAdaptiveUrls(url) : [url];
      let result: Awaited<ReturnType<GallerySiteProvider['scrapeGallery']>> | null = null;
      let lastError: unknown = null;

      let isNotFound = false;

      for (const tryUrl of urlsToTry) {
        try {
          const response = await page.goto(tryUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          const httpStatus = response?.status();
          if (httpStatus === 404) {
            console.warn(`[Gallery] 域名 ${tryUrl} 返回 404`);
            isNotFound = true;
            lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
            continue;
          }

          // 检测 403/429 限流，快速切换域名（不再等待 10s 超时）
          if (httpStatus === 403 || httpStatus === 429) {
            const domain = extractDomainFromUrl(tryUrl);
            console.warn(`[Gallery] 域名 ${tryUrl} 返回 ${httpStatus}（限流），快速切换`);
            if (domain && adaptiveProvider.markDomainRateLimited) {
              adaptiveProvider.markDomainRateLimited(domain);
            }
            lastError = new Error(`RATE_LIMITED: ${tryUrl}`);
            continue;
          }

          const resp = await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
          if (!resp) {
            console.warn(`[Gallery] 域名 ${tryUrl} 未找到 article，尝试下一个`);
            lastError = new Error(`页面无内容: ${tryUrl}`);
            continue;
          }

          result = await galleryProvider.scrapeGallery!(page, tryUrl);

          // 检测页面内容是否为 404（标题为 "404" 或包含"页面不存在"）
          if (result.title === '404' || result.title.includes('页面不存在') || result.title.includes('Not Found')) {
            console.warn(`[Gallery] 域名 ${tryUrl} 页面内容为 404: "${result.title}"`);
            isNotFound = true;
            result = null;
            lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
            continue;
          }

          // 成功，标记域名为健康
          const successDomain = extractDomainFromUrl(tryUrl);
          if (successDomain && adaptiveProvider.markDomainHealthy) {
            adaptiveProvider.markDomainHealthy(successDomain);
          }

          break;
        } catch (err) {
          console.warn(`[Gallery] 域名 ${tryUrl} 爬取失败:`, err instanceof Error ? err.message : err);
          lastError = err;
          if (err instanceof Error && err.message.includes('内容被屏蔽')) {
            throw err;
          }
          if (err instanceof Error && err.message.includes('PAGE_NOT_FOUND')) {
            isNotFound = true;
          }
        }
      }

      if (!result) {
        if (isNotFound) {
          await prisma.gallery.update({
            where: { id: gallery.id },
            data: { status: 'not_found' },
          });

          await page.close().catch(() => {});
          await context.close().catch(() => {});

          eventBus.emit('gallery:scrapeFailed', {
            galleryId: gallery.id,
            url,
            error: t('api.gallery.pageNotFound'),
          });

          return NextResponse.json({
            message: t('api.gallery.pageNotFoundSkipped'),
            data: { ID: gallery.id, SourceURL: url, Status: 'not_found' },
          });
        }
        throw lastError || new Error('所有域名均爬取失败');
      }

      // 解析标题中的预期图片/视频数量（如 "11P2V"）
      const { expectedImages, expectedVideos } = parseTitleCount(result.title);

      await prisma.gallery.update({
        where: { id: gallery.id },
        data: {
          title: result.title,
          protagonist: result.protagonist,
          description: result.description,
          category: result.category,
          tags: JSON.stringify(result.tags),
          coverUrl: result.coverUrl,
          publishTime: result.publishTime || null,
          imageCount: result.imageCount,
          videoCount: result.videoCount,
          pageCount: result.pageCount,
          scrapedDomain: result.scrapedDomain || '',
          gameCharacters: result.gameCharacters ? JSON.stringify(result.gameCharacters) : null,
          expectedImageCount: expectedImages,
          expectedVideoCount: expectedVideos,
          status: 'completed',
        },
        include: { images: true, videos: true },
      });

      // 持久化 ZIP 压缩包下载信息
      if (result.zipInfo) {
        const zipDownloadSource = detectDownloadSource(result.zipInfo.downloadUrl);
        const isOuoUrl = zipDownloadSource === 'ouo';
        await prisma.galleryDownloadInfo.upsert({
          where: { galleryId: gallery.id },
          create: {
            galleryId: gallery.id,
            title: result.zipInfo.title,
            fileCount: result.zipInfo.fileCount,
            fileSizeText: result.zipInfo.fileSizeText,
            imageDimensions: result.zipInfo.imageDimensions,
            password: result.zipInfo.password,
            downloadUrl: result.zipInfo.downloadUrl,
            downloadSource: zipDownloadSource,
            ouoUrl: isOuoUrl ? result.zipInfo.downloadUrl : '',
            provider: result.zipInfo.provider,
            requiresLogin: result.zipInfo.requiresLogin,
            requiresEmail: result.zipInfo.requiresEmail,
            status: result.zipInfo.downloadUrl ? 'available' : 'unavailable',
          },
          update: {
            title: result.zipInfo.title,
            fileCount: result.zipInfo.fileCount,
            fileSizeText: result.zipInfo.fileSizeText,
            imageDimensions: result.zipInfo.imageDimensions,
            password: result.zipInfo.password,
            downloadUrl: result.zipInfo.downloadUrl,
            downloadSource: zipDownloadSource,
            ouoUrl: isOuoUrl ? result.zipInfo.downloadUrl : '',
            provider: result.zipInfo.provider,
            requiresLogin: result.zipInfo.requiresLogin,
            requiresEmail: result.zipInfo.requiresEmail,
            status: result.zipInfo.downloadUrl ? 'available' : 'unavailable',
          },
        });
      }

      if (result.images.length > 0) {
        await prisma.galleryImage.createMany({
          data: result.images.map((img) => ({
            galleryId: gallery.id,
            url: img.url,
            pageIndex: img.pageIndex,
            orderIndex: img.orderIndex,
            status: 'pending',
          })),
        });
      }

      if (result.videos.length > 0) {
        await prisma.galleryVideo.createMany({
          data: result.videos.map((vid) => ({
            galleryId: gallery.id,
            url: vid.url,
            status: 'pending',
          })),
        });
      }

      const fullGallery = await prisma.gallery.findUnique({
        where: { id: gallery.id },
        include: { images: true, videos: true, downloadInfo: true },
      });

      await page.close();
      await context.close();

      eventBus.emit('gallery:scrapeCompleted', {
        galleryId: gallery.id,
        title: result.title,
        imageCount: result.imageCount,
        videoCount: result.videoCount,
      });

      // 异步触发图包下载（不阻塞 API 响应）
      // 通过队列管理器获取槽位，遵守并发上限设置
      taskQueueManager.acquireSlot('gallery', gallery.id).then(async (acquired) => {
        if (!acquired) {
          console.log(`[Gallery] 图库 #${gallery.id} 在排队等待中被取消`);
          return;
        }
        const currentGallery = await prisma.gallery.findUnique({ where: { id: gallery.id } });
        if (!currentGallery || currentGallery.status === 'completed' || currentGallery.status === 'not_found') {
          taskQueueManager.releaseSlot('gallery', gallery.id);
          return;
        }
        getGalleryDownloader()
          .downloadGallery(gallery.id)
          .then((dlResult) => {
            console.log(
              `[Gallery] 图库 #${gallery.id} 下载完成: ` +
              `成功 ${dlResult.success}, 失败 ${dlResult.failed}, 跳过 ${dlResult.skipped}, ` +
              `保存路径 ${dlResult.savePath}`,
            );
          })
          .catch((err) => {
            console.error(`[Gallery] 图库 #${gallery.id} 下载失败:`, err);
            eventBus.emit('gallery:downloadFailed', { galleryId: gallery.id, error: err.message });
          });
      });

      return NextResponse.json({
        message: '图库爬取完成，下载已异步启动',
        data: mapGallery(fullGallery!),
      });
    } catch (err) {
      await page.close().catch(() => {});
      await context.close().catch(() => {});

      const errMsg = err instanceof Error ? err.message : String(err);
      const notFound = errMsg.includes('PAGE_NOT_FOUND') || errMsg.includes('404');

      await prisma.gallery.update({
        where: { id: gallery.id },
        data: { status: notFound ? 'not_found' : 'failed' },
      });

      eventBus.emit('gallery:scrapeFailed', {
        galleryId: gallery.id,
        url,
        error: errMsg,
      });

      throw err;
    } finally {
      ttlLock.releaseHandle(lockHandle);
      await context.close().catch(() => {});
    }
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
    // 默认跳过 count 查询以加速响应；仅在明确请求分页计数时执行
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
