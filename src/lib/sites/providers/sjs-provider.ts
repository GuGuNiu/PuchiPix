/**
 * Sijishe 绔欑偣鎻愪緵鑰?
 *
 * 鏀寔甯栧瓙鎼滅储銆佽棰戦〉闈㈢埇鍙栧拰涓嬭浇閾炬帴鎻愬彇锛岄渶鐧诲綍 Cookie銆?
 */
import type { Page } from "playwright";
import { BaseSiteProvider } from "../base-provider";
import type { ExtendedMetadata, GallerySiteProvider, SiteSearchResult, BlockCheckResult } from "../types";
import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
  ScrapeResult,
} from "@/types";
import { MAX_GALLERY_PAGES, PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep } from "@/lib/core/stealth/anti-crawler";
import { getSiteAccountManager } from "../site-account-manager";
import { logT } from "@/lib/i18n/server";
import {
  extractDownloadLinks,
  isThreadPurchasable,
} from "../sjs-actions";
import { getProtagonistService } from "@/lib/protagonist/protagonist-service";
import {
  SITE_DOMAINS,
  PRIMARY_DOMAIN,
  extractThreadId,
  extractForumId,
  normalizeSjsUrl,
  matchesSjsUrl,
  isListingPage as isSjsListingPage,
  cleanSjsTitle,
} from "./sjs-provider/constants";

import {
  getBestDomain,
  getAllDomainsOrdered,
  markDomainHealthy,
  markDomainRateLimited,
  setupSjsBrowserContext,
} from "./sjs-provider/auth";
import {
  extractSearchResults,
  extractExtendedMetadata as extractMetadata,
  extractPostContent,
  getThreadTotalPages,
  extractForumListResults,
  getNextPageUrl,
} from "./sjs-provider/page-extractors";

export class SjsProvider extends BaseSiteProvider implements GallerySiteProvider {
  readonly id = "sjs";
  readonly name = "鍙告満绀?;
  readonly baseUrl = PRIMARY_DOMAIN;
  readonly enabled = true;

  readonly playButtonSelectors: string[] = [];
  readonly m3u8ExcludePatterns: string[] = ["ad", "stat", "analytics"];

  readonly domains: string[] = SITE_DOMAINS;

  private currentAccountId: number | null = null;

  async setupBrowserContext(context: import("playwright").BrowserContext): Promise<void> {
    const { accountId } = await setupSjsBrowserContext(context);
    this.currentAccountId = accountId;
  }

  buildSearchUrl(keyword: string): string {
    const domain = getBestDomain();
    return `${domain}/search.php?mod=forum&srchtxt=${encodeURIComponent(keyword)}&searchsubmit=yes`;
  }

  getAdaptiveSearchUrls(keyword: string): string[] {
    const encoded = encodeURIComponent(keyword);
    const orderedDomains = getAllDomainsOrdered();
    return orderedDomains.map((d) => `${d}/search.php?mod=forum&srchtxt=${encoded}&searchsubmit=yes`);
  }

  cleanTitle(rawTitle: string): string {
    return cleanSjsTitle(rawTitle);
  }

  matchesUrl(url: string): boolean {
    return matchesSjsUrl(url);
  }

  checkContentBlocked(
    _title: string,
    _category: string,
    _protagonist?: string,
  ): BlockCheckResult {
    return { blocked: false, reason: undefined };
  }

