/**
 * scraper.ts — 网页爬虫模块
 *
 * 职责：
 * 1. 使用 Playwright（系统 Chrome）打开目标视频页面。
 * 2. 通过 SiteProvider 接口委托站点特定逻辑（标题清洗等）。
 * 3. 拦截网络请求，捕获 M3U8 播放列表 URL。
 * 4. 从 DOM 中提取视频标题、标签和演员信息。
 * 5. 自动点击播放按钮以触发 M3U8 请求。
 *
 * 架构说明：
 * Scraper 类本身不再包含任何站点特有逻辑。
 * 它通过 SiteRegistry 根据 URL 自动匹配站点提供者，
 * 然后调用提供者的通用方法完成爬取。
 *
 * 如果 URL 不匹配任何已注册的站点，使用 KanavProvider 作为默认提供者
 * （其通用选择器覆盖大部分 MacCMS 站点）。
 */

import { chromium, Browser, Page } from 'playwright';
import type { ScrapeResult } from '@/types';
import { getSiteRegistry } from '@/lib/sites';
import type { SiteProvider } from '@/lib/sites';
import { KanavProvider } from '@/lib/sites';

// ============================================================
// Scraper 类
// ============================================================

export class Scraper {
  private browser: Browser | null = null;

  /**
   * 获取或创建浏览器实例。
   * 使用系统已安装的 Chrome（channel: 'chrome'），无需下载 Playwright 自带的 Chromium。
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        channel: 'chrome',
      });
    }
    return this.browser;
  }

  /**
   * 根据 URL 查找匹配的站点提供者。
   *
   * 如果没有匹配的提供者，返回 KanavProvider 作为默认
   * （其通用选择器覆盖大部分 MacCMS 站点）。
   *
   * @param url - 目标 URL
   * @returns 匹配的站点提供者
   */
  private getProvider(url: string): SiteProvider {
    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);
    if (provider) {
      return provider;
    }
    // 默认使用 KanavProvider（通用 MacCMS 选择器）
    return new KanavProvider();
  }

  /**
   * 爬取目标视频页面，提取 M3U8 地址、标题、标签和演员。
   *
   * 流程：
   * 1. 根据 URL 匹配站点提供者。
   * 2. 打开页面并设置 M3U8 请求拦截器。
   * 3. 调用提供者的 scrapePage 完成完整爬取。
   *
   * @param targetURL - 目标视频页面 URL
   * @param timeout   - 页面加载超时（毫秒），默认 30 秒
   * @returns ScrapeResult 包含 M3U8 URL、标题、标签、演员
   */
  async scrape(targetURL: string, timeout: number = 30000): Promise<ScrapeResult> {
    const browser = await this.getBrowser();
    const page: Page = await browser.newPage();

    // 根据 URL 查找站点提供者
    const provider = this.getProvider(targetURL);

    try {
      // 导航到目标页面
      await page.goto(targetURL, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      // 调用提供者的通用爬取逻辑
      const result = await provider.scrapePage(page, targetURL);

      await page.close();
      return result;
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
  }

  /**
   * 关闭浏览器实例。
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// ============================================================
// 单例管理
// ============================================================

const SCRAPER_KEY = '__scraperInstance__';

export function getScraper(): Scraper {
  const g = globalThis as Record<string, unknown>;
  if (!g[SCRAPER_KEY]) {
    g[SCRAPER_KEY] = new Scraper();
  }
  return g[SCRAPER_KEY] as Scraper;
}
