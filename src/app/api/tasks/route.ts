/**
 * tasks/route.ts — 下载任务列表和创建 API
 *
 * GET  /api/tasks        — 获取所有任务列表（视频任务 + 图库任务，可按状态过滤）
 * POST /api/tasks        — 创建新的下载任务（自动识别视频/图库类型）
 *
 * 对于图库站点（如爱妹子），POST 会自动检测并路由到图库流程：
 * - 多域名自适应：跳房子算法，遇 403/404 自动切换镜像
 * - 调用 scrapeGallery 翻页爬取全部图片和视频
 * - 提取 ZIP 压缩包下载信息并持久化
 * - 异步触发 GalleryDownloader 下载到本地
 * - 返回 galleryId 供前端跳转
 *
 * @date 2026-07-11
 * @lastModified 2026-07-12
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getScraper } from '@/lib/scraper/scraper';
import { mapTask, getDownloadManager } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/event-bus';
import { getSiteRegistry } from '@/lib/sites';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/browser-pool';
import { getGalleryDownloader } from '@/lib/downloader/gallery-downloader';
import { createStealthPage } from '@/lib/core/anti-crawler';
import type { DownloadTask, TaskStatus } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ============================================================
// GET /api/tasks — 获取任务列表（含视频和图库任务）
// ============================================================

/**
 * 将 Gallery 状态映射为 TaskStatus
 *
 * Gallery 状态：pending | scraping | completed | failed | downloading | partial | not_found
 *
 * @date 2026-07-12
 */
function mapGalleryStatus(status: string): TaskStatus {
  switch (status) {
    case 'completed':
    case 'partial':
      return 'completed';
    case 'downloading':
      return 'downloading';
    case 'scraping':
      return 'pending';
    case 'failed':
    case 'not_found':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * 将 Gallery 记录映射为统一的 DownloadTask 格式
 *
 * @date 2026-07-12
 */
function mapGalleryToTask(g: {
  id: number;
  sourceUrl: string;
  title: string;
  status: string;
  downloadMethod: string;
  imageCount: number;
  videoCount: number;
  totalSize: bigint;
  downloadedSize: bigint;
  savePath: string;
  createdAt: Date;
  updatedAt: Date;
}): DownloadTask {
  const totalSize = Number(g.totalSize || BigInt(0));
  const downloadedSize = Number(g.downloadedSize || BigInt(0));
  const progress = totalSize > 0 ? Math.min((downloadedSize / totalSize) * 100, 100) : 0;

  return {
    ID: g.id,
    URL: g.sourceUrl,
    M3U8URL: '',
    Status: mapGalleryStatus(g.status),
    Progress: progress,
    FilePath: g.savePath,
    Format: '',
    Priority: 0,
    ErrorMsg: '',
    CreatedAt: g.createdAt.toISOString(),
    UpdatedAt: g.updatedAt.toISOString(),
    TaskType: 'gallery',
    GalleryTitle: g.title,
    ImageCount: g.imageCount,
    VideoCount: g.videoCount,
    DownloadMethod: g.downloadMethod,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where = status ? { status } : {};

    const [tasks, galleries] = await Promise.all([
      prisma.downloadTask.findMany({
        where,
        include: { videoInfo: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.gallery.findMany({
        orderBy: { createdAt: 'desc' },
        include: { downloadInfo: true },
      }),
    ]);

    const videoTasks = tasks.map(mapTask);
    const galleryTasks = galleries
      .map(mapGalleryToTask)
      .filter((t) => !status || t.Status === status);

    const all = [...videoTasks, ...galleryTasks].sort(
      (a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime(),
    );

    return NextResponse.json(all);
  } catch {
    return NextResponse.json({ error: 'Failed to list tasks' }, { status: 500 });
  }
}

/**
 * 检测 URL 是否属于图库站点（Provider 实现了 scrapeGallery）
 *
 * @date 2026-07-11
 */
function getGalleryProvider(url: string): (SiteProvider & GallerySiteProvider) | null {
  if (url.endsWith('.m3u8')) return null;

  const registry = getSiteRegistry();
  const provider = registry.getProviderByUrl(url);
  if (!provider) return null;

  const galleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
  if (typeof galleryProvider.scrapeGallery !== 'function') return null;

  return galleryProvider as SiteProvider & GallerySiteProvider;
}

/**
 * 异步爬取图库全部页面图片和视频，完成后触发下载
 *
 * 调用方无需 await，所有异常在内部处理并更新状态
 *
 * @date 2026-07-12
 */
async function scrapeGalleryAsync(galleryId: number, url: string, provider: SiteProvider & GallerySiteProvider): Promise<void> {
  const browser = await getSharedBrowser();
  const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

  try {
    const adaptiveProvider = provider as SiteProvider & Partial<{ getAdaptiveUrls: (url: string) => string[] }>;
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
          isNotFound = true;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        const resp = await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
        if (!resp) {
          lastError = new Error(`页面无内容: ${tryUrl}`);
          continue;
        }

        result = await provider.scrapeGallery(page, tryUrl);

        if (result.title === '404' || result.title.includes('页面不存在') || result.title.includes('Not Found')) {
          isNotFound = true;
          result = null;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        break;
      } catch (err) {
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
          where: { id: galleryId },
          data: { status: 'not_found' },
        });
        eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: '页面不存在 (404)' });
        return;
      }
      throw lastError || new Error('所有域名均爬取失败');
    }

    await prisma.gallery.update({
      where: { id: galleryId },
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
        status: 'downloading',
      },
    });

    if (result.zipInfo) {
      await prisma.galleryDownloadInfo.upsert({
        where: { galleryId },
        create: {
          galleryId,
          title: result.zipInfo.title,
          fileCount: result.zipInfo.fileCount,
          fileSizeText: result.zipInfo.fileSizeText,
          imageDimensions: result.zipInfo.imageDimensions,
          password: result.zipInfo.password,
          downloadUrl: result.zipInfo.downloadUrl,
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
          galleryId,
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
          galleryId,
          url: vid.url,
          status: 'pending',
        })),
      });
    }

    eventBus.emit('gallery:scrapeCompleted', {
      galleryId,
      title: result.title,
      imageCount: result.imageCount,
      videoCount: result.videoCount,
    });

    getGalleryDownloader()
      .downloadGallery(galleryId)
      .then((dlResult) => {
        console.log(
          `[Tasks-Gallery] 图库 #${galleryId} 下载完成: ` +
          `成功 ${dlResult.success}, 失败 ${dlResult.failed}, 跳过 ${dlResult.skipped}`,
        );
      })
      .catch((err) => {
        console.error(`[Tasks-Gallery] 图库 #${galleryId} 下载失败:`, err);
        eventBus.emit('gallery:downloadFailed', { galleryId, error: err.message });
      });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const notFound = errMsg.includes('PAGE_NOT_FOUND') || errMsg.includes('404');

    await prisma.gallery.update({
      where: { id: galleryId },
      data: { status: notFound ? 'not_found' : 'failed' },
    });

    eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: errMsg });
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * 异步爬取视频页面提取 M3U8 和元数据，完成后自动启动下载
 *
 * 调用方无需 await
 *
 * @date 2026-07-12
 */
