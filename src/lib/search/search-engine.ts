/**
 * search-engine.ts — 搜索引擎
 *
 * @date 2026-07-09
 * @lastModified 2026-07-09
 */

import { chromium, Browser } from 'playwright';
import type { SearchJob, SearchLogEntry, SearchItem, BatchSearchJob, ScrapeResult } from '@/types';
import prisma from '@/lib/db/prisma';
import { getDownloadManager, mapTask } from '@/lib/api-helpers';
import { getSiteRegistry } from '@/lib/sites';
import type { SiteProvider } from '@/lib/sites';
import { KanavProvider } from '@/lib/sites';
import { AimeiziziProvider } from '@/lib/sites';
import { ttlLock } from '@/lib/core/ttl-lock';
import { eventBus } from '@/lib/core/event-bus';
import {
  sleep,
  randomDelay,
  backoffDelay,
  gaussianDelay,
  applyStealthToPage,
  PAGE_DELAY_MIN,
  PAGE_DELAY_MAX,
  BATCH_DELAY_MIN,
  BATCH_DELAY_MAX,
  MAX_RETRIES,
} from '@/lib/core/anti-crawler';
import { BatchScheduler } from '@/lib/core/batch-scheduler';

const MAX_RESULTS_PER_KEYWORD = 50;
/** 每个关键词最大翻页数 */
const MAX_PAGES_PER_KEYWORD = 3;

/** 批量搜索：每个标题最大翻页数（减少以提升速度） */
const BATCH_MAX_PAGES = 2;
/** 批量搜索：模糊匹配阈值，低于此分数视为未找到 */
const MATCH_THRESHOLD = 0.6;

/**
 * 标题归一化：去除空格、标点、特殊字符，转小写
 *
 * @date 2026-07-09
 */
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\-_—–·:：.,，。！!？?·\[\]（）()【】"'<>《》/|]+/g, '')
    .trim();
}

/**
 * 计算两个标题的相似度分数（0-1）
 *
 * 策略：
 * 1. 归一化后完全相同 → 1.0
 * 2. 一方包含另一方 → 0.85 × (较短长度/较长长度)
 * 3. 否则使用字符重叠率
 *
 * @date 2026-07-09
 */
function titleSimilarity(input: string, candidate: string): number {
  const a = normalizeTitle(input);
  const b = normalizeTitle(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1.0;

  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return 0.85 * (shorter / longer);
  }

  const setB = new Set(b);
  let common = 0;
  for (const ch of a) {
    if (setB.has(ch)) common++;
  }
  return common / Math.max(a.length, b.length);
}

export class SearchEngine {
  private browser: Browser | null = null;
  private activeJobs: Map<string, SearchJob> = new Map();
  private cancelledJobs: Set<string> = new Set();
  private scrapingItems: Set<string> = new Set();
  private batchJobs: Map<string, BatchSearchJob> = new Map();
  private cancelledBatchJobs: Set<string> = new Set();

