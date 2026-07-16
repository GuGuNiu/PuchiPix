import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getScraper } from '@/lib/scraper/scraper';
import { mapTask, getDownloadManager } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/event-bus';
import { allocateSeq } from '@/lib/core/seq-allocator';
import { setM3U8Candidates } from '@/lib/core/m3u8-candidate-store';
import { cleanUrl, normalizeUrl } from '@/lib/utils/url-normalizer';
import { checkVideoTaskDuplicate } from '@/lib/utils/task-dedup';
import { t } from '@/lib/i18n/server';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import { getGalleryProvider, scrapeGalleryAsync } from '@/lib/tasks/gallery-handler';
import { getSharedBrowser } from '@/lib/core/browser-pool';
import { createStealthPage, sleep, randomDelay } from '@/lib/core/anti-crawler';
import { checkGalleryDuplicate } from '@/lib/utils/task-dedup';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import type { DownloadTask, TaskStatus } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 将 Gallery 状态映射为 TaskStatus
 *
 * Gallery 状态：pending | scraping | completed | failed | downloading | partial | not_found
 */
function mapGalleryStatus(status: string): TaskStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'partial':
      return 'partial';
    case 'downloading':
      return 'downloading';
    case 'scraping':
      return 'scraping';
    case 'failed':
    case 'not_found':
      return 'failed';
    default:
      return 'pending';
  }
}

/**
 * 将 Gallery 记录映射为统一的 DownloadTask 格式
 */
