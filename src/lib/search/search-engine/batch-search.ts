import type { Browser } from 'playwright';
import type { BatchSearchJob, SearchLogEntry, ScrapeResult } from '@/types';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { eventBus } from '@/lib/core/event-bus';
import {
  sleep,
  randomDelay,
  backoffDelay,
  applyStealthToPage,
  PAGE_DELAY_MIN,
  PAGE_DELAY_MAX,
  MAX_RETRIES,
} from '@/lib/core/anti-crawler';
import { BatchScheduler } from '@/lib/core/batch-scheduler';
import { createGalleryTask } from '@/lib/tasks/gallery-handler';

import {
  BATCH_MAX_PAGES,
  MATCH_THRESHOLD,
  titleSimilarity,
} from './utils';
import { goToNextPage } from './pagination';
import { createDownloadTaskFromScrape } from './task-creator';

export interface BatchSearchDeps {
  getBrowser(): Promise<Browser>;
  isCancelled(jobId: string): boolean;
  scrapeVideoPage(browser: Browser, pageUrl: string, provider: SiteProvider): Promise<ScrapeResult>;
}

/**
 * 批量搜索日志记录
 */
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
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`[BatchSearch ${job.id}] ${prefix} ${message}`);
}

/**
 * 执行批量搜索
 *
 * 对每个标题：
 * - 以标题为关键词进行搜索（最多翻 2 页）
 * - 用 provider.cleanTitle 清洗搜索结果
 * - 计算标题相似度，选取最佳匹配
 * - 高于 阈值 → 抓取视频页 → 创建下载任务
 * - 低于 阈值 → 标记 not_found
 * - 限速调度：连续完成任务后休眠 10-30s，高强度任务后休眠 20-40min
 */
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
      logBatch(job, '批量搜索任务已取消', 'warn');
      job.status = 'cancelled';
      return;
    }

    await scheduler.waitIfNeeded();

    const title = job.titles[ti];
    const result = job.results[ti];
    job.currentIndex = ti;

    logBatch(job, `开始处理 [${ti + 1}/${job.titles.length}]: "${title}"`);
    result.status = 'searching';

    // 搜索阶段
    const allItems: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
    const seenUrls = new Set<string>();
    let searchSuccess = false;

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      if (deps.isCancelled(job.id)) return;

      try {
        result.retries = retry;
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
            return;
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
        searchSuccess = true;
        break;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logBatch(job, `搜索"${title}"失败（第 ${retry + 1} 次）: ${errMsg}`, 'warn');
        if (retry < MAX_RETRIES - 1) {
          await sleep(backoffDelay(retry));
        }
      }
    }

    if (!searchSuccess) {
      result.status = 'failed';
      result.error = '搜索全部失败';
      job.totalFailed++;
      job.totalProcessed++;
      logBatch(job, `❌ 标题"${title}"搜索全部失败`, 'error');
      scheduler.markCompleted();
      continue;
    }

    // 模糊匹配阶段
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
      logBatch(job, `🔍 标题"${title}"未找到匹配视频（最高分: ${result.matchScore?.toFixed(2)}）`, 'warn');
      scheduler.markCompleted();
      continue;
    }

    const best = scored[0];
    result.selectedItem = result.searchResults[0];
    result.matchScore = best.score;
    result.status = 'found';
    logBatch(job, `✅ 匹配成功: "${title}" → "${best.cleanedTitle}"（分数: ${best.score.toFixed(2)}）`);

    // 抓取阶段
    result.status = 'scraping';
    try {
      const batchGalleryProvider2 = provider as SiteProvider & Partial<GallerySiteProvider>;
      if (typeof batchGalleryProvider2.scrapeGallery === 'function') {
        const galleryResult = await createGalleryTask(best.item.url, batchGalleryProvider2 as SiteProvider & GallerySiteProvider);

        if (galleryResult.duplicate) {
          result.status = 'failed';
          result.error = `重复: ${galleryResult.existingStatus ?? '已存在'}`;
          job.totalFailed++;
          job.totalProcessed++;
          logBatch(job, `⚠️ 图库已存在: ${best.cleanedTitle} → 状态: ${galleryResult.existingStatus ?? '未知'}`, 'warn');
          scheduler.markCompleted();
          continue;
        }

        result.taskId = galleryResult.galleryId;
        result.status = 'completed';
        job.totalDownloaded++;
        job.totalProcessed++;
        logBatch(job, `✅ 创建图库任务 #${galleryResult.seq}: ${best.cleanedTitle}`);
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
        throw new Error('未找到 M3U8 URL');
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
        result.error = `拦截: ${blockCheck.reason}`;
        job.totalFailed++;
        job.totalProcessed++;
        logBatch(job, `⚠️ 视频内容拦截: ${best.cleanedTitle} → ${blockCheck.reason}`, 'warn');
        scheduler.markCompleted();
        continue;
      }

      const taskId = await createDownloadTaskFromScrape({
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
      result.error = `抓取失败: ${errMsg}`;
      job.totalFailed++;
      logBatch(job, `❌ 抓取失败: "${title}" → ${errMsg}`, 'error');
    }

    job.totalProcessed++;
    scheduler.markCompleted();
  }

  job.status = 'completed';
  job.completedAt = new Date().toISOString();
  logBatch(
    job,
    `🎉 批量搜索完成！已处理 ${job.totalProcessed}，下载 ${job.totalDownloaded}，未找到 ${job.totalNotFound}，失败 ${job.totalFailed}`,
  );
}