  private async getBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await chromium.launch({
        headless: true,
        channel: 'chrome',
      });
    }
    return this.browser;
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
    if (siteId) {
      const registry = getSiteRegistry();
      const provider = registry.getProvider(siteId);
      if (provider) return provider;
    }
    return new KanavProvider();
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
    this.log(job, `搜索任务启动，站点: ${provider.name} (${provider.baseUrl})，共 ${keywords.length} 个关键词`);

    this.executeSearch(job, provider).catch((err) => {
      this.log(job, `搜索任务异常终止: ${err.message}`, 'error');
      job.status = 'failed';
    });

    return job;
  }

  /**
   * 执行搜索（含自动翻页）。
   *
   * 搜索流程：
   * 1. 打开搜索结果第一页
   * 2. 提取视频列表
   * 3. 等待 2~3 秒（防爬间隔）
   * 4. 如果存在下一页且未达上限，点击翻页
   * 5. 重复 2-4 直到无下一页或达到最大页数
   * 6. 应用 kanav 屏蔽器过滤分类
   * 7. 处理下一个关键词（无关键词间延迟）
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

      this.log(job, `搜索关键词 [${ki + 1}/${job.keywords.length}]: "${keyword}"`);

      const allItems: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
      const seenUrls = new Set<string>();

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        if (this.cancelledJobs.has(job.id)) return;

        try {
          kwResult.status = 'searching';
          kwResult.retries = retry;

          const searchPageUrl = provider.buildSearchUrl(keyword);
          this.log(job, `搜索 URL: ${searchPageUrl}`);

          const page = await browser.newPage();
          await applyStealthToPage(page);

          await page.goto(searchPageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          // 等待搜索结果渲染完成（最多等 2s，提前出现即跳过）
          await page.waitForSelector(
            '.stui-vodlist__item, .vodlist_item, .module-search-item, .module-item, .searchlist_item, .list-item, .video-item, .movie-item',
            { timeout: 2000 }
          ).catch(() => {});

          // 翻页循环
          for (let pageNum = 1; pageNum <= MAX_PAGES_PER_KEYWORD; pageNum++) {
            if (this.cancelledJobs.has(job.id)) {
              await page.close();
              return;
            }

            this.log(job, `正在提取第 ${pageNum} 页结果`);

            // 提取当前页结果
            const pageResults = await provider.extractSearchResults(page);

            let newCount = 0;
            for (const item of pageResults) {
              if (!seenUrls.has(item.url)) {
                seenUrls.add(item.url);
                allItems.push(item);
                newCount++;
              }
            }

            this.log(job, `第 ${pageNum} 页新增 ${newCount} 个结果（累计 ${allItems.length}）`);

            // 检查是否需要翻页
            if (pageNum >= MAX_PAGES_PER_KEYWORD || newCount === 0) {
              break;
            }

            // 尝试翻页
            const hasNextPage = await this.goToNextPage(page, pageNum + 1);
            if (!hasNextPage) {
              this.log(job, '已无下一页');
              break;
            }

            // 翻页间隔（防爬）
            const delay = randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX);
            this.log(job, `翻页间隔 ${(delay / 1000).toFixed(1)}s`);
            await sleep(delay);
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
            this.log(job, `关键词 "${keyword}" 搜索彻底失败`, 'error');
            continue;
          }
        }
      }

      // 应用 kanav 屏蔽器过滤
      let filteredItems = allItems;
      if (provider instanceof KanavProvider) {
        const beforeFilter = filteredItems.length;
        filteredItems = filteredItems.filter((item) => {
          // 基于标题关键词的简单屏蔽
          const titleLower = item.title.toLowerCase();
          for (const keyword of provider.blockedCategories) {
            if (titleLower.includes(keyword.toLowerCase())) {
              return false;
            }
          }
          return true;
        });
        const blockedCount = beforeFilter - filteredItems.length;
        if (blockedCount > 0) {
          this.log(job, `KanAV 屏蔽器过滤了 ${blockedCount} 个视频（同人/动漫等分类）`);
        }
      }

      // 限制结果数量
      filteredItems = filteredItems.slice(0, MAX_RESULTS_PER_KEYWORD);

      // 填充结果
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
    this.log(job, `🎉 搜索任务全部完成！共找到 ${job.totalFound} 个视频`);
  }

  /**
   * 翻到下一页。
   *
   * 先快速检查页面上是否存在分页元素，不存在则直接返回 false。
   * 存在时尝试点击下一页链接，仅在选择器全部失败时才回退到 URL 翻页。
   *
   * @date 2026-07-10
   */
  private async goToNextPage(page: import('playwright').Page, pageNum: number): Promise<boolean> {
    // 快速检查页面上是否存在分页容器（200ms 超时）
    const hasPagination = await page.locator(
      '.pagination, .page, .pagenavi, .mac_pages, .pages, .page-box'
    ).first().isVisible({ timeout: 200 }).catch(() => false);

    if (!hasPagination) return false;

    const nextSelectors = [
      `.pagination a:has-text("${pageNum}")`,
      `.page a:has-text("${pageNum}")`,
      `.pagenavi a:has-text("${pageNum}")`,
      `a[onclick*="page"][onclick*="${pageNum}"]`,
      `.mac_pages a:has-text("${pageNum}")`,
      `a[href*="page=${pageNum}"]`,
      `.pagination a.next`,
      `.page a.next`,
      `a:has-text("下一页")`,
      `.mac_pages a.next`,
    ];

    for (const sel of nextSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
          await el.click({ timeout: 1000 }).catch(() => {});
          await page.waitForTimeout(800);
          return true;
        }
      } catch {
        // 继续尝试下一个选择器
      }
    }

    // 分页容器存在但选择器未匹配，尝试 URL 翻页
    try {
      const currentUrl = page.url();
      const nextUrl = currentUrl.includes('page=')
        ? currentUrl.replace(/page=\d+/, `page=${pageNum}`)
        : `${currentUrl}${currentUrl.includes('?') ? '&' : '?'}page=${pageNum}`;
      await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await page.waitForTimeout(800);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 爬取单个视频页面。
   */
  async scrapeVideo(jobId: string, itemUrl: string): Promise<SearchItem | null> {
    const job = this.activeJobs.get(jobId);
    if (!job) return null;

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
    if (this.scrapingItems.has(itemKey)) {
      this.log(job, `视频已在爬取中: ${targetItem.title}`, 'warn');
      return targetItem;
    }

    // TTL 锁防止跨 job 重复爬取同一 URL
    const lockKey = `scrape:${itemUrl}`;
    const lockHandle = await ttlLock.acquire(lockKey, { ttl: 60000 });
    if (!lockHandle) {
      this.log(job, `视频正在被其他任务爬取: ${targetItem.title}`, 'warn');
      return targetItem;
    }

    this.scrapingItems.add(itemKey);

    const provider = this.getProvider(job.siteId);
    const browser = await this.getBrowser();

    targetItem.status = 'scraping';
    this.log(job, `开始爬取视频: ${targetItem.title || targetItem.pageUrl}`);

    try {
      const scrapeResult = await this.scrapeVideoPage(browser, targetItem.pageUrl, provider);
      eventBus.emit('scrape:started', { pageUrl: targetItem.pageUrl });

      if (scrapeResult.m3u8_url) {
        targetItem.m3u8Url = scrapeResult.m3u8_url;
        targetItem.status = 'downloaded';

        if (scrapeResult.title && scrapeResult.title.length > 0) {
          targetItem.title = scrapeResult.title;
        }

        // 站点屏蔽检查（kanav 和 aimeizizi 各自独立）
        if (provider instanceof KanavProvider) {
          const blockCheck = provider.checkBlocked(
            scrapeResult.actors.join(','),
            scrapeResult.tags,
          );
          if (blockCheck.blocked) {
            targetItem.status = 'failed';
            targetItem.error = `屏蔽: ${blockCheck.reason}`;
            this.log(job, `屏蔽视频: ${targetItem.title} — ${blockCheck.reason}`, 'warn');
            job.totalFailed += 1;
            return { ...targetItem };
          }
        } else if (provider instanceof AimeiziziProvider) {
          const blockCheck = provider.checkBlocked(
            scrapeResult.title,
            scrapeResult.categories.join(','),
            scrapeResult.actors[0],
          );
          if (blockCheck.blocked) {
            targetItem.status = 'failed';
            targetItem.error = `屏蔽: ${blockCheck.reason}`;
            this.log(job, `屏蔽视频: ${targetItem.title} — ${blockCheck.reason}`, 'warn');
            job.totalFailed += 1;
            return { ...targetItem };
          }
        }

        const task = await prisma.downloadTask.create({
          data: {
            url: targetItem.pageUrl,
            m3u8Url: scrapeResult.m3u8_url,
            format: 'mp4',
            status: 'pending',
            videoInfo: {
              create: {
                title: scrapeResult.title || targetItem.title || '',
                sourceUrl: targetItem.pageUrl,
                tags: JSON.stringify(scrapeResult.tags || []),
                actors: JSON.stringify(scrapeResult.actors || []),
                categories: JSON.stringify(scrapeResult.categories || []),
                director: scrapeResult.director || '',
              },
            },
          },
          include: { videoInfo: true },
        });

        targetItem.taskId = task.id;
        this.log(job, `✅ 创建下载任务 #${task.id}: ${scrapeResult.title || targetItem.title}`);

        eventBus.emit('task:created', {
          taskId: task.id,
          title: scrapeResult.title || targetItem.title,
          source: 'search',
        });

        const dm = getDownloadManager();
        const dlTask = mapTask(task);
        dm.startDownload(dlTask).catch((err) => {
          this.log(job, `下载任务 #${task.id} 启动失败: ${err.message}`, 'error');
        });

        job.totalDownloaded += 1;
      } else {
        throw new Error('未找到 M3U8 URL');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      targetItem.status = 'failed';
      targetItem.error = `爬取失败: ${errMsg}`;
      this.log(job, `❌ 视频爬取失败: ${targetItem.title || targetItem.pageUrl} — ${errMsg}`, 'error');
      eventBus.emit('scrape:failed', { pageUrl: targetItem.pageUrl, error: errMsg });
      job.totalFailed += 1;
    } finally {
      this.scrapingItems.delete(itemKey);
      if (lockHandle) ttlLock.releaseHandle(lockHandle);
    }

    return { ...targetItem };
  }

  /**
   * 批量爬取所有 pending 视频。
   */
  async scrapeAll(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    this.log(job, `开始批量爬取，共 ${job.totalFound} 个视频`);
    const browser = await this.getBrowser();
    const provider = this.getProvider(job.siteId);

    for (const kwResult of job.results) {
      for (const item of kwResult.items) {
        if (this.cancelledJobs.has(jobId)) return;
        if (item.status !== 'pending') continue;

        const itemKey = `${jobId}:${item.pageUrl}`;
        if (this.scrapingItems.has(itemKey)) continue;

        const lockKey = `scrape:${item.pageUrl}`;
        const lockHandle = await ttlLock.acquire(lockKey, { ttl: 60000 });
        if (!lockHandle) {
          this.log(job, `视频正在被其他任务爬取: ${item.title}`, 'warn');
          continue;
        }

        this.scrapingItems.add(itemKey);

        item.status = 'scraping';
        this.log(job, `爬取视频: ${item.title || item.pageUrl}`);
        eventBus.emit('scrape:started', { pageUrl: item.pageUrl });

        try {
          const scrapeResult = await this.scrapeVideoPage(browser, item.pageUrl, provider);

          if (scrapeResult.m3u8_url) {
            item.m3u8Url = scrapeResult.m3u8_url;
            item.status = 'downloaded';

            if (scrapeResult.title && scrapeResult.title.length > 0) {
              item.title = scrapeResult.title;
            }

            // 站点屏蔽检查（kanav 和 aimeizizi 各自独立）
            if (provider instanceof KanavProvider) {
              const blockCheck = provider.checkBlocked(
                scrapeResult.actors.join(','),
                scrapeResult.tags,
              );
              if (blockCheck.blocked) {
                item.status = 'failed';
                item.error = `屏蔽: ${blockCheck.reason}`;
                job.totalFailed += 1;
                this.log(job, `屏蔽视频: ${item.title} — ${blockCheck.reason}`, 'warn');
                eventBus.emit('scrape:failed', { pageUrl: item.pageUrl, error: blockCheck.reason || '未知原因' });
                continue;
              }
            } else if (provider instanceof AimeiziziProvider) {
              const blockCheck = provider.checkBlocked(
                scrapeResult.title,
                scrapeResult.categories.join(','),
                scrapeResult.actors[0],
              );
              if (blockCheck.blocked) {
                item.status = 'failed';
                item.error = `屏蔽: ${blockCheck.reason}`;
                job.totalFailed += 1;
                this.log(job, `屏蔽视频: ${item.title} — ${blockCheck.reason}`, 'warn');
                eventBus.emit('scrape:failed', { pageUrl: item.pageUrl, error: blockCheck.reason || '未知原因' });
                continue;
              }
            }

            const task = await prisma.downloadTask.create({
              data: {
                url: item.pageUrl,
                m3u8Url: scrapeResult.m3u8_url,
                format: 'mp4',
                status: 'pending',
                videoInfo: {
                  create: {
                    title: scrapeResult.title || item.title || '',
                    sourceUrl: item.pageUrl,
                    tags: JSON.stringify(scrapeResult.tags || []),
                    actors: JSON.stringify(scrapeResult.actors || []),
                    categories: JSON.stringify(scrapeResult.categories || []),
                    director: scrapeResult.director || '',
                  },
                },
              },
              include: { videoInfo: true },
            });

            item.taskId = task.id;
            this.log(job, `✅ 创建下载任务 #${task.id}: ${scrapeResult.title || item.title}`);

            eventBus.emit('scrape:completed', {
              pageUrl: item.pageUrl,
              m3u8Url: scrapeResult.m3u8_url,
              title: scrapeResult.title || item.title,
            });

            eventBus.emit('task:created', {
              taskId: task.id,
              title: scrapeResult.title || item.title,
              source: 'search',
            });

            const dm = getDownloadManager();
            const dlTask = mapTask(task);
            dm.startDownload(dlTask).catch((err) => {
              this.log(job, `下载任务 #${task.id} 启动失败: ${err.message}`, 'error');
            });

            job.totalDownloaded += 1;
          } else {
            throw new Error('未找到 M3U8 URL');
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          item.status = 'failed';
          item.error = `爬取失败: ${errMsg}`;
          this.log(job, `❌ 爬取失败: ${item.title || item.pageUrl} — ${errMsg}`, 'error');
          eventBus.emit('scrape:failed', { pageUrl: item.pageUrl, error: errMsg });
          job.totalFailed += 1;
        } finally {
          this.scrapingItems.delete(itemKey);
          if (lockHandle) ttlLock.releaseHandle(lockHandle);
        }

        await sleep(gaussianDelay((PAGE_DELAY_MIN + PAGE_DELAY_MAX) / 2, 200));
      }
    }

    this.log(job, `🎉 批量爬取完成！成功 ${job.totalDownloaded}，失败 ${job.totalFailed}`);
  }

  private async scrapeVideoPage(
    browser: Browser,
    pageUrl: string,
    provider: SiteProvider
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

  // ============================================================
  // 批量搜索（按标题模糊搜索 → 自动下载）
  // ============================================================

  private logBatch(job: BatchSearchJob, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
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
   * 启动批量搜索任务
   *
   * 流程：对每个标题执行 搜索 → 模糊匹配 → 爬取 → 创建下载任务
   *
   * @param rawTitles - 用户输入的原始文本（每行一个标题）
   * @param siteId - 站点 ID，默认 kanav
   * @returns BatchSearchJob
   * @date 2026-07-09
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
    this.logBatch(job, `批量搜索任务启动，站点: ${provider.name}，共 ${titles.length} 个标题`);

    this.executeBatchSearch(job, provider).catch((err) => {
      this.logBatch(job, `批量搜索任务异常终止: ${err.message}`, 'error');
      job.status = 'failed';
    });

    return job;
  }

  /**
   * 执行批量搜索
   *
   * 对每个标题：
   * 1. 以标题为关键词搜索（最多翻 2 页）
   * 2. 用 provider.cleanTitle 清洗结果标题
   * 3. 计算相似度，选取最佳匹配
   * 4. 分数 ≥ 阈值 → 爬取视频页 → 创建下载任务
   * 5. 分数 < 阈值 → 标记 not_found
   * 6. 智能调度：短周期休息 10-30s，长周期休息 20-40min
   *
   * @date 2026-07-09
   * @lastModified 2026-07-11
   */
  private async executeBatchSearch(job: BatchSearchJob, provider: SiteProvider): Promise<void> {
    const browser = await this.getBrowser();

    const scheduler = new BatchScheduler({
      onLog: (msg) => this.logBatch(job, msg),
    });

    for (let ti = 0; ti < job.titles.length; ti++) {
      if (this.cancelledBatchJobs.has(job.id)) {
        this.logBatch(job, '批量搜索任务已取消', 'warn');
        job.status = 'cancelled';
        return;
      }

      // 智能调度：检查是否需要休息
      await scheduler.waitIfNeeded();

      const title = job.titles[ti];
      const result = job.results[ti];
      job.currentIndex = ti;

      this.logBatch(job, `处理标题 [${ti + 1}/${job.titles.length}]: "${title}"`);
      result.status = 'searching';

      // ---- 搜索阶段 ----
      const allItems: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
      const seenUrls = new Set<string>();
      let searchSuccess = false;

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        if (this.cancelledBatchJobs.has(job.id)) return;

        try {
          result.retries = retry;
          const searchPageUrl = provider.buildSearchUrl(title);

          const page = await browser.newPage();
          await applyStealthToPage(page);

          await page.goto(searchPageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          // 等待搜索结果渲染完成（最多等 2s，提前出现即跳过）
          await page.waitForSelector(
            '.stui-vodlist__item, .vodlist_item, .module-search-item, .module-item, .searchlist_item, .list-item, .video-item, .movie-item',
            { timeout: 2000 }
          ).catch(() => {});

          for (let pageNum = 1; pageNum <= BATCH_MAX_PAGES; pageNum++) {
            if (this.cancelledBatchJobs.has(job.id)) {
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

            const hasNextPage = await this.goToNextPage(page, pageNum + 1);
            if (!hasNextPage) break;

            await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
          }

          await page.close();
          searchSuccess = true;
          break;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logBatch(job, `搜索"${title}"失败（第 ${retry + 1} 次）: ${errMsg}`, 'warn');
          if (retry < MAX_RETRIES - 1) {
            await sleep(backoffDelay(retry));
          }
        }
      }

      if (!searchSuccess) {
        result.status = 'failed';
        result.error = '搜索请求失败';
        job.totalFailed++;
        job.totalProcessed++;
        this.logBatch(job, `❌ 标题"${title}"搜索彻底失败`, 'error');
        scheduler.markCompleted();
        continue;
      }

      // ---- 模糊匹配阶段 ----
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
        this.logBatch(job, `⚠️ 标题"${title}"未找到匹配视频（最高分: ${result.matchScore?.toFixed(2)}）`, 'warn');
        scheduler.markCompleted();
        continue;
      }

      const best = scored[0];
      result.selectedItem = result.searchResults[0];
      result.matchScore = best.score;
      result.status = 'found';
      this.logBatch(job, `✓ 匹配成功: "${title}" → "${best.cleanedTitle}"（分数: ${best.score.toFixed(2)}）`);

      // ---- 爬取阶段 ----
      result.status = 'scraping';
      try {
        const scrapeResult = await this.scrapeVideoPage(browser, best.item.url, provider);

        if (!scrapeResult.m3u8_url) {
          throw new Error('未找到 M3U8 URL');
        }

        if (scrapeResult.title && scrapeResult.title.length > 0) {
          result.selectedItem.title = scrapeResult.title;
        }

        // 站点屏蔽检查（kanav 和 aimeizizi 各自独立）
        if (provider instanceof KanavProvider) {
          const blockCheck = provider.checkBlocked(
            scrapeResult.actors.join(','),
            scrapeResult.tags,
          );
          if (blockCheck.blocked) {
            result.status = 'failed';
            result.error = `屏蔽: ${blockCheck.reason}`;
            job.totalFailed++;
            job.totalProcessed++;
            this.logBatch(job, `⚠️ 视频被屏蔽: ${best.cleanedTitle} — ${blockCheck.reason}`, 'warn');
            scheduler.markCompleted();
            continue;
          }
        } else if (provider instanceof AimeiziziProvider) {
          const blockCheck = provider.checkBlocked(
            scrapeResult.title,
            scrapeResult.categories.join(','),
            scrapeResult.actors[0],
          );
          if (blockCheck.blocked) {
            result.status = 'failed';
            result.error = `屏蔽: ${blockCheck.reason}`;
            job.totalFailed++;
            job.totalProcessed++;
            this.logBatch(job, `⚠️ 视频被屏蔽: ${best.cleanedTitle} — ${blockCheck.reason}`, 'warn');
            scheduler.markCompleted();
            continue;
          }
        }

        const task = await prisma.downloadTask.create({
          data: {
            url: best.item.url,
            m3u8Url: scrapeResult.m3u8_url,
            format: 'mp4',
            status: 'pending',
            videoInfo: {
              create: {
                title: scrapeResult.title || title,
                sourceUrl: best.item.url,
                tags: JSON.stringify(scrapeResult.tags || []),
                actors: JSON.stringify(scrapeResult.actors || []),
                categories: JSON.stringify(scrapeResult.categories || []),
                director: scrapeResult.director || '',
              },
            },
          },
          include: { videoInfo: true },
        });

        result.taskId = task.id;
        result.status = 'completed';
        job.totalDownloaded++;
        this.logBatch(job, `✅ 创建下载任务 #${task.id}: ${scrapeResult.title || title}`);

        eventBus.emit('task:created', {
          taskId: task.id,
          title: scrapeResult.title || title,
          source: 'batch',
        });

        const dm = getDownloadManager();
        const dlTask = mapTask(task);
        dm.startDownload(dlTask).catch((err) => {
          this.logBatch(job, `下载任务 #${task.id} 启动失败: ${err.message}`, 'error');
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.status = 'failed';
        result.error = `爬取失败: ${errMsg}`;
        job.totalFailed++;
        this.logBatch(job, `❌ 爬取失败: "${title}" — ${errMsg}`, 'error');
      }

      job.totalProcessed++;
      scheduler.markCompleted();
    }

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    this.logBatch(
      job,
      `🎉 批量搜索完成！已处理 ${job.totalProcessed}，下载 ${job.totalDownloaded}，未找到 ${job.totalNotFound}，失败 ${job.totalFailed}`,
    );
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
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
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