function mapGalleryToTask(g: {
  id: number;
  seq?: string | null;
  sourceUrl: string;
  title: string;
  protagonist: string;
  description: string;
  gameCharacters: string | null;
  status: string;
  errorMsg: string;
  downloadMethod: string;
  imageCount: number;
  videoCount: number;
  totalSize: bigint;
  downloadedSize: bigint;
  savePath: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { images: number; videos: number };
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
}): DownloadTask {
  const totalFiles = g.imageCount + g.videoCount;
  const downloadedFiles = (g._count?.images ?? 0) + (g._count?.videos ?? 0);
  const progress = totalFiles > 0
    ? Math.min((downloadedFiles / totalFiles) * 100, 100)
    : 0;

  let person = g.protagonist || '';
  if (!person && g.gameCharacters) {
    try {
      const gc = JSON.parse(g.gameCharacters);
      if (Array.isArray(gc) && gc.length > 0) {
        person = gc.join('、');
      }
    } catch {
    }
  }

  return {
    ID: g.id,
    DisplayID: g.seq ?? undefined,
    URL: g.sourceUrl,
    M3U8URL: '',
    Status: mapGalleryStatus(g.status),
    Progress: progress,
    FilePath: g.savePath,
    Format: '',
    Priority: 0,
    ErrorMsg: g.errorMsg,
    CreatedAt: g.createdAt.toISOString(),
    UpdatedAt: g.updatedAt.toISOString(),
    TaskType: 'gallery',
    GalleryTitle: g.title,
    Person: person || undefined,
    ImageCount: g.imageCount,
    VideoCount: g.videoCount,
    DownloadMethod: g.downloadMethod,
    GalleryTotalSize: Number(g.totalSize),
    DownloadInfo: g.downloadInfo ? {
      ID: g.downloadInfo.id,
      GalleryID: g.downloadInfo.galleryId,
      Title: g.downloadInfo.title,
      FileCount: g.downloadInfo.fileCount,
      FileSizeText: g.downloadInfo.fileSizeText,
      ImageDimensions: g.downloadInfo.imageDimensions,
      Password: g.downloadInfo.password,
      DownloadURL: g.downloadInfo.downloadUrl,
      DownloadSource: g.downloadInfo.downloadSource,
      OuoURL: g.downloadInfo.ouoUrl,
      ResolvedDirectURL: g.downloadInfo.resolvedDirectUrl,
      Provider: g.downloadInfo.provider,
      RequiresLogin: g.downloadInfo.requiresLogin,
      RequiresEmail: g.downloadInfo.requiresEmail,
      Status: g.downloadInfo.status,
      LocalPath: g.downloadInfo.localPath,
      ExtractedPath: g.downloadInfo.extractedPath,
      ActualSize: Number(g.downloadInfo.actualSize),
      ZipFileName: g.downloadInfo.zipFileName,
      Parallelism: g.downloadInfo.parallelism,
      AvgSpeed: g.downloadInfo.avgSpeed,
      VerifiedCount: g.downloadInfo.verifiedCount,
      CountMatched: g.downloadInfo.countMatched,
    } : undefined,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const where = status ? { status } : {};

    const [tasks, galleries, sniffTasks] = await Promise.all([
      prisma.downloadTask.findMany({
        where,
        include: { videoInfo: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.gallery.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          downloadInfo: true,
          _count: {
            select: {
              images: { where: { status: 'downloaded' } },
              videos: { where: { status: 'completed' } },
            },
          },
        },
      }),
      prisma.sniffTask.findMany({
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const videoTasks = tasks.map(mapTask);
    const galleryTasks = galleries
      .map(mapGalleryToTask)
      .filter((t: DownloadTask) => !status || t.Status === status);
    const sniffTaskList = sniffTasks
      .map(mapSniffToTask)
      .filter((t: DownloadTask) => !status || t.Status === status);

    const all = [...videoTasks, ...galleryTasks, ...sniffTaskList].sort(
      (a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime(),
    );

    return NextResponse.json(all);
  } catch {
    return NextResponse.json({ error: 'Failed to list tasks' }, { status: 500 });
  }
}

/** 图库 URL 检测和异步爬取逻辑已提取到 src/lib/tasks/gallery-handler.ts */

/**
 * 异步爬取视频页面提取 M3U8 和元数据，完成后自动启动下载
 *
 * 路由逻辑：
 - 若 URL 匹配本地适配模块（Kanav 等），使用该模块的爬取逻辑
 - 若 URL 不匹配任何本地模块，使用通用下载器（UniversalProvider）
 - 通用下载器检测到多个 M3U8 时，存储候选项并等待用户选择
 *
 */
async function scrapeVideoAsync(taskId: number, url: string): Promise<void> {
  const acquired = await taskQueueManager.acquireSlot('video', taskId);
  if (!acquired) {
    console.log(`[Tasks] 视频 #${taskId} 在排队等待中被取消`);
    return;
  }

  const pendingTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
  if (!pendingTask || pendingTask.status === 'cancelled') {
    taskQueueManager.releaseSlot('video', taskId);
    return;
  }

  if (!url.endsWith('.m3u8')) {
    const scrapingAcquired = await taskQueueManager.acquireScrapingSlot('video', taskId);
    if (!scrapingAcquired) {
      console.log(`[Tasks] 视频 #${taskId} 在识别排队等待中被取消`);
      taskQueueManager.releaseSlot('video', taskId);
      return;
    }

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: { status: 'scraping' },
    });
    eventBus.emit('task:scraping', { taskId, url });
  }

  let m3u8URL = '';
  let title = '';
  let tags: string[] = [];
  let actors: string[] = [];
  let categories: string[] = [];
  let director = '';
  let m3u8Candidates: { url: string; title: string }[] | undefined;

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
      m3u8Candidates = result.m3u8_candidates;
    } catch (scrapeErr) {
      const errMsg = scrapeErr instanceof Error ? scrapeErr.message : String(scrapeErr);
      taskQueueManager.releaseScrapingSlot('video', taskId);
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMsg: `爬取失败: ${errMsg}` },
      });
      eventBus.emit('task:failed', { taskId, error: `爬取失败: ${errMsg}` });
      return;
    }
  }

  // 直接 M3U8 地址无需识别阶段
  if (!url.endsWith('.m3u8')) {
    taskQueueManager.releaseScrapingSlot('video', taskId);
  }

  // 通用下载器：检测到多个 M3U8 候选项，等待用户选择
  if (m3u8Candidates && m3u8Candidates.length > 1) {
    setM3U8Candidates(taskId, m3u8Candidates);

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: {
        m3u8Url: m3u8URL || '',
        status: 'pending',
        errorMsg: `检测到 ${m3u8Candidates.length} 个 M3U8 地址，请选择`,
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

    eventBus.emit('task:m3u8Select', { taskId, candidates: m3u8Candidates });

    // 任务进入 pending 等待用户选择 M3U8，释放普通槽位
    // 用户选择后 select-m3u8 路由会重新获取槽位
    taskQueueManager.releaseSlot('video', taskId);
    return;
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
        eventBus.emit('task:failed', { taskId, error: err.message });
      });
    }
  } else {
    // 识别槽位已在上方释放（line 280），此处无需重复释放
    await prisma.downloadTask.update({
      where: { id: taskId },
      data: { status: 'failed', errorMsg: t('api.tasks.noM3u8Extracted') },
    });
    eventBus.emit('task:failed', { taskId, error: t('api.tasks.noM3u8Extracted') });
  }
}

