import prisma from '@/lib/db/prisma';
import { getScraper } from '@/lib/sites/scraper';
import { mapTask, getDownloadManager } from '@/lib/api-helpers';
import { eventBus } from '@/lib/core/infra/event-bus';
import { setM3U8Candidates } from '@/lib/core/domain/m3u8-candidate-store';
import { t } from '@/lib/i18n/server';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';
import { createGalleryTask } from '@/lib/downloader/gallery-handler';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { createStealthPage, sleep, randomDelay } from '@/lib/core/stealth/anti-crawler';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';


export async function scrapeVideoAsync(taskId: number, url: string): Promise<void> {
  const acquired = await taskQueueManager.acquireSlot('video', taskId);
  if (!acquired) {
    console.log(`[Tasks] Video #${taskId} cancelled while queued`);
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
      console.log(`[Tasks] Video #${taskId} cancelled while in recognition queue`);
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
        data: { status: 'failed', errorMsg: `Scrape failed: ${errMsg}` },
      });
      eventBus.emit('task:failed', { taskId, error: `Scrape failed: ${errMsg}` });
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
        errorMsg: t("api.tasks.multipleM3u8Detected", { count: m3u8Candidates.length }),
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
        console.error(`[Tasks] Download task #${taskId} failed to start: ${err.message}`);
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


export async function scrapeListingAndEnqueue(
  sniffId: number,
  listingUrl: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<void> {
  const acquired = await taskQueueManager.acquireSlot('sniff', sniffId);
  if (!acquired) {
    console.log(`[Tasks] Sniff task #${sniffId} cancelled while queued`);
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
      throw new Error(t('api.tasks.unsupportedListScrape'));
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
          status: 'scrape_pending',
          seq,
        },
        update: {
          status: 'scrape_pending',
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

      createGalleryTask(normalizedUrl, provider).catch((err) => {
        console.error(`[Tasks-Listing] Gallery #${gallery.id} async scrape error:`, err);
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
