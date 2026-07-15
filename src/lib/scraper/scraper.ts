import type { ScrapeResult } from '@/types';
import { getSiteRegistry } from '@/lib/sites';
import type { SiteProvider } from '@/lib/sites';
import { UniversalProvider } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/browser-pool';
import { createStealthPage } from '@/lib/core/anti-crawler';
import type { BaseSiteProvider } from '@/lib/sites/base-provider';

export class Scraper {
  /**
   * 根据 URL 查找匹配的站点提供者。
   *
   * 路由优先级：
   * SiteRegistry 中已注册的站点（Kanav、爱妹子等本地适配模块）
   * UniversalProvider（通用下载器，作为兜底）
   *
   * UniversalProvider 不通过 matchesUrl 匹配，
   * 仅在没有其他 Provider 匹配时作为 fallback 使用。
   */
  private getProvider(url: string): SiteProvider {
    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);
    if (provider) {
      return provider;
    }
    // 无匹配的本地适配模块，切换至通用下载器
    return new UniversalProvider();
  }

  /**
   * 爬取目标视频页面，提取 M3U8 地址、标题、标签和演员。
   *
   * 使用共享浏览器池和 Stealth 页面创建，避免冷启动延迟。
   *
   * @param targetURL - 目标视频页面 URL
   * @param timeout   - 页面加载超时（毫秒），默认 30 秒
   * @returns ScrapeResult 包含 M3U8 URL、标题、标签、演员
   */
  async scrape(targetURL: string, timeout: number = 30000): Promise<ScrapeResult> {
    const browser = await getSharedBrowser();
    const provider = this.getProvider(targetURL);
    const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

    const capturedM3U8: string[] = [];

    // 导航前设置 M3U8 拦截器，避免错过页面加载时的 M3U8 请求
    // 使用鸭子类型检查：所有 BaseSiteProvider 子类都有此方法
    if ('setupM3U8Interceptor' in provider) {
      (provider as unknown as BaseSiteProvider).setupM3U8Interceptor(page, capturedM3U8);
    }

    try {
      await page.goto(targetURL, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const result = await provider.scrapePage(page, targetURL);

      // 合并导航前拦截器捕获的 M3U8 URL
      if (capturedM3U8.length > 0) {
        // 使用鸭子类型：有 selectBestM3U8 方法则用自身，否则用 UniversalProvider
        const providerForSelect = 'selectBestM3U8' in provider
          ? provider as unknown as BaseSiteProvider
          : new UniversalProvider();

        if (!result.m3u8_url) {
          result.m3u8_url = providerForSelect.selectBestM3U8(capturedM3U8);
        }

        // 通用下载器：将拦截器额外捕获的 M3U8 合并到候选项
        // UniversalProvider 的 scrapePage 返回的 m3u8_candidates 已包含所有捕获的 URL
        // 但如果拦截器捕获了额外 URL，也需要合并
        if (result.m3u8_candidates && capturedM3U8.length > result.m3u8_candidates.length) {
          const existingUrls = new Set(result.m3u8_candidates.map((c) => c.url.split('?')[0]));
          for (const url of capturedM3U8) {
            const normalized = url.split('?')[0];
            if (!existingUrls.has(normalized)) {
              result.m3u8_candidates.push({ url, title: url });
              existingUrls.add(normalized);
            }
          }
        }
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

  /**
   * 清理资源（空操作：Scraper 使用共享浏览器池，无需关闭浏览器实例）
   */
  async close(): Promise<void> {
    // Scraper 使用 getSharedBrowser() 共享池，
    // 页面和上下文在每次 scrape 调用后已自动关闭。
    // 浏览器实例的生命周期由 browser-pool 管理。
  }
}

const SCRAPER_KEY = '__scraperInstance__';

export function getScraper(): Scraper {
  const g = globalThis as Record<string, unknown>;
  if (!g[SCRAPER_KEY]) {
    g[SCRAPER_KEY] = new Scraper();
  }
  return g[SCRAPER_KEY] as Scraper;
}