/**
 * 将 SniffTask 记录映射为统一的 DownloadTask 格式
 *
 * 嗅探任务使用统一编号序列，与下载任务共享同一编号空间
 */
function mapSniffToTask(s: {
  id: number;
  seq?: string | null;
  url: string;
  status: string;
  totalFound: number;
  totalCreated: number;
  totalSkipped: number;
  errorMsg: string;
  createdAt: Date;
  updatedAt: Date;
}): DownloadTask {
  const statusMap: Record<string, TaskStatus> = {
    pending: 'pending',
    sniffing: 'scraping',
    completed: 'completed',
    failed: 'failed',
  };

  const progress = s.status === 'completed' ? 100 : s.status === 'sniffing' ? 30 : 0;

  return {
    ID: s.id,
    DisplayID: s.seq ?? undefined,
    URL: s.url,
    M3U8URL: '',
    Status: statusMap[s.status] ?? 'pending',
    Progress: progress,
    FilePath: '',
    Format: '',
    Priority: 0,
    ErrorMsg: s.errorMsg,
    CreatedAt: s.createdAt.toISOString(),
    UpdatedAt: s.updatedAt.toISOString(),
    TaskType: 'sniff',
    SniffTotalFound: s.totalFound,
    SniffTotalCreated: s.totalCreated,
    SniffTotalSkipped: s.totalSkipped,
  };
}

/**
 * 异步爬取列表页，为每个图包创建下载任务
 */
