import type { Browser } from 'playwright';
import type { SearchJob, SearchItem, ScrapeResult } from '@/types';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { ttlLock } from '@/lib/core/infra/ttl-lock';
import { eventBus } from '@/lib/core/infra/event-bus';
import {
  sleep,
  gaussianDelay,
  applyStealthToPage,
  PAGE_DELAY_MIN,
  PAGE_DELAY_MAX,
} from '@/lib/core/stealth/anti-crawler';
import { createGalleryTask } from '@/lib/downloader/gallery-handler';
import { createTaskFromScrape } from './task-creator';

export interface ScrapeDeps {
  getBrowser(): Promise<Browser>;
  getProvider(siteId?: string): SiteProvider;
  log(job: SearchJob, message: string, level?: 'info' | 'warn' | 'error'): void;
  isCancelled(jobId: string): boolean;
  scrapingItems: Set<string>;
  scrapeVideoPage(browser: Browser, pageUrl: string, provider: SiteProvider): Promise<ScrapeResult>;
}

/**
 * 鎶撳彇鍗曚釜瑙嗛椤甸潰
 */
export async function scrapeVideo(
  jobId: string,
  itemUrl: string,
  job: SearchJob,
  deps: ScrapeDeps,
): Promise<SearchItem | null> {
  let targetItem: SearchItem | null = null;

  for (let ki = 0; ki < job.results.length; ki++) {
    for (let vi = 0; vi < job.results[ki].items.length; vi++) {
      if (job.results[ki].items[vi].pageUrl === itemUrl) {
        targetItem = job.results[ki].items[vi];
        break;
      }
    }
    if (targetItem) break;
  }

  if (!targetItem) return null;

  const itemKey = `${jobId}:${itemUrl}`;
  if (deps.scrapingItems.has(itemKey)) {
    deps.log(job, `瑙嗛姝ｅ湪鎶撳彇涓? ${targetItem.title}`, 'warn');
    return targetItem;
  }

  const lockKey = `scrape:${itemUrl}`;
  const lockHandle = await ttlLock.acquire(lockKey, { ttl: 60000 });
  if (!lockHandle) {
    deps.log(job, `瑙嗛姝ｅ湪琚叾浠栦换鍔℃姄鍙? ${targetItem.title}`, 'warn');
    return targetItem;
  }

  deps.scrapingItems.add(itemKey);

  const provider = deps.getProvider(job.siteId);

  targetItem.status = 'scraping';
  deps.log(job, `寮€濮嬫姄鍙? ${targetItem.title || targetItem.pageUrl}`);

  try {
    const galleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
    if (typeof galleryProvider.scrapeGallery === 'function') {
      eventBus.emit('scrape:started', { pageUrl: targetItem.pageUrl });

      const galleryResult = await createGalleryTask(targetItem.pageUrl, galleryProvider as SiteProvider & GallerySiteProvider);

      if (galleryResult.duplicate) {
        targetItem.status = 'failed';
        targetItem.error = `閲嶅: ${galleryResult.existingStatus ?? '宸插瓨鍦?}`;
        deps.log(job, `鈿狅笍 鍥惧簱宸插瓨鍦? ${targetItem.title} 鈫?鐘舵€? ${galleryResult.existingStatus ?? '鏈煡'}`, 'warn');
        job.totalFailed += 1;
        return { ...targetItem };
      }

      targetItem.taskId = galleryResult.galleryId;
      targetItem.status = 'downloaded';
      deps.log(job, `鉁?鍒涘缓鍥惧簱浠诲姟 #${galleryResult.seq}: ${targetItem.title || targetItem.pageUrl}`);

      eventBus.emit('scrape:completed', {
        pageUrl: targetItem.pageUrl,
        m3u8Url: '',
        title: targetItem.title,
      });
      eventBus.emit('task:created', {
        taskId: galleryResult.galleryId,
        title: targetItem.title,
        source: 'search',
      });

      job.totalDownloaded += 1;
      return { ...targetItem };
    }

    const browser = await deps.getBrowser();
    const scrapeResult = await deps.scrapeVideoPage(browser, targetItem.pageUrl, provider);
    eventBus.emit('scrape:started', { pageUrl: targetItem.pageUrl });

    if (scrapeResult.m3u8_url) {
      targetItem.m3u8Url = scrapeResult.m3u8_url;
      targetItem.status = 'downloaded';

      if (scrapeResult.title && scrapeResult.title.length > 0) {
        targetItem.title = scrapeResult.title;
      }

      const blockCheck = provider.checkContentBlocked(
        scrapeResult.title,
        scrapeResult.categories.join(','),
        scrapeResult.actors[0],
      );
      if (blockCheck.blocked) {
        targetItem.status = 'failed';
        targetItem.error = `鎷︽埅: ${blockCheck.reason}`;
        deps.log(job, `鎷︽埅瑙嗛: ${targetItem.title} 鈫?${blockCheck.reason}`, 'warn');
        job.totalFailed += 1;
        return { ...targetItem };
      }

      const taskId = await createTaskFromScrape({
        pageUrl: targetItem.pageUrl,
        scrapeResult,
        fallbackTitle: targetItem.title,
        source: 'search',
        onLog: (msg, level) => deps.log(job, msg, level),
      });

      targetItem.taskId = taskId;
      job.totalDownloaded += 1;
    } else {
      throw new Error('鏈壘鍒?M3U8 URL');
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    targetItem.status = 'failed';
    targetItem.error = `鎶撳彇澶辫触: ${errMsg}`;
    deps.log(job, `鉂?瑙嗛鎶撳彇澶辫触: ${targetItem.title || targetItem.pageUrl} 鈫?${errMsg}`, 'error');
    eventBus.emit('scrape:failed', { pageUrl: targetItem.pageUrl, error: errMsg });
    job.totalFailed += 1;
  } finally {
    deps.scrapingItems.delete(itemKey);
    if (lockHandle) ttlLock.releaseHandle(lockHandle);
  }

  return { ...targetItem };
}

/**
 * 鎵归噺鎶撳彇鎵€鏈?pending 瑙嗛
 */
export async function scrapeAll(
  jobId: string,
  job: SearchJob,
  deps: ScrapeDeps,
): Promise<void> {
  deps.log(job, `寮€濮嬫壒閲忔姄鍙栨墍鏈?${job.totalFound} 涓棰慲);
  const browser = await deps.getBrowser();
  const provider = deps.getProvider(job.siteId);

  for (const kwResult of job.results) {
    for (const item of kwResult.items) {
      if (deps.isCancelled(jobId)) return;
      if (item.status !== 'pending') continue;

      const itemKey = `${jobId}:${item.pageUrl}`;
      if (deps.scrapingItems.has(itemKey)) continue;

      const lockKey = `scrape:${item.pageUrl}`;
      const lockHandle = await ttlLock.acquire(lockKey, { ttl: 60000 });
      if (!lockHandle) {
        deps.log(job, `瑙嗛姝ｅ湪琚叾浠栦换鍔℃姄鍙? ${item.title}`, 'warn');
        continue;
      }

      deps.scrapingItems.add(itemKey);

      item.status = 'scraping';
      deps.log(job, `鎶撳彇: ${item.title || item.pageUrl}`);
      eventBus.emit('scrape:started', { pageUrl: item.pageUrl });

      try {
        const batchGalleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
        if (typeof batchGalleryProvider.scrapeGallery === 'function') {
          const galleryResult = await createGalleryTask(item.pageUrl, batchGalleryProvider as SiteProvider & GallerySiteProvider);

          if (galleryResult.duplicate) {
            item.status = 'failed';
            item.error = `閲嶅: ${galleryResult.existingStatus ?? '宸插瓨鍦?}`;
            job.totalFailed += 1;
            deps.log(job, `鈿狅笍 鍥惧簱宸插瓨鍦? ${item.title} 鈫?鐘舵€? ${galleryResult.existingStatus ?? '鏈煡'}`, 'warn');
            eventBus.emit('scrape:failed', { pageUrl: item.pageUrl, error: '閲嶅鍥惧簱' });
          } else {
            item.taskId = galleryResult.galleryId;
            item.status = 'downloaded';
            deps.log(job, `鉁?鍒涘缓鍥惧簱浠诲姟 #${galleryResult.seq}: ${item.title || item.pageUrl}`);

            eventBus.emit('scrape:completed', {
              pageUrl: item.pageUrl,
              m3u8Url: '',
              title: item.title,
            });
            eventBus.emit('task:created', {
              taskId: galleryResult.galleryId,
              title: item.title,
              source: 'batch',
            });
            job.totalDownloaded += 1;
          }
        } else {
          const scrapeResult = await deps.scrapeVideoPage(browser, item.pageUrl, provider);

          if (scrapeResult.m3u8_url) {
            item.m3u8Url = scrapeResult.m3u8_url;
            item.status = 'downloaded';

            if (scrapeResult.title && scrapeResult.title.length > 0) {
              item.title = scrapeResult.title;
            }

            const blockCheck = provider.checkContentBlocked(
              scrapeResult.title,
              scrapeResult.categories.join(','),
              scrapeResult.actors[0],
            );
            if (blockCheck.blocked) {
              item.status = 'failed';
              item.error = `鎷︽埅: ${blockCheck.reason}`;
              job.totalFailed += 1;
              deps.log(job, `鎷︽埅瑙嗛: ${item.title} 鈫?${blockCheck.reason}`, 'warn');
              eventBus.emit('scrape:failed', { pageUrl: item.pageUrl, error: blockCheck.reason || '鏈煡鍘熷洜' });
              continue;
            }

            const taskId = await createTaskFromScrape({
              pageUrl: item.pageUrl,
              scrapeResult,
              fallbackTitle: item.title,
              source: 'search',
              onLog: (msg, level) => deps.log(job, msg, level),
            });

            item.taskId = taskId;
            job.totalDownloaded += 1;
          } else {
            throw new Error('鏈壘鍒?M3U8 URL');
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        item.status = 'failed';
        item.error = `鎶撳彇澶辫触: ${errMsg}`;
        deps.log(job, `鉂?鎶撳彇澶辫触: ${item.title || item.pageUrl} 鈫?${errMsg}`, 'error');
        eventBus.emit('scrape:failed', { pageUrl: item.pageUrl, error: errMsg });
        job.totalFailed += 1;
      } finally {
        deps.scrapingItems.delete(itemKey);
        if (lockHandle) ttlLock.releaseHandle(lockHandle);
      }

      await sleep(gaussianDelay((PAGE_DELAY_MIN + PAGE_DELAY_MAX) / 2, 200));
    }
  }

  deps.log(job, `馃帀 鎵归噺鎶撳彇瀹屾垚锛佹垚鍔?${job.totalDownloaded}锛屽け璐?${job.totalFailed}`);
}

/**
 * 鎶撳彇瑙嗛椤甸潰锛堥€氱敤鏂规硶锛?
 */
export async function scrapeVideoPage(
  browser: Browser,
  pageUrl: string,
  provider: SiteProvider,
): Promise<ScrapeResult> {
  const page = await browser.newPage();
  await applyStealthToPage(page, undefined, provider.baseUrl);

  try {
    await page.goto(pageUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const result = await provider.scrapePage(page, pageUrl);

    await page.close();
    return result;
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
}