  async extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
    return extractSearchResults(page);
  }

  async extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
    return extractMetadata(page);
  }

  async scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult> {
    const pageHtml = await page.content();
    const needsPurchase = isThreadPurchasable(pageHtml);
    const downloadLinks = extractDownloadLinks(pageHtml);

    if (needsPurchase) {
      console.log(logT("log.sjs.paidContent"));
    } else if (downloadLinks.length > 0) {
      console.log(logT("log.sjs.detectedDownloadLinks", { count: downloadLinks.length }));
    }

    const metadata = await this.extractExtendedMetadata(page);
    const firstPageData = await extractPostContent(page, 0);
    const totalPages = await getThreadTotalPages(page);
    const maxPages = Math.min(totalPages, MAX_GALLERY_PAGES);
    const allImages: GalleryImageItem[] = [];
    const allVideos: GalleryVideoItem[] = [];
    const imageUrlSet = new Set<string>();
    const videoUrlSet = new Set<string>();
    let orderIndex = 0;

    for (const img of firstPageData.images) {
      const fullUrl = this.resolveUrl(img.url);
      if (fullUrl && !imageUrlSet.has(fullUrl)) {
        imageUrlSet.add(fullUrl);
        allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
      }
    }
    for (const videoUrl of firstPageData.videos) {
      const fullUrl = this.resolveUrl(videoUrl);
      if (fullUrl && !videoUrlSet.has(fullUrl)) {
        videoUrlSet.add(fullUrl);
        allVideos.push({ url: fullUrl });
      }
    }

    const threadId = extractThreadId(pageUrl);
    const forumId = extractForumId(pageUrl) || "1";

    for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
      await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));

      const pageUrlConstructed = `${this.baseUrl}/thread-${threadId}-${pageNum}-${forumId}.html`;

      try {
        await page.goto(pageUrlConstructed, {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });

        const pageData = await extractPostContent(page, pageNum - 1);

        for (const img of pageData.images) {
          const fullUrl = this.resolveUrl(img.url);
          if (fullUrl && !imageUrlSet.has(fullUrl)) {
            imageUrlSet.add(fullUrl);
            allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
          }
        }
        for (const videoUrl of pageData.videos) {
          const fullUrl = this.resolveUrl(videoUrl);
          if (fullUrl && !videoUrlSet.has(fullUrl)) {
            videoUrlSet.add(fullUrl);
            allVideos.push({ url: fullUrl });
          }
        }

        console.log(logT("log.sjs.pageNewImages", { page: pageNum, total: allImages.length }));
      } catch (err) {
        console.error(logT("log.sjs.scrapePageFailed", { page: pageNum }), err);
        break;
      }
    }

    if (this.currentAccountId) {
      const accountManager = getSiteAccountManager();
      await accountManager.markUsed(this.currentAccountId).catch(() => {});
    }

    let scrapedDomain = "";
    try {
      const parsed = new URL(pageUrl);
      scrapedDomain = `${parsed.protocol}//${parsed.host}`;
    } catch {}

    const protagonist = await this.extractProtagonist(metadata.title, metadata.tags);

    let gameCharacters: string[] | undefined;
    try {
      const { getCharacterDBService } = await import("@/lib/character-db");
      const db = getCharacterDBService();
      if (!db.isLoaded()) {
        await db.load();
      }
      const charMatches = db.identifyInTags(metadata.tags).filter(m => m.character.category === 'game');
      gameCharacters = charMatches.length > 0 ? charMatches.map((m) => m.character.name) : undefined;
    } catch {}

    return {
      sourceUrl: pageUrl,
      title: metadata.title,
      protagonist,
      description: metadata.title,
      category: metadata.categories[0] || "",
      tags: metadata.tags,
      coverUrl: this.resolveUrl(firstPageData.coverUrl),
      publishTime: firstPageData.publishTime || undefined,
      images: allImages,
      videos: allVideos,
      pageCount: maxPages,
      imageCount: allImages.length,
      videoCount: allVideos.length,
      scrapedDomain,
      gameCharacters,
      needsPurchase,
      downloadLinks: downloadLinks.length > 0 ? downloadLinks : undefined,
    };
  }

  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const metadata = await this.extractExtendedMetadata(page);

    const videos: string[] = [];
    const contentEl = await page.evaluate(() => {
      const firstPost = document.querySelector('#postlist div[id^="post_"]');
      return firstPost?.querySelector(".t_f")?.innerHTML || "";
    });

    const videoMatches = contentEl.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|flv)[^\s"'<>]*/gi);
    if (videoMatches) {
      videos.push(...videoMatches);
    }

    const m3u8Url = videos.find((v) => v.includes(".m3u8")) || "";

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

  isListingPage(url: string): boolean {
    return isSjsListingPage(url);
  }

  async scrapeListingPage(
    page: Page,
    pageUrl: string,
    maxPages: number = 20,
  ): Promise<SiteSearchResult[]> {
    const allResults: SiteSearchResult[] = [];
    const seenTids = new Set<string>();
    const MAX_LISTING_PAGES = Math.min(maxPages, MAX_GALLERY_PAGES);

    const isSearchPage = pageUrl.includes("search.php") || pageUrl.includes("searchid=");

    for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
      if (pageNum > 1) {
        await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
      }

      const results = isSearchPage
        ? await extractSearchResults(page)
        : await extractForumListResults(page);

      if (results.length === 0) {
        console.log(logT("log.sjs.listPageNoResults", { page: pageNum }));
        break;
      }

      let newCount = 0;
      for (const r of results) {
        const tid = extractThreadId(r.url);
        const key = tid || r.url;
        if (!seenTids.has(key)) {
          seenTids.add(key);
          allResults.push({ ...r, url: this.normalizeUrl(r.url) });
          newCount++;
        }
      }

      console.log(logT("log.sjs.listPageNewResults", { page: pageNum, count: newCount, total: allResults.length }));

      if (newCount === 0) break;

      const nextUrl = await getNextPageUrl(page, pageUrl, pageNum, this.baseUrl);

      if (!nextUrl) {
        console.log(logT("log.sjs.listPageNoNext"));
        break;
      }

      try {
        await page.goto(nextUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } catch (err) {
        console.error(logT("log.sjs.navNextFailed"), err);
        break;
      }
    }

    return allResults;
  }

  normalizeUrl(url: string): string {
    return normalizeSjsUrl(url);
  }

  getAdaptiveUrls(url: string): string[] {
    const tid = extractThreadId(url);
    if (!tid) return [url];

    const fid = extractForumId(url) || "1";

    const orderedDomains = getAllDomainsOrdered();
    return orderedDomains.map((d) => `${d}/thread-${tid}-1-${fid}.html`);
  }

  markDomainRateLimited(domain: string): void {
    markDomainRateLimited(domain);
  }

  markDomainHealthy(domain: string): void {
    markDomainHealthy(domain);
  }

  private async extractProtagonist(title: string, tags: string[] = []): Promise<string> {
    if (!title) return "";
    const service = getProtagonistService();
    const name = await service.extractFromTitleSmart(title, tags);

    if (name) {
      service.learnPerson(name).catch((err) => {
        console.warn(logT("log.sjs.learnPersonFailed"), err);
      });
    }

    return name;
  }

  private resolveUrl(url: string): string {
    if (!url) return "";
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    if (url.startsWith("//")) {
      return `https:${url}`;
    }
    if (url.startsWith("/")) {
      return `${this.baseUrl}${url}`;
    }
    return url;
  }
}