async function scrapeListingAndEnqueue(
  sniffId: number,
  listingUrl: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<void> {
  const acquired = await taskQueueManager.acquireSlot('sniff', sniffId);
  if (!acquired) {
    console.log(`[Tasks] 嗅探任务 #${sniffId} 在排队等待中被取消`);
    return;
  }

  const pendingSniff = await prisma.sniffTask.findUnique({ where: { id: sniffId } });
  if (!pendingSniff || pendingSniff.status === 'cancelled') {
    taskQueueManager.releaseSlot('sniff', sniffId);
    return;
  }

  const browser = await getSharedBrowser();
  const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

  // 站点特定的浏览器上下文配置（如 ExHentai Cookie 注入）
  if (provider.setupBrowserContext) {
    await provider.setupBrowserContext(context);
  }

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalFound = 0;

  try {
    if (!provider.scrapeListingPage) {
      throw new Error('Provider 不支持列表页爬取');
    }

    await prisma.sniffTask.update({
      where: { id: sniffId },
      data: { status: 'sniffing' },
    });
    eventBus.emit('sniffTask:started', { sniffId, url: listingUrl });

    const results = await provider.scrapeListingPage(page, listingUrl);
    totalFound = results.length;

    if (results.length === 0) {
      await prisma.sniffTask.update({
        where: { id: sniffId },
        data: {
          status: 'completed',
          totalFound: 0,
          completedAt: new Date(),
        },
      });
      eventBus.emit('sniffTask:completed', { sniffId, url: listingUrl, totalFound: 0, totalCreated: 0, totalSkipped: 0 });
      return;
    }

    for (const item of results) {
      const normalizedUrl = provider.normalizeUrl
        ? provider.normalizeUrl(item.url)
        : item.url;

      const existing = await prisma.gallery.findUnique({
        where: { sourceUrl: normalizedUrl },
      });

      if (existing && existing.status === 'completed') {
        totalSkipped++;
        continue;
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

      totalCreated++;

      await prisma.sniffTask.update({
        where: { id: sniffId },
        data: { totalFound, totalCreated, totalSkipped },
      });

      eventBus.emit('sniffTask:galleryCreated', {
        sniffId,
        url: listingUrl,
        galleryId: gallery.id,
        seq: gallery.seq,
        title: item.title,
        totalCreated,
        totalSkipped,
      });

      eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url: normalizedUrl });

      scrapeGalleryAsync(gallery.id, normalizedUrl, provider).catch((err) => {
        console.error(`[Tasks-Listing] 图库 #${gallery.id} 异步爬取异常:`, err);
      });

      await sleep(randomDelay(500, 1500));
    }

    await prisma.sniffTask.update({
      where: { id: sniffId },
      data: {
        status: 'completed',
        totalFound,
        totalCreated,
        totalSkipped,
        completedAt: new Date(),
      },
    });

    eventBus.emit('sniffTask:completed', {
      sniffId,
      url: listingUrl,
      totalFound,
      totalCreated,
      totalSkipped,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.sniffTask.update({
      where: { id: sniffId },
      data: {
        status: 'failed',
        errorMsg: errMsg,
        totalFound,
        totalCreated,
        totalSkipped,
      },
    });
    eventBus.emit('sniffTask:failed', { sniffId, url: listingUrl, error: errMsg });
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { url: rawUrl } = body;

    if (!rawUrl) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // 清理 URL：去除首尾空白、不可见字符、零宽字符等
    const url = cleanUrl(rawUrl);
    const normalizedUrl = normalizeUrl(url);

    // 图库站点检测：创建记录后立即返回，爬取异步执行
    const galleryProvider = getGalleryProvider(url);
    if (galleryProvider) {
      // 列表页检测：标签页/搜索页/分类页等，创建嗅探任务并异步分析
      if (galleryProvider.isListingPage?.(url)) {
        const sniffSeq = await allocateSeq();
        const sniffTask = await prisma.sniffTask.create({
          data: {
            url,
            siteId: galleryProvider.id,
            status: 'pending',
            seq: sniffSeq,
          },
        });

        scrapeListingAndEnqueue(sniffTask.id, url, galleryProvider).catch((err) => {
          console.error(`[Tasks] 嗅探任务 #${sniffTask.id} 异常:`, err);
        });

        return NextResponse.json({
          type: 'sniff',
          sniffId: sniffTask.id,
          seq: sniffTask.seq,
          url,
        }, { status: 201 });
      }

      // 去重检查：精确匹配 + 镜像域名匹配 + 路径签名匹配
      const dedupResult = await checkGalleryDuplicate(url);
      if (dedupResult.duplicate) {
        return NextResponse.json({
          type: 'gallery',
          galleryId: dedupResult.recordId,
          duplicate: true,
          matchType: dedupResult.matchType,
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
          siteId: galleryProvider.id,
          status: 'scraping',
          seq,
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
        seq: gallery.seq,
      }, { status: 201 });
    }

    // 图库站点检测（爱妹子等）已在上方处理，其余按以下顺序路由：
    // 直接 M3U8 地址由通用下载器直接下载，本地适配模块（Kanav 等）使用专用 Provider 爬取，
    // 未匹配任何模块时回退到通用下载器爬取页面提取 M3U8
    //
    // Scraper.getProvider() 内部调用 SiteRegistry.getProviderByUrl()
    // 自动判断是否匹配本地模块，无匹配时回退到 UniversalProvider。

    // 视频任务：先检查去重，再创建记录
    const videoDedup = await checkVideoTaskDuplicate(url);
    if (videoDedup.duplicate) {
      return NextResponse.json({
        type: 'video',
        taskId: videoDedup.recordId,
        duplicate: true,
        matchType: videoDedup.matchType,
        existingUrl: videoDedup.existingUrl,
        existingStatus: videoDedup.status,
        message: videoDedup.message,
      }, { status: 409 });
    }

    const isDirectM3u8 = url.endsWith('.m3u8');
    const videoSeq = await allocateSeq();
    const task = await prisma.downloadTask.create({
      data: {
        url: normalizedUrl,
        m3u8Url: isDirectM3u8 ? url : '',
        format: 'mp4',
        status: isDirectM3u8 ? 'pending' : 'scraping',
        seq: videoSeq,
        videoInfo: {
          create: {
            title: '',
            sourceUrl: normalizedUrl,
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
