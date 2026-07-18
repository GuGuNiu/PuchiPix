import type { Browser } from 'playwright';
import type { SearchJob, SearchLogEntry, SearchItem, BatchSearchJob, ScrapeResult } from '@/types';
import { getSiteRegistry, extractDomainFromUrl } from '@/lib/sites';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { eventBus } from '@/lib/core/infra/event-bus';
import { logT } from '@/lib/i18n/server';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import {
  sleep,
  randomDelay,
  backoffDelay,
  applyStealthToPage,
  PAGE_DELAY_MIN,
  PAGE_DELAY_MAX,
  MAX_RETRIES,
} from '@/lib/core/stealth/anti-crawler';

import {
  MAX_RESULTS_PER_KEYWORD,
  MAX_PAGES_PER_KEYWORD,
} from './utils';
import { goToNextPage } from './pagination';
import { executeBatchSearch, logBatch } from './batch-search';
import type { BatchSearchDeps } from './batch-search';
import {
  scrapeVideo as scrapeVideoOp,
  scrapeAll as scrapeAllOp,
  scrapeVideoPage as scrapeVideoPageOp,
} from './scrape-operations';
import type { ScrapeDeps } from './scrape-operations';

export class SearchEngine {
  private activeJobs: Map<string, SearchJob> = new Map();
  private cancelledJobs: Set<string> = new Set();
  private scrapingItems: Set<string> = new Set();
  private batchJobs: Map<string, BatchSearchJob> = new Map();
  private cancelledBatchJobs: Set<string> = new Set();

  private async getBrowser(): Promise<Browser> {
    return getSharedBrowser();
  }

