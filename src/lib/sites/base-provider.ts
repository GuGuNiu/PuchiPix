﻿import type { Page } from 'playwright';
import { loggers } from '@/lib/core/infra/logger';
import type { SiteProvider, SiteSearchResult, ExtendedMetadata } from './types';
import type { ScrapeResult } from '@/types';
import { logT } from '@/lib/i18n/server';


const logger = loggers.baseProvider();
const ACTOR_PATTERNS = [
  { pattern: /主演[:]\s*(.+)/, group: 1 },
  { pattern: /演员[:]\s*(.+)/, group: 1 },
  { pattern: /艺人[:]\s*(.+)/, group: 1 },
  { pattern: /出演[:]\s*(.+)/, group: 1 },
  { pattern: /女优[:]\s*(.+)/, group: 1 },
  { pattern: /男优[:]\s*(.+)/, group: 1 },
  { pattern: /主役[:]\s*(.+)/, group: 1 },
  { pattern: /监督[:]\s*(.+)/, group: 1 },
  { pattern: /Starring[:]\s*(.+)/i, group: 1 },
  { pattern: /Actress[:]\s*(.+)/i, group: 1 },
  { pattern: /Actor[:]\s*(.+)/i, group: 1 },
  { pattern: /Cast[:]\s*(.+)/i, group: 1 },
  { pattern: /出演者[:]\s*(.+)/, group: 1 },
];

const DEFAULT_PLAY_BUTTON_SELECTORS = [
  '.play-btn', '.player-play', '.video-play',
  '[onclick*="play"]', '.play-button', '.start-btn',
  '.btn-play', '.play-icon', '[id*="play"]',
  '[class*="play"]', '[class*="player"]',
];

const DEFAULT_M3U8_EXCLUDE_PATTERNS = ['ad', 'stat', 'analytics', 'tracker', 'beacon'];

const DEFAULT_SEARCH_SELECTORS = [
  '.stui-vodlist__item a',
  '.stui-vodlist__box a',
  '.vodlist_item a',
  '.vodlist a',
  '.searchlist_item a',
  '.module-search-item a',
  '.module-item-pic a',
  '.list-item a',
  '.video-item a',
  '.movie-item a',
  '.stui-pannel__hd a',
  'ul.myui-vodlist a',
  '.thumbnail a',
  '.search-result a',
  '.vodlist_item .vodlist_title a',
  '.module-item a',
];

const DEFAULT_DATE_SELECTORS = [
  '.vodlist_item .text-muted',
  '.stui-vodlist__detail span',
  '.vodlist_sub',
  '.module-item-caption span',
  '.video-item-date',
  '.list-item-date',
  '.item-date',
  '.vodlist_item [class*="date"]',
  '.vodlist_item [class*="time"]',
  '.stui-vodlist__meta span',
];

const DEFAULT_TAG_SELECTORS = '.category a, .tag a, .tags a, [class*="tag"] a';

const DEFAULT_ACTOR_SELECTORS = [
  '.actor a', '.actors a', '.star a', '.stars a',
  '.cast a', '.performer a', '.model a',
  '[class*="actor"] a', '[class*="star"] a',
  '[class*="performer"] a', '[class*="model"] a',
  '.avatar-name', '.actor-name', '.star-name',
  '[class*="kv"] a', '.celebrity a',
  '.video-actor', '.media-star',
];

/**
 *
 */
