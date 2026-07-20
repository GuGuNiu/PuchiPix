import type { Browser } from 'playwright';
import type { BatchSearchJob, SearchLogEntry, ScrapeResult } from '@/types';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { eventBus } from '@/lib/core/infra/event-bus';
import {
  sleep,
  randomDelay,
  applyStealthToPage,
  PAGE_DELAY_MIN,
  PAGE_DELAY_MAX,
  MAX_RETRIES,
} from '@/lib/core/stealth/anti-crawler';
import { retry } from '@/lib/utils';
import { BatchScheduler } from '@/lib/core/orchestrator/batch-scheduler';
import { createGalleryTask } from '@/lib/downloader/gallery-handler';

import {
  BATCH_MAX_PAGES,
  MATCH_THRESHOLD,
  titleSimilarity,
} from './utils';
import { goToNextPage } from './pagination';
import { createTaskFromScrape } from './task-creator';

export interface BatchSearchDeps {
  getBrowser(): Promise<Browser>;
  isCancelled(jobId: string): boolean;
  scrapeVideoPage(browser: Browser, pageUrl: string, provider: SiteProvider): Promise<ScrapeResult>;
}

export function logBatch(job: BatchSearchJob, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const entry: SearchLogEntry = {
    time: new Date().toISOString(),
    message,
    level,
  };
  job.logs.push(entry);
  if (job.logs.length > 500) {
    job.logs = job.logs.slice(-500);
  }
  const prefix = level === 'error' ? '' : level === 'warn' ? '' : '';
  console.log(`[BatchSearch ${job.id}] ${prefix} ${message}`);
}

