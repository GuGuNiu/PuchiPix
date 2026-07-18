import type { Page } from 'playwright';
import { BaseSiteProvider } from '../base-provider';
import type { ExtendedMetadata, GallerySiteProvider, SiteSearchResult, BlockCheckResult } from '../types';
import type {
  GalleryScrapeResult,
  GalleryZipInfo,
  ScrapeResult,
} from '@/types';
import { PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep } from '@/lib/core/stealth/anti-crawler';
import { logT } from '@/lib/i18n/server';
import { getProtagonistService } from '@/lib/protagonist/protagonist-service';
import {
  BLOCKED_TITLE_KEYWORDS,
  BLOCKED_CATEGORIES,
  BLOCKED_PROTAGONISTS,
  BLOCKED_PROTAGONISTS_ENABLED,
} from './constants';
import { getBlocklistService } from '../blocklist-service';

export interface ScrapeDeps {
  resolveUrl(url: string): string;
  cleanTitle(rawTitle: string): string;
  extractProtagonist(title: string, tags: string[]): Promise<string>;
  extractDescription(title: string, protagonist: string): string;
  checkContentBlockedAsync(
    title: string,
    category: string,
    protagonist?: string,
  ): Promise<BlockCheckResult>;
}

import {
  SITE_DOMAINS,
  SITE_SUFFIX_PATTERN,
  domainHealthTracker,
  extractArticleId,
  replaceDomain,
  extractDomainFromUrl,
  removePublisherPrefix,
} from './aimeizizi/constants';
import {
  extractGalleryPageData,
  extractZipDownloadInfo,
  extractSearchResultsRaw,
  extractExtMetadataRaw,
} from './aimeizizi/page-evaluators';
import { scrapeGallery as scrapeGalleryImpl } from './aimeizizi/scrape-gallery';
import { scrapeGalleryHttp as scrapeGalleryHttpImpl } from './aimeizizi/scrape-gallery-http';

export class AimeiziziProvider extends BaseSiteProvider implements GallerySiteProvider {
  readonly id = 'aimeizizi';
  readonly name = '鐖卞瀛?;
  readonly baseUrl = 'https://www.lovecutes.com';
  readonly enabled = true;
  readonly playButtonSelectors: string[] = [];
  readonly m3u8ExcludePatterns: string[] = ['ad', 'stat', 'analytics'];
  readonly domains: string[] = SITE_DOMAINS;
  readonly blockedTitleKeywords: readonly string[] = BLOCKED_TITLE_KEYWORDS;
  readonly blockedCategories: readonly string[] = BLOCKED_CATEGORIES;
  readonly blockedProtagonists: readonly string[] = BLOCKED_PROTAGONISTS;
  readonly blockedProtagonistsEnabled: boolean = BLOCKED_PROTAGONISTS_ENABLED;

  markDomainRateLimited(domain: string): void {
    domainHealthTracker.markRateLimited(domain);
  }

  markDomainHealthy(domain: string): void {
    domainHealthTracker.markHealthy(domain);
  }

  buildSearchUrl(keyword: string): string {
    const domain = domainHealthTracker.getBestDomain(SITE_DOMAINS);
    return `${domain}/?s=${encodeURIComponent(keyword)}`;
  }

  getAdaptiveSearchUrls(keyword: string): string[] {
    const encoded = encodeURIComponent(keyword);
    const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
    return orderedDomains.map((d) => `${d}/?s=${encoded}`);
  }

  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';
    let title = rawTitle.trim();
    title = title.replace(/^\[.*?\]\s*/, '');
    title = removePublisherPrefix(title);
    title = title.replace(SITE_SUFFIX_PATTERN, '');
    title = title.replace(/\s*[-鈥斺€揮\s*鐖卞瀛怽s*$/i, '');
    return title.trim();
  }

  async extractProtagonist(title: string, tags: string[]): Promise<string> {
    if (!title) return '';
    const service = getProtagonistService();
    const name = await service.extractFromTitleSmart(title, tags);

    if (name) {
      service.learnPerson(name).catch((err) => {
        console.warn(logT('log.aimeizizi.learnPersonFailed'), err);
      });
    }

    return name;
  }

