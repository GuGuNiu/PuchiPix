import type { Page } from 'playwright';
import { BaseSiteProvider } from '../base-provider';
import type { M3U8Candidate } from '@/types';
import type { ScrapeResult } from '@/types';
import type { BlockCheckResult } from '../types';
import { removePublisherPrefix } from '@/lib/utils/title-cleaner';

export class UniversalProvider extends BaseSiteProvider {
  readonly id = 'universal';
  readonly name = '通用下载器';
  readonly baseUrl = '';
  readonly enabled = true;

  readonly playButtonSelectors = [
    '.play-btn', '.player-play', '.video-play',
    '[onclick*="play"]', '.play-button', '.start-btn',
    '.btn-play', '.play-icon', '[id*="play"]',
    '[class*="play"]', '[class*="player"]',
    'video', '.video-js', '.vjs-tech', '.jw-video',
    '.plyr', '.dplayer', '.art-video',
    '[data-player]', '.player-container video',
  ];

  /**
   * ConstructSearch URL。
   *
   */
  buildSearchUrl(keyword: string): string {
    return keyword;
  }

  
  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';
    let title = rawTitle.trim();

    title = removePublisherPrefix(title);

    const suffixPatterns = [
      /\s*[-—–|]\s*在线播放.*$/i,
      /\s*[-—–|]\s*在线观看.*$/i,
      /\s*[-—–|]\s*免费.*$/i,
      /\s*[-—–|]\s*高清.*$/i,
    ];
    for (const pattern of suffixPatterns) {
      title = title.replace(pattern, '');
    }

    return title.trim();
  }

  
  matchesUrl(_url: string): boolean {
    return false;
  }

  
  checkContentBlocked(
    _title: string,
    _category: string,
    _protagonist?: string
  ): BlockCheckResult {
    return { blocked: false, reason: undefined };
  }

  /**
   *
   *
   * @returns [url]
   */
  getAdaptiveUrls(url: string): string[] {
    return [url];
  }

  /**
   *
   *
   * @returns [keyword]
   */
  getAdaptiveSearchUrls(keyword: string): string[] {
    return [keyword];
  }

  /**
   * Extract title from URL path (last segment, strip extension),
   * check for resolution markers (1080p, 720p), bitrate markers,
   * and episode numbers (ep1, ep2) in the URL.
   *
   * @param url - M3U8 URL
   */
  private guessM3U8Title(url: string, pageTitle: string): string {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || '';

      const name = lastSegment.replace(/\.(m3u8|m3u)$/i, '').replace(/[?#].*$/, '');

      const resolutionMatch = url.match(/(\d{3,4})x(\d{3,4})/i);
      if (resolutionMatch) {
        return `${name || pageTitle} (${resolutionMatch[1]}x${resolutionMatch[2]})`;
      }

      const resKeywords: Array<[RegExp, string]> = [
        [/1080p|1080/i, '1080p'],
        [/720p|720/i, '720p'],
        [/480p|480/i, '480p'],
        [/360p|360/i, '360p'],
        [/4k|2160/i, '4K'],
      ];
      for (const [pattern, label] of resKeywords) {
        if (pattern.test(url)) {
          return `${name || pageTitle} (${label})`;
        }
      }

      const bitrateMatch = url.match(/(\d{3,5})\s*kbps/i) || url.match(/(\d)M\b/i);
      if (bitrateMatch) {
        return `${name || pageTitle} (${bitrateMatch[0]})`;
      }

      const epMatch = url.match(/(?:ep|episode|part|第)(\d{1,3})/i);
      if (epMatch) {
        return `${name || pageTitle} (第${epMatch[1]}集)`;
      }

      if (name && name.length > 2) {
        return name;
      }

      if (pageTitle) {
        return pageTitle;
      }

      return parsed.hostname;
    } catch {
      return url.length > 50 ? `${url.substring(0, 50)}...` : url;
    }
  }

  
  private deduplicateM3U8(urls: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const url of urls) {
      const normalized = url.split('?')[0].split('#')[0];
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(url);
      }
    }

    return result;
  }

  
  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const capturedM3U8: string[] = [];

    this.setupM3U8Interceptor(page, capturedM3U8);

    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch {
    }

    let metadata: { title: string; tags: string[]; actors: string[] };
    try {
      metadata = await this.extractMetadata(page);
    } catch {
      metadata = { title: '', tags: [], actors: [] };
    }

    await this.clickPlayButton(page);

    await page.waitForTimeout(1500);

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

    try {
      const videoSrcM3u8 = await page.evaluate(() => {
        const urls: string[] = [];
        document.querySelectorAll('video source[src*=".m3u8"], video[src*=".m3u8"]').forEach((el) => {
          const src = el.getAttribute('src') || '';
          if (src) urls.push(src);
        });
        return urls;
      });
      capturedM3U8.push(...videoSrcM3u8);
    } catch {
    }

    console.log(
      `[UniversalScrape] ${pageUrl} — captured ${capturedM3U8.length} M3U8 URLs: ${capturedM3U8.join(', ')}`,
    );

    const filtered = this.deduplicateM3U8(capturedM3U8).filter((url) => {
      const pathLower = url.toLowerCase();
      return !this.m3u8ExcludePatterns.some((p) => pathLower.includes(p));
    });

    const m3u8Url = this.selectBestM3U8(filtered);

    let m3u8Candidates: M3U8Candidate[] | undefined;
    if (filtered.length > 1) {
      m3u8Candidates = filtered.map((url) => ({
        url,
        title: this.guessM3U8Title(url, metadata.title),
      }));
    }

    return {
      m3u8_url: m3u8Url,
      m3u8_candidates: m3u8Candidates,
      title: metadata.title,
      page_url: pageUrl,
      tags: metadata.tags,
      actors: metadata.actors,
      categories: [],
      director: '',
    };
  }
}
