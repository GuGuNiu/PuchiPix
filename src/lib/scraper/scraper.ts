/**
 * scraper.ts — 网页爬虫模块
 *
 * 职责：
 * 1. 使用共享浏览器池打开目标视频页面。
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
 *
 * @date 2026-07-09
 * @lastModified 2026-07-13
 */

import type { ScrapeResult } from '@/types';
import { getSiteRegistry } from '@/lib/sites';
import type { SiteProvider } from '@/lib/sites';
import { KanavProvider } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/browser-pool';
import { createStealthPage } from '@/lib/core/anti-crawler';
import { BaseSiteProvider } from '@/lib/sites/base-provider';

// ============================================================
// Scraper 类
// ============================================================

export class Scraper {
  /**
   * 根据 URL 查找匹配的站点提供者。
   *
   * 如果没有匹配的提供者，返回 KanavProvider 作为默认
   * （其通用选择器覆盖大部分 MacCMS 站点）。
   */
  private getProvider(url: string): SiteProvider {
    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);
    if (provider) {
      return provider;
    }
    return new KanavProvider();
  }

  /**
   * 爬取目标视频页面，提取 M3U8 地址、标题、标签和演员。
   *
   * 使用共享浏览器池和 Stealth 页面创建，避免冷启动延迟。
   *
   * @param targetURL - 目标视频页面 URL
   * @param timeout   - 页面加载超时（毫秒），默认 30 秒
   * @returns ScrapeResult 包含 M3U8 URL、标题、标签、演员
   * @date 2026-07-09
   * @lastModified 2026-07-13
   */
  async scrape(targetURL: string, timeout: number = 30000): Promise<ScrapeResult> {
    const browser = await getSharedBrowser();
    const provider = this.getProvider(targetURL);
    const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

    const capturedM3U8: string[] = [];

    // 导航前设置 M3U8 拦截器，避免错过页面加载时的 M3U8 请求
    if (provider instanceof BaseSiteProvider) {
      provider.setupM3U8Interceptor(page, capturedM3U8);
    }

    try {
      await page.goto(targetURL, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const result = await provider.scrapePage(page, targetURL);

      // 合并导航前拦截器捕获的 M3U8 URL
      if (capturedM3U8.length > 0 && !result.m3u8_url) {
        const providerForSelect = provider instanceof BaseSiteProvider ? provider : new KanavProvider();
        result.m3u8_url = providerForSelect.selectBestM3U8(capturedM3U8);
      }

      await page.close();
      await context.close();
      return result;
    } catch (err) {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      throw err;
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