  extractDescription(title: string, protagonist: string): string {
    if (!title) return '';
    if (!protagonist) return title;

    let desc = title.replace(protagonist, '').replace(/^\s*[-鈥斺€揮\s*/, '').trim();
    desc = desc.replace(/\s*\d+P\d*V?\s*$/i, '').trim();
    return desc;
  }

  checkBlocked(
    title: string,
    category: string,
    protagonist?: string,
  ): { blocked: boolean; reason: string | undefined } {
    if (title) {
      const titleLower = title.toLowerCase();
      for (const keyword of this.blockedTitleKeywords) {
        if (titleLower.includes(keyword.toLowerCase())) {
          return { blocked: true, reason: `鏍囬鍖呭惈灞忚斀鍏抽敭璇? "${keyword}"` };
        }
      }
    }

    if (category) {
      for (const keyword of this.blockedCategories) {
        if (category.includes(keyword)) {
          return { blocked: true, reason: `鍒嗙被鍖呭惈灞忚斀鍏抽敭璇? "${keyword}"` };
        }
      }
    }

    if (this.blockedProtagonistsEnabled && protagonist) {
      for (const blocked of this.blockedProtagonists) {
        if (protagonist === blocked || protagonist.includes(blocked)) {
          return { blocked: true, reason: `涓昏鍚嶈灞忚斀: "${blocked}"` };
        }
      }
    }

    return { blocked: false, reason: undefined };
  }

  async checkContentBlockedAsync(
    title: string,
    category: string,
    protagonist?: string,
  ): Promise<BlockCheckResult> {
    const defaultResult = this.checkBlocked(title, category, protagonist);
    if (defaultResult.blocked) return defaultResult;

    return getBlocklistService().checkUserRules(this.id, {
      title,
      category,
      protagonist,
    });
  }

  checkContentBlocked(
    title: string,
    category: string,
    protagonist?: string,
  ): BlockCheckResult {
    return this.checkBlocked(title, category, protagonist);
  }


  matchesUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'www.lovecutes.com' ||
        hostname === 'lovecutes.com' ||
        hostname === 'www.lovecutes.net' ||
        hostname === 'lovecutes.net' ||
        hostname === 'xx.knit.bid' ||
        hostname.endsWith('.knit.bid') ||
        hostname.endsWith('.lovecutes.com') ||
        hostname.endsWith('.lovecutes.net')
      );
    } catch {
      return /^\d+$/.test(url);
    }
  }

  async extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
    const rawResults = await extractSearchResultsRaw(page);

    const filteredResults: typeof rawResults = [];
    for (const item of rawResults) {
      const check = await this.checkContentBlockedAsync(item.title, '');
      if (check.blocked) {
        console.log(logT('log.aimeizizi.blockedSearchResult', { title: item.title.substring(0, 50), reason: check.reason ?? '' }));
        continue;
      }
      filteredResults.push(item);
    }
    return filteredResults;
  }

  async extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
    const raw = await extractExtMetadataRaw(page);

    const title = this.cleanTitle(raw.h1Title || raw.documentTitle);
    const protagonist = await this.extractProtagonist(title, raw.tags);

    const metaKeywords = raw.keywordStr
      .split(/[,锛?锛沒/)
      .map((t) => t.trim())
      .filter((t) => t && t.length < 50 && !raw.tags.includes(t));

    return {
      title,
      tags: [...raw.tags, ...metaKeywords],
      actors: protagonist ? [protagonist] : [],
      categories: raw.category ? [raw.category] : [],
      director: '',
      series: [],
      blocked: false,
    };
  }

  async scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult> {
    return scrapeGalleryImpl(page, pageUrl, this);
  }

  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const metadata = await this.extractExtendedMetadata(page);

    const m3u8Urls: string[] = [];

    const videoSources = await page.evaluate(() => {
      const urls: string[] = [];
      document.querySelectorAll('video source[src*=".m3u8"]').forEach((source) => {
        const src = source.getAttribute('src') || '';
        if (src) urls.push(src);
      });
      return urls;
    });
    m3u8Urls.push(...videoSources);

    const jsM3u8 = await this.scanJsForM3U8(page);
    m3u8Urls.push(...jsM3u8);

    const m3u8Url = this.selectBestM3U8(m3u8Urls);

    return {
      m3u8_url: m3u8Url,
      title: metadata.title,
      page_url: pageUrl,
      tags: metadata.tags,
      actors: metadata.actors,
      categories: metadata.categories,
      director: metadata.director,
    };
  }

  resolveUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${this.baseUrl}${url}`;
    return url;
  }

  isListingPage(url: string): boolean {
    return !url.includes('/article/');
  }

  async scrapeListingPage(page: Page, pageUrl: string, maxPages: number = 20): Promise<SiteSearchResult[]> {
    const MAX_LISTING_PAGES = maxPages;
    const allResults: SiteSearchResult[] = [];
    const seenUrls = new Set<string>();

    for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
      const currentUrl = pageNum === 1
        ? pageUrl
        : this.buildListingPageUrl(pageUrl, pageNum);

      try {
        const response = await page.goto(currentUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        if (response?.status() === 404) break;

        await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);

        const results = await this.extractSearchResults(page);

        if (results.length === 0) break;

        let newCount = 0;
        for (const r of results) {
          const normalizedUrl = this.normalizeUrl(r.url);
          if (!seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            allResults.push({ ...r, url: normalizedUrl });
            newCount++;
          }
        }

        if (newCount === 0) break;

        const hasNext = await this.checkNextPage(page);
        if (!hasNext) break;

        await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
      } catch (err) {
        console.error(logT('log.aimeizizi.listPageFailed', { page: pageNum }), err);
        break;
      }
    }

    return allResults;
  }

  private buildListingPageUrl(baseUrl: string, pageNum: number): string {
    const parsed = new URL(baseUrl);
    if (parsed.searchParams.has('s')) {
      parsed.searchParams.delete('paged');
      const searchParams = parsed.searchParams.toString();
      return `${parsed.origin}/page/${pageNum}/${searchParams ? '?' + searchParams : ''}`;
    }
    const path = parsed.pathname.replace(/\/$/, '');
    if (/\/page\/\d+\/?$/.test(path)) {
      const nextPath = path.replace(/\/page\/\d+\/?$/, `/page/${pageNum}/`);
      return `${parsed.origin}${nextPath}/`;
    }
    return `${parsed.origin}${path}/page/${pageNum}/`;
  }

  private async checkNextPage(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const nextLink = document.querySelector(
        'a.next.page-numbers, nav[aria-label="Pagination"] a[rel="next"]'
      );
      if (nextLink) return true;

      const dataPageLinks = document.querySelectorAll('a[data-page]');
      if (dataPageLinks.length > 0) return true;

      const customNext = document.querySelector('.pagination-nav .next-page a, .next-page a');
      if (customNext) return true;

      const navLinks = document.querySelectorAll(
        'nav.pagination a, .nav-links a, .pagination-nav .pagination a'
      );
      for (const link of navLinks) {
        const text = link.textContent?.trim() || '';
        if (text.includes('涓嬩竴椤?) || text.includes('Next') || text.includes('鈥?) || text.includes('禄')) {
          return true;
        }
      }

      const pageNumbers = document.querySelectorAll(
        '.page-numbers, nav.pagination a, .pagination-nav .pagination a[data-page]'
      );
      return pageNumbers.length >= 2;
    });
  }

  getAdaptiveUrls(articleUrl: string): string[] {
    const articleId = extractArticleId(articleUrl);
    if (!articleId) return [articleUrl];

    const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
    return orderedDomains.map((d) => `${d}/article/${articleId}/`);
  }

  normalizeUrl(url: string): string {
    return replaceDomain(url, this.baseUrl);
  }

  readonly supportsHttpScrape = true;

  async scrapeGalleryHttp(pageUrl: string): Promise<GalleryScrapeResult> {
    return scrapeGalleryHttpImpl(pageUrl, this);
  }
}