async function scrapeVideoAsync(taskId: number, url: string): Promise<void> {
  let m3u8URL = '';
  let title = '';
  let tags: string[] = [];
  let actors: string[] = [];
  let categories: string[] = [];
  let director = '';

  if (url.endsWith('.m3u8')) {
    m3u8URL = url;
  } else {
    try {
      const scraper = getScraper();
      const result = await scraper.scrape(url);
      m3u8URL = result.m3u8_url;
      title = result.title;
      tags = result.tags;
      actors = result.actors;
      categories = result.categories;
      director = result.director;
    } catch (scrapeErr) {
      const errMsg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMsg: `爬取失败: ${errMsg}` },
      });
      eventBus.emit('task:failed', { taskId, error: `爬取失败: ${errMsg}` });
      return;
    }
  }

  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      m3u8Url: m3u8URL || '',
      videoInfo: {
        update: {
          title: title || '',
          tags: JSON.stringify(tags),
          actors: JSON.stringify(actors),
          categories: JSON.stringify(categories),
          director,
        },
      },
    },
  });

  eventBus.emit('task:scraped', { taskId, m3u8URL, title });

  if (m3u8URL) {
    const dm = getDownloadManager();
    const updatedTask = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      include: { videoInfo: true },
    });
    if (updatedTask) {
      dm.startDownload(mapTask(updatedTask)).catch((err) => {
        console.error(`[Tasks] 下载任务 #${taskId} 启动失败: ${err.message}`);
      });
    }
  } else {
    await prisma.downloadTask.update({
      where: { id: taskId },
      data: { status: 'failed', errorMsg: '无法从页面提取 M3U8 链接' },
    });
    eventBus.emit('task:failed', { taskId, error: '无法从页面提取 M3U8 链接' });
  }
}

// ============================================================
// POST /api/tasks — 创建下载任务
// ============================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // 图库站点检测：创建记录后立即返回，爬取异步执行
    const galleryProvider = getGalleryProvider(url);
    if (galleryProvider) {
      const existing = await prisma.gallery.findUnique({
        where: { sourceUrl: url },
      });

      if (existing && existing.status === 'completed') {
        return NextResponse.json({
          type: 'gallery',
          galleryId: existing.id,
        });
      }

      const gallery = await prisma.gallery.upsert({
        where: { sourceUrl: url },
        create: {
          sourceUrl: url,
          siteId: galleryProvider.id,
          status: 'scraping',
        },
        update: {
          status: 'scraping',
        },
      });

      eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

      scrapeGalleryAsync(gallery.id, url, galleryProvider).catch((err) => {
        console.error(`[Tasks] 图库 #${gallery.id} 异步爬取异常:`, err);
      });

      return NextResponse.json({
        type: 'gallery',
        galleryId: gallery.id,
      }, { status: 201 });
    }

    // 视频任务：先创建记录，爬取和下载异步执行
    const task = await prisma.downloadTask.create({
      data: {
        url,
        m3u8Url: '',
        format: 'mp4',
        status: 'pending',
        videoInfo: {
          create: {
            title: '',
            sourceUrl: url,
          },
        },
      },
      include: { videoInfo: true },
    });

    eventBus.emit('task:created', {
      taskId: task.id,
      title: '',
      source: 'manual',
    });

    scrapeVideoAsync(task.id, url).catch((err) => {
      console.error(`[Tasks] 视频 #${task.id} 异步爬取异常:`, err);
    });

    return NextResponse.json(mapTask(task), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