export async function executeBatchSearch(
  job: BatchSearchJob,
  provider: SiteProvider,
  deps: BatchSearchDeps,
): Promise<void> {
  const browser = await deps.getBrowser();

  const scheduler = new BatchScheduler({
    onLog: (msg: string) => logBatch(job, msg),
  });

  for (let ti = 0; ti < job.titles.length; ti++) {
    if (deps.isCancelled(job.id)) {
      logBatch(job, 'Search cancelled.', 'warn');
      job.status = 'cancelled';
      return;
    }

    await scheduler.waitIfNeeded();

    const title = job.titles[ti];
    const result = job.results[ti];
    job.currentIndex = ti;

    logBatch(job, `Searching [${ti + 1}/${job.titles.length}]: "${title}"`);
    result.status = 'searching';

    const allItems: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
    const seenUrls = new Set<string>();
    let searchSuccess = false;

    if (deps.isCancelled(job.id)) return;

    try {
      await retry(
        async (attempt: number) => {
          if (deps.isCancelled(job.id)) throw new Error('Cancelled');
          result.retries = attempt;

          const searchPageUrl = provider.buildSearchUrl(title);

          const page = await browser.newPage();
          await applyStealthToPage(page);

          const batchGalleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
          if (batchGalleryProvider.setupBrowserContext) {
            await batchGalleryProvider.setupBrowserContext(page.context());
          }

          await page.goto(searchPageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          await page.waitForSelector(
            'article, .stui-vodlist__item, .vodlist_item, .module-search-item, .module-item, .searchlist_item, .list-item, .video-item, .movie-item, .itg, #gdt',
            { timeout: 5000 }
          ).catch(() => {});

          for (let pageNum = 1; pageNum <= BATCH_MAX_PAGES; pageNum++) {
            if (deps.isCancelled(job.id)) {
              await page.close();
              throw new Error('Cancelled');
            }

            const pageResults = await provider.extractSearchResults(page);
            let newCount = 0;
            for (const item of pageResults) {
              if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                allItems.push(item);
                newCount++;
              }
            }

            if (pageNum >= BATCH_MAX_PAGES || newCount === 0) break;

            const hasNextPage = await goToNextPage(page, pageNum + 1);
            if (!hasNextPage) break;

            await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
          }

          await page.close();
        },
        {
          maxRetries: MAX_RETRIES - 1,
          backoff: 'exponential',
          baseDelay: 2000,
          maxDelay: 16000,
          shouldRetry: () => !deps.isCancelled(job.id),
          onRetry: (attempt, error) => {
            const errMsg = error instanceof Error ? error.message : String(error);
            logBatch(job, `"${title}" ${attempt + 1} : ${errMsg}`, 'warn');
          },
        },
      );
      searchSuccess = true;
    } catch {
      if (deps.isCancelled(job.id)) return;
    }

    if (!searchSuccess) {
      result.status = 'failed';
      result.error = 'Search failed after retries';
      job.totalFailed++;
      job.totalProcessed++;
      logBatch(job, `Search failed: "${title}"`, 'error');
      scheduler.markCompleted();
      continue;
    }

    const scored = allItems
      .map((item) => {
        const cleanedTitle = provider.cleanTitle(item.title || item.url);
        const score = titleSimilarity(title, cleanedTitle);
        return {
          item,
          cleanedTitle,
          score,
        };
      })
      .sort((a, b) => b.score - a.score);

    result.searchResults = scored.map((s) => ({
      pageUrl: s.item.url,
      title: s.cleanedTitle || s.item.title,
      coverUrl: s.item.coverUrl,
      date: s.item.date,
      status: 'pending' as const,
      retries: 0,
    }));

    if (scored.length === 0 || scored[0].score < MATCH_THRESHOLD) {
      result.status = 'not_found';
      result.matchScore = scored.length > 0 ? scored[0].score : 0;
      job.totalNotFound++;
      job.totalProcessed++;
      logBatch(job, `No match for "${title}": score ${result.matchScore?.toFixed(2)}`, 'warn');
      scheduler.markCompleted();
      continue;
    }

    const best = scored[0];
    result.selectedItem = result.searchResults[0];
    result.matchScore = best.score;
    result.status = 'found';
    logBatch(job, `Best match: "${best.cleanedTitle}" (score ${best.score.toFixed(2)})`);

    result.status = 'scraping';
    try {
      const batchGalleryProvider2 = provider as SiteProvider & Partial<GallerySiteProvider>;
      if (typeof batchGalleryProvider2.scrapeGallery === 'function') {
        const galleryResult = await createGalleryTask(best.item.url, batchGalleryProvider2 as SiteProvider & GallerySiteProvider);

        if (galleryResult.duplicate) {
          result.status = 'failed';
          result.error = `Duplicate: ${galleryResult.existingStatus ?? ''}`;
          job.totalFailed++;
          job.totalProcessed++;
          logBatch(job, `Duplicate gallery: ${best.cleanedTitle} (${galleryResult.existingStatus ?? ''})`, 'warn');
          scheduler.markCompleted();
          continue;
        }

        result.taskId = galleryResult.galleryId;
        result.status = 'completed';
        job.totalDownloaded++;
        job.totalProcessed++;
        logBatch(job, `Gallery created: #${galleryResult.seq}: ${best.cleanedTitle}`);
        eventBus.emit('task:created', {
          taskId: galleryResult.galleryId,
          title: best.cleanedTitle,
          source: 'batch',
        });
        scheduler.markCompleted();
        continue;
      }

      const scrapeResult = await deps.scrapeVideoPage(browser, best.item.url, provider);

      if (!scrapeResult.m3u8_url) {
        throw new Error('No M3U8 URL found');
      }

      if (scrapeResult.title && scrapeResult.title.length > 0) {
        result.selectedItem.title = scrapeResult.title;
      }

      const blockCheck = provider.checkContentBlocked(
        scrapeResult.title,
        scrapeResult.categories.join(','),
        scrapeResult.actors[0],
      );
      if (blockCheck.blocked) {
        result.status = 'failed';
        result.error = `Blocked: ${blockCheck.reason}`;
        job.totalFailed++;
        job.totalProcessed++;
        logBatch(job, `Content blocked: ${best.cleanedTitle} (${blockCheck.reason})`, 'warn');
        scheduler.markCompleted();
        continue;
      }

      const taskId = await createTaskFromScrape({
        pageUrl: best.item.url,
        scrapeResult,
        fallbackTitle: title,
        source: 'batch',
        onLog: (msg, level) => logBatch(job, msg, level),
      });

      result.taskId = taskId;
      result.status = 'completed';
      job.totalDownloaded++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.status = 'failed';
      result.error = `Scrape failed: ${errMsg}`;
      job.totalFailed++;
      logBatch(job, `Scrape failed: ${errMsg}`, 'error');
    }

    job.totalProcessed++;
    scheduler.markCompleted();
  }

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  logBatch(
    job,
    `Batch search completed: ${job.totalProcessed} titles processed.`,
  );
}