export abstract class BaseSiteProvider implements SiteProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  abstract readonly enabled: boolean;

  readonly searchResultSelectors: string[] = DEFAULT_SEARCH_SELECTORS;

  readonly playButtonSelectors: string[] = DEFAULT_PLAY_BUTTON_SELECTORS;

  readonly m3u8ExcludePatterns: string[] = DEFAULT_M3U8_EXCLUDE_PATTERNS;

  readonly tagSelectors: string = DEFAULT_TAG_SELECTORS;

  readonly actorSelectors: string[] = DEFAULT_ACTOR_SELECTORS;

  readonly dateSelectors?: string[] = DEFAULT_DATE_SELECTORS;

  abstract buildSearchUrl(keyword: string): string;

  abstract cleanTitle(rawTitle: string): string;

  abstract matchesUrl(url: string): boolean;

  /**
 / **
 / **
 / * / *  / 
 / 
 / */
  async extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
    const selectors = this.searchResultSelectors;
    const dateSels = this.dateSelectors ?? [];

    return page.evaluate(
      ([sels, dSels]: [string[], string[]]) => {
        const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
        const seen = new Set<string>();
        const dateRegex = /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/;
        const dateRegexShort = /\b(\d{4}[-/]\d{1,2})\b/;

        for (const sel of sels) {
          document.querySelectorAll<HTMLAnchorElement>(sel).forEach((el) => {
            const href = el.href;
            const text = el.textContent?.trim() || '';
            const titleAttr = el.getAttribute('title') || '';

            if (href && href.includes('/vod') && !seen.has(href)) {
              if (
                href.includes('/vod/detail/') ||
                href.includes('/vod/play/') ||
                href.includes('/vod/show/') ||
                href.match(/\/vod\/\d+/)
              ) {
                seen.add(href);

                let title = titleAttr || text || '';

                if (!title) {
                  const container = el.closest('li, div, .item, .module-item, .stui-vodlist__item, .vodlist_item, .searchlist_item');
                  if (container) {
                    const titleEl =
                      container.querySelector('.title, .vodlist_title, .module-item-title, .video-title, [class*="title"], [class*="name"], h3, h4, h5, .stui-vodlist__title');
                    if (titleEl) {
                      title = titleEl.textContent?.trim() || '';
                    }
                  }
                }

                if (!title) {
                  const img = el.querySelector('img') ||
                    el.closest('li,div')?.querySelector('img');
                  if (img) {
                    title = img.getAttribute('alt') || '';
                  }
                }

                const img = el.querySelector('img') ||
                  el.closest('li,div')?.querySelector('img');
                const coverUrl =
                  img?.getAttribute('data-original') ||
                  img?.getAttribute('data-src') ||
                  img?.getAttribute('src') ||
                  undefined;

                let date: string | undefined;
                const container = el.closest('li, div, .item, .module-item, .stui-vodlist__item, .vodlist_item, .searchlist_item');
                if (container) {
                  for (const dSel of dSels) {
                    const dateEl = container.querySelector(dSel);
                    if (dateEl) {
                      const dateText = dateEl.textContent?.trim();
                      const m = dateText?.match(dateRegex) || dateText?.match(dateRegexShort);
                      if (m) {
                        date = m[1];
                        break;
                      }
                    }
                  }

                  if (!date) {
                    const containerText = container.textContent || '';
                    const m = containerText.match(dateRegex);
                    if (m) {
                      date = m[1];
                    }
                  }
                }

                results.push({ url: href, title, coverUrl, date });
              }
            }
          });
        }

        return results.slice(0, 20);
      },
      [selectors, dateSels] as [string[], string[]]
    );
  }

  /**
 / **
 / * / *  / 
 / 
 / */
  async extractMetadata(page: Page): Promise<{
    title: string;
    tags: string[];
    actors: string[];
  }> {
    const rawTitle = await page.evaluate(() => {
      let title = document.title || '';

      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        const content = ogTitle.getAttribute('content');
        if (content && content.length > title.length) {
          title = content;
        }
      }

      const metaTitle = document.querySelector('meta[name="title"]');
      if (metaTitle && !title) {
        const content = metaTitle.getAttribute('content');
        if (content) title = content;
      }

      return title.trim();
    });

    const title = this.cleanTitle(rawTitle);

    const tags = await page.evaluate((tagSel: string) => {
      const tagList: string[] = [];

      const metaKeywords = document.querySelector('meta[name="keywords"]');
      if (metaKeywords) {
        const content = metaKeywords.getAttribute('content');
        if (content) {
          tagList.push(
            ...content
              .split(/[,;]/)
              .map((t) => t.trim())
              .filter((t) => t && !t.includes(' - ') && t.length < 50)
          );
        }
      }

      document.querySelectorAll('meta[property*="tag"], meta[name*="tag"]').forEach((el) => {
        const content = el.getAttribute('content');
        if (content) tagList.push(content.trim());
      });

      document.querySelectorAll(tagSel).forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length < 50) tagList.push(text);
      });

      return [...new Set(tagList)];
    }, this.tagSelectors);

    const actors = await page.evaluate((actorSels: string[]) => {
      const actorList: string[] = [];

      try {
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        jsonLdScripts.forEach((script) => {
          try {
            const data = JSON.parse(script.textContent || '{}') as Record<string, unknown>;
            const crawlActor = (obj: Record<string, unknown>): void => {
              if (!obj || typeof obj !== 'object') return;
              const name = (obj as Record<string, unknown>)['name'] as string | undefined;
              const type = (obj as Record<string, unknown>)['@type'] as string | undefined;
              if (type === 'Person' && name) {
                actorList.push(name);
              }
              Object.values(obj).forEach((val) => {
                if (Array.isArray(val)) {
                  val.forEach((item) => {
                    if (typeof item === 'object') crawlActor(item as Record<string, unknown>);
                  });
                } else if (typeof val === 'object') {
                  crawlActor(val as Record<string, unknown>);
                }
              });
            };
            crawlActor(data);
          } catch {
          }
        });
      } catch {
      }

      for (const sel of actorSels) {
        document.querySelectorAll(sel).forEach((el) => {
          const text = el.textContent?.trim();
          if (text && text.length > 1 && text.length < 30 && !text.includes('\n')) {
            actorList.push(text);
          }
        });
      }

      return [...new Set(actorList)];
    }, this.actorSelectors);

    const pageText = await page.evaluate(() => document.body.innerText || '');
    for (const { pattern, group } of ACTOR_PATTERNS) {
      const match = pageText.match(pattern);
      if (match && match[group]) {
        const names = match[group]
          .split(/[,、/|&]/)
          .map((n) => n.trim())
          .filter((n) => n && n.length < 50);
        actors.push(...names);
      }
    }

    return {
      title,
      tags: [...new Set(tags)],
      actors: [...new Set(actors)],
    };
  }

  /**
 / **
 / **
 / ** @returns Extended metadata object
 / * / *  / 
 / 
 / */
  async extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
    const metadata = await this.extractMetadata(page);
    return {
      ...metadata,
      categories: [],
      director: '',
      series: [],
      blocked: false,
    };
  }

  async clickPlayButton(page: Page): Promise<void> {
    try {
      for (const sel of this.playButtonSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
            await el.click({ timeout: 800 }).catch(() => {});
            await page.waitForTimeout(1000);
          }
        } catch {
        }
      }
    } catch {
    }
  }

  /**
 / **
 / ** @param page - Playwright Page instance
 / * / *  / 
 / 
 / */
  async scanJsForM3U8(page: Page): Promise<string[]> {
    try {
      return page.evaluate(() => {
        const urls: string[] = [];
        const tryAddUrl = (rawUrl: string): void => {
          const url = rawUrl.trim();
          if (!url) return;
          if (url.includes('.m3u8') || url.includes('.m3u')) {
            urls.push(url);
          }
          try {
            const decoded = decodeURIComponent(url);
            if (decoded !== url && (decoded.includes('.m3u8') || decoded.includes('.m3u'))) {
              urls.push(decoded);
            }
          } catch {}
          try {
            const decoded = atob(url);
            if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
              urls.push(decoded);
            }
          } catch {}
        };

        try {
          const playerData = window.player_aaaa;
          if (playerData && typeof playerData.url === 'string') {
            tryAddUrl(playerData.url);
          }
        } catch {}

        if (urls.length === 0) {
          try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              const content = script.textContent || script.innerHTML || '';
              const match = content.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
              if (match) {
                const playerData = JSON.parse(match[1]) as { url?: string };
                if (playerData.url && typeof playerData.url === 'string') {
                  tryAddUrl(playerData.url);
                }
                break;
              }
            }
          } catch {}
        }

        const scripts = document.querySelectorAll('script');
        scripts.forEach((script) => {
          const content = script.textContent || script.innerHTML || '';
          const matches = content.match(
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi
          );
          if (matches) {
            urls.push(...matches);
          }
        });
        return urls;
      });
    } catch {
      return [];
    }
  }

  /**
 / **
 / ** @param urls - Catchto  M3U8 URL Array
 / * / *  / 
 / 
 / */
  selectBestM3U8(urls: string[]): string {
    const unique = [...new Set(urls)];
    if (unique.length === 0) return '';

    const sorted = unique.sort((a, b) => {
      const aHigh = /(1080|1920|2160|4k|high)/i.test(a);
      const bHigh = /(1080|1920|2160|4k|high)/i.test(b);
      if (aHigh && !bHigh) return -1;
      if (!aHigh && bHigh) return 1;
      return b.length - a.length;
    });

    return sorted[0];
  }

  /**
 / ** Set M3U8 NetworkRequestInterceptor。
 / **
 / **
 / ** @param page - Playwright Page instance
 / * / *  / 
 / 
 / */
  setupM3U8Interceptor(page: Page, captured: string[]): void {
    const excludePatterns = this.m3u8ExcludePatterns;

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('.m3u8') || url.includes('.m3u')) {
        const pathLower = url.toLowerCase();
        const excluded = excludePatterns.some((p) => pathLower.includes(p));
        if (!excluded) {
          captured.push(url);
        }
      }
    });
  }

  checkContentBlocked(
    _title: string,
    _category: string,
    _protagonist?: string
  ): import('./types').BlockCheckResult {
    return { blocked: false, reason: undefined };
  }

  /**
 / **
 / * - Set M3U8 RequestInterceptor
 / * - AwaitpageLoad
 / * - Extract title, tag, cast
 / * - Click play button to trigger M3U8 request
 / * - Scan inline M3U8 URLs in JS
 / * - Deduplicate and select best M3U8 URL
 / **
 / ** @returns Scrape result
 / * / *  / 
 / 
 / */
  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const capturedM3U8: string[] = [];

    this.setupM3U8Interceptor(page, capturedM3U8);

    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch {
    }

    let metadata: { title: string; tags: string[]; actors: string[] };
    let categories: string[] = [];
    let director = '';

    if (this.extractExtendedMetadata) {
      try {
        const extMeta = await this.extractExtendedMetadata(page);
        metadata = { title: extMeta.title, tags: extMeta.tags, actors: extMeta.actors };
        categories = extMeta.categories;
        director = extMeta.director;
      } catch {
        metadata = await this.extractMetadata(page);
      }
    } else {
      metadata = await this.extractMetadata(page);
    }

    await this.clickPlayButton(page);

    await page.waitForTimeout(1000);

    const jsM3u8 = await this.scanJsForM3U8(page);
    capturedM3U8.push(...jsM3u8);

    try {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        try {
          const iframeM3u8 = await frame.evaluate(() => {
            const urls: string[] = [];
            try {
              const playerData = window.player_aaaa;
              if (playerData && typeof playerData.url === 'string') {
                const url = playerData.url.trim();
                if (url.includes('.m3u8') || url.includes('.m3u')) {
                  urls.push(url);
                }
                try {
                  const decoded = decodeURIComponent(url);
                  if (decoded !== url && (decoded.includes('.m3u8') || decoded.includes('.m3u'))) {
                    urls.push(decoded);
                  }
                } catch {}
                try {
                  const decoded = atob(url);
                  if (decoded.includes('.m3u8') || decoded.includes('.m3u')) {
                    urls.push(decoded);
                  }
                } catch {}
              }
            } catch {}
            return urls;
          });
          capturedM3U8.push(...iframeM3u8);
        } catch {
        }
      }
    } catch {
    }

    logger.infoT('log.scrape.capturedM3u8', { url: pageUrl, count: capturedM3U8.length, urls: capturedM3U8.join(', ') });

    const m3u8Url = this.selectBestM3U8(capturedM3U8);

    return {
      m3u8_url: m3u8Url,
      title: metadata.title,
      page_url: pageUrl,
      tags: metadata.tags,
      actors: metadata.actors,
      categories,
      director,
    };
  }
}
