import type { Page, BrowserContext } from 'playwright';
import type { ScrapeResult } from '@/types';

/**
 * Sitebaseconfiginfo。
 */
export interface SiteConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  /** Isnoenabledthesite */
  readonly enabled: boolean;
}


export interface SiteSearchResult {
  url: string;
  title: string;
  coverUrl?: string;
  date?: string;
}


export interface SeriesItem {
  url: string;
  title: string;
  id: string;
}


export interface SiteMetadata {
  title: string;
  tags: string[];
  actors: string[];
}


export interface ExtendedMetadata extends SiteMetadata {
  /** CategoryArray */
  categories: string[];
  director: string;
  series: SeriesItem[];
  blocked: boolean;
  /** Blockreason */
  blockReason?: string;
}


export interface GallerySiteProvider {
  scrapeGallery(page: Page, pageUrl: string): Promise<import('@/types').GalleryScrapeResult>;

  
  supportsHttpScrape?: boolean;

  
  scrapeGalleryHttp?(pageUrl: string): Promise<import('@/types').GalleryScrapeResult>;

  /**
   *
   *
   *
   * @param context - Playwright BrowserContext
   */
  setupBrowserContext?(context: BrowserContext): Promise<void>;

  
  isListingPage?(url: string): boolean;

  
  scrapeListingPage?(page: Page, pageUrl: string, maxPages?: number): Promise<SiteSearchResult[]>;

  
  normalizeUrl?(url: string): string;
}

/**
 * ContentblockCheckresult。
 *
 *
 */
export interface BlockCheckResult {
  /** Isnoblock */
  blocked: boolean;
  reason?: string;
}

/**
 * SiteProviderInterface。
 *
 * - contentblockCheck
 *
 */
export interface SiteProvider extends SiteConfig {
  
  buildSearchUrl(keyword: string): string;

  /**
   * @returns Video detail page URL array
   */
  extractSearchResults(page: Page): Promise<SiteSearchResult[]>;

  
  extractMetadata(page: Page): Promise<{
    title: string;
    tags: string[];
    actors: string[];
  }>;

  
  extractExtendedMetadata?(page: Page): Promise<ExtendedMetadata>;

  
  cleanTitle(rawTitle: string): string;

  
  scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult>;

  readonly playButtonSelectors: string[];

  readonly m3u8ExcludePatterns: string[];

  /**
   * @returns isnoMatch
   */
  matchesUrl(url: string): boolean;

  /**
   *
   *
   * @returns blockCheckresult
   */
  checkContentBlocked(
    title: string,
    category: string,
    protagonist?: string
  ): BlockCheckResult;

  /**
   *
   *
   * @returns blockCheckresult
   */
  checkContentBlockedAsync?(
    title: string,
    category: string,
    protagonist?: string
  ): Promise<BlockCheckResult>;

  
  getAdaptiveUrls?(url: string): string[];

  
  getAdaptiveSearchUrls?(keyword: string): string[];

  /**
   *
   *
   * @param domain - domain
   */
  markDomainRateLimited?(domain: string): void;

  /**
   *
   *
   * @param domain - domain
   */
  markDomainHealthy?(domain: string): void;
}

export type SiteType = 'photo' | 'video';

export interface BadgeTheme {
  gradient: string;
  solidColor: string;
  textColor: string;
}

/**
 * Passfrontend siteinfo。
 *
 */
export interface SiteInfo {
  id: string;
  name: string;
  nameCn: string;
  nameEn: string;
  baseUrl: string;
  enabled: boolean;
  type: SiteType;
  badge: BadgeTheme;
  gallery?: boolean;
}
