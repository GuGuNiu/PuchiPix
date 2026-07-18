import prisma from '@/lib/db/prisma';
import { getScraper } from '@/lib/sites/scraper';
import { mapTask, getDownloadManager } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/infra/event-bus';
import { setM3U8Candidates } from '@/lib/core/domain/m3u8-candidate-store';
import { t } from '@/lib/i18n/server';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import { scrapeGalleryAsync } from '@/lib/downloader/gallery-handler';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { createStealthPage, sleep, randomDelay } from '@/lib/core/stealth/anti-crawler';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';

/**
 * 异步爬取视频页面提取 M3U8 和元数据，完成后自动启动下载
 */
export async function scrapeVideoAsync(taskId: number, url: string): Promise<void> {
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

  if (!url.endsWith('.m3u8')) {
    taskQueueManager.releaseScrapingSlot('video', taskId);
  }

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
    await prisma.downloadTask.update({
      where: { id: taskId },
      data: { status: 'failed', errorMsg: t('api.tasks.noM3u8Extracted') },
    });
    eventBus.emit('task:failed', { taskId, error: t('api.tasks.noM3u8Extracted') });
  }
}

/**
 * 异步爬取列表页，为每个图包创建下载任务
 */
export async function scrapeListingAndEnqueue(
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
