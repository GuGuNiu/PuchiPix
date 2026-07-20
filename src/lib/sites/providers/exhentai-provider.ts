import type { Page, BrowserContext } from "playwright";
import { loggers } from '@/lib/core/infra/logger';
import { BaseSiteProvider } from "../base-provider";
import type { ExtendedMetadata, GallerySiteProvider, SiteSearchResult, BlockCheckResult } from "../types";
import type { GalleryScrapeResult, GalleryImageItem, ScrapeResult } from "@/types";
import { MAX_GALLERY_PAGES, PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep } from "@/lib/core/stealth/anti-crawler";
import { logT } from "@/lib/i18n/server";
import {

  BASE_E_URL,
  BASE_EX_URL,
  SITE_DOMAINS,
  THUMBS_PER_PAGE,
  CATEGORY_LABELS,
  CATEGORY_NAMES,
  getExhentaiCookies,
  extractGalleryId,
  normalizeToEhentai,
  matchesExhentaiUrl,
  cleanExhentaiTitle,
  isExhentaiListingPage,
} from "./exhentai-provider/constants";
import {
  setupExhentaiContext,
  extractSearchResults as doExtractSearchResults,
  extractExtendedMetadata as doExtractExtendedMetadata,
  extractGalleryInfo,
  collectImagePageLinks,
  fetchImageUrls,
} from "./exhentai-provider/page-extractors";

const logger = loggers.exhentaiProvider();
export class ExhentaiProvider extends BaseSiteProvider implements GallerySiteProvider {
  readonly id = "exhentai";
  readonly name = "E-Hentai";
  readonly baseUrl = BASE_E_URL;
  readonly enabled = true;

  readonly playButtonSelectors: string[] = [];
  readonly m3u8ExcludePatterns: string[] = ["ad", "stat", "analytics"];

  readonly domains: string[] = SITE_DOMAINS;

  async setupBrowserContext(context: BrowserContext): Promise<void> {
    await setupExhentaiContext(context);
  }

  buildSearchUrl(keyword: string): string {
    const params = new URLSearchParams();
    params.set("f_search", keyword);
    params.set("advsearch", "1");
    params.set("f_srdd", "0");
    params.set("f_cats", "0");
    return `${BASE_E_URL}/?${params.toString()}`;
  }

  getAdaptiveSearchUrls(keyword: string): string[] {
    const encoded = encodeURIComponent(keyword);
    const params = `f_search=${encoded}&advsearch=1&f_srdd=0&f_cats=0`;
    const urls = [`${BASE_E_URL}/?${params}`];
    if (getExhentaiCookies()) {
      urls.push(`${BASE_EX_URL}/?${params}`);
    }
    return urls;
  }

  cleanTitle(rawTitle: string): string {
    return cleanExhentaiTitle(rawTitle);
  }

  matchesUrl(url: string): boolean {
    return matchesExhentaiUrl(url);
  }

  checkContentBlocked(
    _title: string,
    _category: string,
    _protagonist?: string,
  ): BlockCheckResult {
    return { blocked: false, reason: undefined };
  }

  async extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
    return doExtractSearchResults(page);
  }

  async extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
    return doExtractExtendedMetadata(page);
  }

  async scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult> {
    const metadata = await this.extractExtendedMetadata(page);
    const galleryInfo = await extractGalleryInfo(page);

    const imagePageLinks = await collectImagePageLinks(page, pageUrl, galleryInfo.pages);
    const imageUrls = await fetchImageUrls(page, imagePageLinks);

    const allImages: GalleryImageItem[] = [];
    const seenUrls = new Set<string>();
    let orderIndex = 0;

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        allImages.push({
          url,
          pageIndex: Math.floor(i / THUMBS_PER_PAGE),
          orderIndex: orderIndex++,
        });
      }
    }

    const blockCheck = this.checkContentBlocked(
      metadata.title,
      galleryInfo.category,
      metadata.actors[0],
    );
    if (blockCheck.blocked) {
      throw new Error(`Content blocked: ${blockCheck.reason || 'unknown reason'}`);
    }

    let gameCharacters: string[] | undefined;
    try {
      const { getCharacterDBServiceAsync } = await import("@/lib/character-db");
      const db = await getCharacterDBServiceAsync();
      const charMatches = db.identifyInTags(metadata.tags).filter(m => m.character.category === 'game');
      gameCharacters = charMatches.length > 0 ? charMatches.map((m) => m.character.name) : undefined;
    } catch {}

    let scrapedDomain = "";
    try {
      const parsed = new URL(pageUrl);
      scrapedDomain = `${parsed.protocol}//${parsed.host}`;
    } catch {}

    return {
      sourceUrl: pageUrl,
      title: metadata.title,
      protagonist: metadata.actors[0] || "",
      description: metadata.title,
      category: galleryInfo.category,
      tags: metadata.tags,
      coverUrl: galleryInfo.coverUrl,
      publishTime: galleryInfo.posted || undefined,
      images: allImages,
      videos: [],
      pageCount: Math.ceil(galleryInfo.pages / THUMBS_PER_PAGE),
      imageCount: allImages.length,
      videoCount: 0,
      scrapedDomain,
      gameCharacters,
    };
  }

  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const metadata = await this.extractExtendedMetadata(page);
    return {
      m3u8_url: "",
      title: metadata.title,
      page_url: pageUrl,
      tags: metadata.tags,
      actors: metadata.actors,
      categories: metadata.categories,
      director: metadata.director,
    };
  }

  isListingPage(url: string): boolean {
    return isExhentaiListingPage(url);
  }

  async scrapeListingPage(
    page: Page,
    pageUrl: string,
    maxPages: number = 20,
  ): Promise<SiteSearchResult[]> {
    const allResults: SiteSearchResult[] = [];
    const seenUrls = new Set<string>();
    const MAX_LISTING_PAGES = Math.min(maxPages, MAX_GALLERY_PAGES);

    for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
      if (pageNum > 1) {
        await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
      }

      const results = await this.extractSearchResults(page);

      if (results.length === 0) {
        logger.infoT("log.exhentai.listPageNoResults", { page: pageNum });
        break;
      }

      let newCount = 0;
      for (const r of results) {
        const normalizedUrl = this.normalizeUrl(r.url);
        if (!seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          allResults.push({ ...r, url: normalizedUrl });
          newCount++;
        }
      }

      console.log(
        logT("log.exhentai.listPageNewResults", { page: pageNum, count: newCount, total: allResults.length }),
      );

      if (newCount === 0) break;

      const nextUrl = await page.evaluate(() => {
        const nextLink = document.querySelector("a#dnext") as HTMLAnchorElement | null;
        return nextLink?.href || null;
      });

      if (!nextUrl) {
        logger.infoT("log.exhentai.listPageNoNext");
        break;
      }

      try {
        await page.goto(nextUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
      } catch (err) {
        logger.errorT("log.exhentai.navNextFailed", undefined, { error: err });
        break;
      }
    }

    return allResults;
  }

  normalizeUrl(url: string): string {
    return normalizeToEhentai(url);
  }

  getAdaptiveUrls(url: string): string[] {
    const galleryId = extractGalleryId(url);
    if (!galleryId) return [url];

    const tokenMatch = url.match(/\/g\/\d+\/([a-f0-9]+)\//);
    const token = tokenMatch ? tokenMatch[1] : "";

    if (!token) return [url];

    const urls = [`${BASE_E_URL}/g/${galleryId}/${token}/`];
    if (getExhentaiCookies()) {
      urls.push(`${BASE_EX_URL}/g/${galleryId}/${token}/`);
    }

    return urls;
  }
}