  private log(job: SearchJob, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const entry: SearchLogEntry = {
      time: new Date().toISOString(),
      message,
      level,
    };
    job.logs.push(entry);
    if (job.logs.length > 300) {
      job.logs = job.logs.slice(-300);
    }
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`[Search ${job.id}] ${prefix} ${message}`);
  }

  private getProvider(siteId?: string): SiteProvider {
    const registry = getSiteRegistry();
    if (siteId) {
      const provider = registry.getProvider(siteId);
      if (provider) return provider;
    }
    return registry.getProvider('kanav') ?? registry.getEnabledProviders()[0];
  }

  private getScrapeDeps(): ScrapeDeps {
    return {
      getBrowser: () => this.getBrowser(),
      getProvider: (siteId) => this.getProvider(siteId),
      log: (job, msg, level) => this.log(job, msg, level),
      isCancelled: (jobId) => this.cancelledJobs.has(jobId),
      scrapingItems: this.scrapingItems,
      scrapeVideoPage: (browser, url, provider) => scrapeVideoPageOp(browser, url, provider),
    };
  }

  async search(rawKeywords: string, siteId?: string): Promise<SearchJob> {
    const keywords = rawKeywords
      .split(/[,，\n\s、|]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (keywords.length === 0) {
      throw new Error('未提供有效关键词');
    }

    const provider = this.getProvider(siteId);

    const job: SearchJob = {
      id: `search_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      rawKeywords,
      keywords,
      siteId: provider.id,
      status: 'running',
      results: keywords.map((kw) => ({
        keyword: kw,
        status: 'pending',
        items: [],
        retries: 0,
      })),
      createdAt: new Date().toISOString(),
      totalFound: 0,
      totalDownloaded: 0,
      totalFailed: 0,
      currentIndex: 0,
      logs: [],
    };

    this.activeJobs.set(job.id, job);
    this.log(job, `开始搜索（网站：${provider.name} ${provider.baseUrl}），共 ${keywords.length} 个关键词`);

    this.executeSearch(job, provider).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.log(job, logT('log.search.terminated', { msg }), 'error');
      job.status = 'failed';
    });

    return job;
  }

  /**
   * 执行搜索，自动翻页处理
   */
  private async executeSearch(job: SearchJob, provider: SiteProvider): Promise<void> {
    const browser = await this.getBrowser();
    eventBus.emit('search:started', { jobId: job.id, keywords: job.keywords });

    for (let ki = 0; ki < job.keywords.length; ki++) {
      if (this.cancelledJobs.has(job.id)) {
        this.log(job, '搜索任务已取消', 'warn');
        job.status = 'cancelled';
        return;
      }

      const keyword = job.keywords[ki];
      const kwResult = job.results[ki];
      job.currentIndex = ki;

      this.log(job, `开始关键词 [${ki + 1}/${job.keywords.length}]: "${keyword}"`);

      const allItems: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
      const seenUrls = new Set<string>();

      const isUrlMode = /^https?:\/\//i.test(keyword);
      const galleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
      let skipSearch = false;

      if (isUrlMode && galleryProvider.isListingPage) {
        if (galleryProvider.isListingPage(keyword)) {
          if (galleryProvider.scrapeListingPage) {
            this.log(job, `检测到列表页 URL，直接抓取: ${keyword}`);
            try {
              const listPage = await browser.newPage();
              await applyStealthToPage(listPage);
              const listingResults = await galleryProvider.scrapeListingPage(listPage, keyword, MAX_PAGES_PER_KEYWORD);
              await listPage.close();

              for (const r of listingResults) {
                if (!seenUrls.has(r.url)) {
                  seenUrls.add(r.url);
                  allItems.push(r);
                }
              }
              this.log(job, `列表页抓取完成，获 ${allItems.length} 条结果`);
              skipSearch = true;
            } catch (err) {
              this.log(job, `列表页抓取失败: ${err instanceof Error ? err.message : String(err)}`, 'warn');
            }
          }
        } else {
          this.log(job, `检测到详情页 URL，抓取信息: ${keyword}`);
          try {
            const metaPage = await browser.newPage();
            await applyStealthToPage(metaPage);
            await metaPage.goto(keyword, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await metaPage.waitForSelector('article', { timeout: 5000 }).catch(() => {});

            let articleTitle = keyword;
            let articleCover: string | undefined;

            if (galleryProvider.extractExtendedMetadata) {
              try {
                const metadata = await galleryProvider.extractExtendedMetadata(metaPage);
                if (metadata.title) articleTitle = metadata.title;
              } catch {}
            }

            const rawCover = await metaPage.evaluate(() => {
              const article = document.querySelector('article');
              if (article) {
                const img = article.querySelector('img');
                if (img) {
                  const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
                  if (src && !src.includes('/static/zde/timg.gif') && !src.includes('/static/images/Loading') && !src.startsWith('data:')) {
                    return src;
                  }
                }
              }
              return '';
            });
            if (rawCover) articleCover = rawCover;

            await metaPage.close();

            const normalizedUrl = galleryProvider.normalizeUrl
              ? galleryProvider.normalizeUrl(keyword)
              : keyword;
            allItems.push({ url: normalizedUrl, title: articleTitle, coverUrl: articleCover });
            this.log(job, `详情页信息抓取成功: "${articleTitle}"`);
            skipSearch = true;
          } catch (err) {
            this.log(job, `详情页 URL 抓取失败: ${err instanceof Error ? err.message : String(err)}`, 'warn');
            const normalizedUrl = galleryProvider.normalizeUrl
              ? galleryProvider.normalizeUrl(keyword)
              : keyword;
            allItems.push({ url: normalizedUrl, title: keyword });
            skipSearch = true;
          }
        }
      }

      const searchUrls = isUrlMode
        ? [keyword]
        : (provider.getAdaptiveSearchUrls
          ? provider.getAdaptiveSearchUrls(keyword)
          : [provider.buildSearchUrl(keyword)]);
      let searchUrlIdx = 0;

      const maxRetries = skipSearch ? 0 : MAX_RETRIES;
      for (let retry = 0; retry < maxRetries; retry++) {
        if (this.cancelledJobs.has(job.id)) return;

        try {
          kwResult.status = 'searching';
          kwResult.retries = retry;

          const searchPageUrl = searchUrls[Math.min(searchUrlIdx, searchUrls.length - 1)];
          this.log(job, `搜索 URL: ${searchPageUrl}`);

          const page = await browser.newPage();
          await applyStealthToPage(page);

          if (galleryProvider.setupBrowserContext) {
            await galleryProvider.setupBrowserContext(page.context());
          }

          const response = await page.goto(searchPageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          const httpStatus = response?.status();
          if (httpStatus === 403 || httpStatus === 429) {
            const domain = extractDomainFromUrl(searchPageUrl);
            this.log(job, `访问 ${searchPageUrl} 返回 ${httpStatus}，尝试切换备用域名`, 'warn');
            if (domain && provider.markDomainRateLimited) {
              provider.markDomainRateLimited(domain);
            }
            await page.close();
            searchUrlIdx++;
            if (searchUrlIdx < searchUrls.length) {
              const delay = backoffDelay(retry);
              this.log(job, `等待 ${(delay / 1000).toFixed(0)}s 后切换备用域名...`);
              await sleep(delay);
              retry--;
              continue;
            }
            throw new Error(`所有域名均返回 ${httpStatus}，搜索失败`);
          }

          await page.waitForSelector(
            'article, .stui-vodlist__item, .vodlist_item, .module-search-item, .module-item, .searchlist_item, .list-item, .video-item, .movie-item, .itg, #gdt',
            { timeout: 5000 }
          ).catch(() => {});

          for (let pageNum = 1; pageNum <= MAX_PAGES_PER_KEYWORD; pageNum++) {
            if (this.cancelledJobs.has(job.id)) {
              await page.close();
              return;
            }

            this.log(job, `开始抓取第 ${pageNum} 页结果`);

            const pageResults = await provider.extractSearchResults(page);

            let newCount = 0;
            for (const item of pageResults) {
              if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                allItems.push(item);
                newCount++;
              }
            }

            this.log(job, `第 ${pageNum} 页新增 ${newCount} 条结果（累计 ${allItems.length}）`);

            if (pageNum >= MAX_PAGES_PER_KEYWORD || newCount === 0) break;

            const hasNextPage = await goToNextPage(page, pageNum + 1);
            if (!hasNextPage) {
              this.log(job, '没有下一页');
              break;
            }

            const delay = randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX);
            this.log(job, `翻页间隔 ${(delay / 1000).toFixed(1)}s`);
            await sleep(delay);
          }

          const successDomain = extractDomainFromUrl(searchPageUrl);
          if (successDomain && provider.markDomainHealthy) {
            provider.markDomainHealthy(successDomain);
          }

          await page.close();
          break;

        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.log(job, `搜索关键词 "${keyword}" 失败（第 ${retry + 1} 次）: ${errMsg}`, 'warn');

          if (retry < MAX_RETRIES - 1) {
            const delay = backoffDelay(retry);
            this.log(job, `等待 ${(delay / 1000).toFixed(0)}s 后重试...`);
            await sleep(delay);
          } else {
            kwResult.status = 'failed';
            kwResult.error = `搜索失败: ${errMsg}`;
            this.log(job, `关键词 "${keyword}" 搜索全部失败`, 'error');
            continue;
          }
        }
      }

      let filteredItems = allItems;
      const beforeFilter = filteredItems.length;
      filteredItems = filteredItems.filter((item) => {
        const check = provider.checkContentBlocked(item.title, item.title);
        return !check.blocked;
      });
      const blockedCount = beforeFilter - filteredItems.length;
      if (blockedCount > 0) {
        this.log(job, `内容过滤已拦截 ${blockedCount} 个视频`);
      }

      filteredItems = filteredItems.slice(0, MAX_RESULTS_PER_KEYWORD);

      kwResult.items = filteredItems.map((v) => ({
        pageUrl: v.url,
        title: v.title || v.url,
        coverUrl: v.coverUrl,
        date: v.date,
        status: 'pending' as const,
        retries: 0,
      }));
      job.totalFound += filteredItems.length;

      kwResult.status = 'completed';
      this.log(job, `关键词 "${keyword}" 搜索完成，找到 ${filteredItems.length} 个视频`);
    }

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    eventBus.emit('search:completed', { jobId: job.id, totalFound: job.totalFound, totalDownloaded: job.totalDownloaded });
    this.log(job, `🎉 搜索任务全部完成！找到 ${job.totalFound} 个视频`);
  }

  async scrapeVideo(jobId: string, itemUrl: string): Promise<SearchItem | null> {
    const job = this.activeJobs.get(jobId);
    if (!job) return null;
    return scrapeVideoOp(jobId, itemUrl, job, this.getScrapeDeps());
  }

  async scrapeAll(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job) return;
    await scrapeAllOp(jobId, job, this.getScrapeDeps());
  }

  getJob(jobId: string): SearchJob | undefined {
    return this.activeJobs.get(jobId);
  }

  getAllJobs(): SearchJob[] {
    return Array.from(this.activeJobs.values());
  }

  cancelJob(jobId: string): boolean {
    if (this.activeJobs.has(jobId)) {
      this.cancelledJobs.add(jobId);
      return true;
    }
    return false;
  }

  /**
   * 启动批量标题搜索
   */
  async batchSearch(rawTitles: string, siteId?: string): Promise<BatchSearchJob> {
    const titles = rawTitles
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (titles.length === 0) {
      throw new Error('未提供有效标题');
    }

    const provider = this.getProvider(siteId);

    const job: BatchSearchJob = {
      id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      rawTitles,
      titles,
      siteId: provider.id,
      status: 'running',
      results: titles.map((t) => ({
        title: t,
        status: 'pending' as const,
        searchResults: [],
        retries: 0,
      })),
      createdAt: new Date().toISOString(),
      totalProcessed: 0,
      totalDownloaded: 0,
      totalNotFound: 0,
      totalFailed: 0,
      currentIndex: 0,
      logs: [],
    };

    this.batchJobs.set(job.id, job);
    logBatch(job, `开始批量搜索（网站：${provider.name}），共 ${titles.length} 个标题`);

    const deps: BatchSearchDeps = {
      getBrowser: () => this.getBrowser(),
      isCancelled: (jobId) => this.cancelledBatchJobs.has(jobId),
      scrapeVideoPage: (browser, url, prov) => scrapeVideoPageOp(browser, url, prov),
    };

    executeBatchSearch(job, provider, deps).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logBatch(job, logT('log.search.batchTerminated', { msg }), 'error');
      job.status = 'failed';
    });

    return job;
  }

  getBatchJob(jobId: string): BatchSearchJob | undefined {
    return this.batchJobs.get(jobId);
  }

  getAllBatchJobs(): BatchSearchJob[] {
    return Array.from(this.batchJobs.values());
  }

  cancelBatchJob(jobId: string): boolean {
    if (this.batchJobs.has(jobId)) {
      this.cancelledBatchJobs.add(jobId);
      return true;
    }
    return false;
  }

  async close(): Promise<void> {
    // 浏览器由 browser-pool 统一管理，此处不关闭
  }
}

const GLOBAL_KEY = '__searchEngineInstance__';

export function getSearchEngine(): SearchEngine {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new SearchEngine();
  }
  return g[GLOBAL_KEY] as SearchEngine;
}
