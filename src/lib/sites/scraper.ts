import type { ScrapeResult } from '@/types';
import { getSiteRegistry } from '@/lib/sites';
import type { SiteProvider } from '@/lib/sites';
import { UniversalProvider } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { createStealthPage } from '@/lib/core/stealth/anti-crawler';
import type { BaseSiteProvider } from '@/lib/sites/base-provider';

export class Scraper {
  /**
   * 鏍规嵁 URL 鏌ユ壘鍖归厤鐨勭珯鐐规彁渚涜€呫€?
   *
   * 璺敱浼樺厛绾э細
   * SiteRegistry 涓凡娉ㄥ唽鐨勭珯鐐癸紙Kanav銆佺埍濡瑰瓙绛夋湰鍦伴€傞厤妯″潡锛?
   * UniversalProvider锛堥€氱敤涓嬭浇鍣紝浣滀负鍏滃簳锛?
   *
   * UniversalProvider 涓嶉€氳繃 matchesUrl 鍖归厤锛?
   * 浠呭湪娌℃湁鍏朵粬 Provider 鍖归厤鏃朵綔涓?fallback 浣跨敤銆?
   */
  private getProvider(url: string): SiteProvider {
    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);
    if (provider) {
      return provider;
    }
    // 鏃犲尮閰嶇殑鏈湴閫傞厤妯″潡锛屽垏鎹㈣嚦閫氱敤涓嬭浇鍣?
    return new UniversalProvider();
  }

  /**
   * 鐖彇鐩爣瑙嗛椤甸潰锛屾彁鍙?M3U8 鍦板潃銆佹爣棰樸€佹爣绛惧拰婕斿憳銆?
   *
   * 浣跨敤鍏变韩娴忚鍣ㄦ睜鍜?Stealth 椤甸潰鍒涘缓锛岄伩鍏嶅喎鍚姩寤惰繜銆?
   *
   * @param targetURL - 鐩爣瑙嗛椤甸潰 URL
   * @param timeout   - 椤甸潰鍔犺浇瓒呮椂锛堟绉掞級锛岄粯璁?30 绉?
   * @returns ScrapeResult 鍖呭惈 M3U8 URL銆佹爣棰樸€佹爣绛俱€佹紨鍛?
   */
  async scrape(targetURL: string, timeout: number = 30000): Promise<ScrapeResult> {
    const browser = await getSharedBrowser();
    const provider = this.getProvider(targetURL);
    const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

    const capturedM3U8: string[] = [];

    // 瀵艰埅鍓嶈缃?M3U8 鎷︽埅鍣紝閬垮厤閿欒繃椤甸潰鍔犺浇鏃剁殑 M3U8 璇锋眰
    // 浣跨敤楦瓙绫诲瀷妫€鏌ワ細鎵€鏈?BaseSiteProvider 瀛愮被閮芥湁姝ゆ柟娉?
    if ('setupM3U8Interceptor' in provider) {
      (provider as BaseSiteProvider).setupM3U8Interceptor(page, capturedM3U8);
    }

    try {
      await page.goto(targetURL, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const result = await provider.scrapePage(page, targetURL);

      // 鍚堝苟瀵艰埅鍓嶆嫤鎴櫒鎹曡幏鐨?M3U8 URL
      if (capturedM3U8.length > 0) {
        // 浣跨敤楦瓙绫诲瀷锛氭湁 selectBestM3U8 鏂规硶鍒欑敤鑷韩锛屽惁鍒欑敤 UniversalProvider
        const providerForSelect = 'selectBestM3U8' in provider
          ? provider as BaseSiteProvider
          : new UniversalProvider();

        if (!result.m3u8_url) {
          result.m3u8_url = providerForSelect.selectBestM3U8(capturedM3U8);
        }

        // 閫氱敤涓嬭浇鍣細灏嗘嫤鎴櫒棰濆鎹曡幏鐨?M3U8 鍚堝苟鍒板€欓€夐」
        // UniversalProvider 鐨?scrapePage 杩斿洖鐨?m3u8_candidates 宸插寘鍚墍鏈夋崟鑾风殑 URL
        // 浣嗗鏋滄嫤鎴櫒鎹曡幏浜嗛澶?URL锛屼篃闇€瑕佸悎骞?
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
   * 娓呯悊璧勬簮锛堢┖鎿嶄綔锛歋craper 浣跨敤鍏变韩娴忚鍣ㄦ睜锛屾棤闇€鍏抽棴娴忚鍣ㄥ疄渚嬶級
   */
  async close(): Promise<void> {
    // Scraper 浣跨敤 getSharedBrowser() 鍏变韩姹狅紝
    // 椤甸潰鍜屼笂涓嬫枃鍦ㄦ瘡娆?scrape 璋冪敤鍚庡凡鑷姩鍏抽棴銆?
    // 娴忚鍣ㄥ疄渚嬬殑鐢熷懡鍛ㄦ湡鐢?browser-pool 绠＄悊銆?
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
