import type { ScrapeResult } from '@/types';
import { getSiteRegistry } from '@/lib/sites';
import type { SiteProvider } from '@/lib/sites';
import { UniversalProvider } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { createStealthPage } from '@/lib/core/stealth/anti-crawler';
import type { BaseSiteProvider } from '@/lib/sites/base-provider';

export class Scraper {

  private getProvider(url: string): SiteProvider {
    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);
    if (provider) {
      return provider;
    }
    return new UniversalProvider();
  }

  async scrape(targetURL: string, timeout: number = 30000): Promise<ScrapeResult> {
    const browser = await getSharedBrowser();
    const provider = this.getProvider(targetURL);
    const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

    const capturedM3U8: string[] = [];

    if ('setupM3U8Interceptor' in provider) {
      (provider as BaseSiteProvider).setupM3U8Interceptor(page, capturedM3U8);
    }

    try {
      await page.goto(targetURL, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const result = await provider.scrapePage(page, targetURL);

      if (capturedM3U8.length > 0) {
        const providerForSelect = 'selectBestM3U8' in provider
          ? provider as BaseSiteProvider
          : new UniversalProvider();

        if (!result.m3u8_url) {
          result.m3u8_url = providerForSelect.selectBestM3U8(capturedM3U8);
        }

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

  async close(): Promise<void> {
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
