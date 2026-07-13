/**
 * 图库爬取 API
 *
 * POST /api/gallery
 *   请求体: { url: string }
 *   功能: 爬取指定 URL 的图库（图片+视频），保存到数据库，异步触发下载
 *   返回: GalleryData
 *
 * GET /api/gallery
 *   查询参数: page, limit, protagonist, status
 *   功能: 查询图库列表
 *   返回: { data: GalleryData[], total: number }
 *
 * 共享基础设施：
 * - TTL 锁：防止同一 URL 被并发爬取
 * - EventBus：发布爬取进度事件
 * - 共享浏览器池：复用 Playwright 实例
 * - 反爬虫策略：UA 轮换、随机延迟
 * - 多域名自适应：跳房子算法，遇 403/404 自动切换镜像
 * - ZIP 信息提取：从页面提取压缩包下载元信息并持久化
 *
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getSiteRegistry } from '@/lib/sites';
import { getGalleryDownloader } from '@/lib/downloader/gallery-downloader';
import { getSharedBrowser } from '@/lib/core/browser-pool';
import { ttlLock } from '@/lib/core/ttl-lock';
import { eventBus } from '@/lib/core/event-bus';
import { createStealthPage } from '@/lib/core/anti-crawler';
import { allocateSeq } from '@/lib/core/seq-allocator';
import { parseTitleCount, detectDownloadSource } from '@/lib/downloader/gallery-content-verifier';
import type { GallerySiteProvider, SiteProvider } from '@/lib/sites';
import type { GalleryData } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// 工具函数
// ============================================================

type GalleryWithRelations = {
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

// ============================================================
// POST /api/gallery — 爬取图库
// ============================================================

/**
 * 爬取图库并异步触发下载
 *
 * 流程：
 * 1. 通过 TTL 锁防止同一 URL 并发爬取
 * 2. 创建/更新图库记录（状态 scraping）
 * 3. 多域名自适应：若 Provider 支持 getAdaptiveUrls，按跳房子算法依次尝试
 * 4. 使用共享浏览器实例打开页面
 * 5. 调用 Provider 的 scrapeGallery 提取全部图片和视频
 * 6. 批量写入数据库（含 ZIP 下载信息）
 * 7. 发布 EventBus 事件
 * 8. 异步触发 GalleryDownloader 下载
 *
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);

    if (!provider) {
      return NextResponse.json({ error: '未找到匹配的站点提供者' }, { status: 400 });
    }

    const galleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
    if (!galleryProvider.scrapeGallery) {
      return NextResponse.json(
        { error: `站点 ${provider.name} 不支持图库爬取` },
        { status: 400 }
      );
    }

    const existing = await prisma.gallery.findUnique({
      where: { sourceUrl: url },
      include: { downloadInfo: true },
    });

    if (existing && existing.status === 'completed') {
      return NextResponse.json({
        message: '图库已存在且已完成爬取',
        data: mapGallery(existing as GalleryWithRelations),
      });
    }

    const seq = await allocateSeq();
    const gallery = await prisma.gallery.upsert({
      where: { sourceUrl: url },
      create: {
        sourceUrl: url,
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
        { error: '该图库正在被其他任务爬取，请稍后重试' },
        { status: 409 }
      );
    }

    const browser = await getSharedBrowser();
    const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

    try {
      // 多域名自适应：若 Provider 支持 getAdaptiveUrls，依次尝试各镜像
      const adaptiveProvider = galleryProvider as SiteProvider & Partial<{ getAdaptiveUrls: (url: string) => string[] }>;
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
            error: '页面不存在 (404)',
          });

          return NextResponse.json({
            message: '页面不存在 (404)，已跳过',
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

// ============================================================
// GET /api/gallery — 查询图库列表
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const protagonist = searchParams.get('protagonist') || '';
    const status = searchParams.get('status') || '';

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

    const [galleries, total] = await Promise.all([
      prisma.gallery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { downloadInfo: true },
      }),
      prisma.gallery.count({ where }),
    ]);

    return NextResponse.json({
      data: galleries.map((g) => mapGallery(g as GalleryWithRelations)),
      total,
      page,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch galleries';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
