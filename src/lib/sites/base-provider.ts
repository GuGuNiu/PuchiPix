/**
 * sites/base-provider.ts — 站点提供者抽象基类
 *
 * 封装所有站点通用的爬取逻辑，子类只需覆写站点特定的配置和方法：
 * - 搜索 URL 构造方式（buildSearchUrl）
 * - 搜索结果选择器（searchResultSelectors）
 * - 标题清洗规则（cleanTitle）
 * - URL 匹配规则（matchesUrl）
 * - 播放按钮选择器（playButtonSelectors）
 * - M3U8 排除关键词（m3u8ExcludePatterns）
 *
 * 通用逻辑包括：
 * 1. M3U8 网络请求拦截（过滤广告/统计 URL）
 * 2. 搜索结果页 DOM 解析（通用 + 站点特有选择器）
 * 3. 视频标题提取（document.title / OG title）
 * 4. 标签提取（meta keywords / DOM 选择器）
 * 5. 演员提取（JSON-LD / DOM 选择器 / 正则匹配）
 * 6. 播放按钮自动点击（触发 M3U8 请求）
 * 7. 页面 JS 内嵌 M3U8 URL 扫描
 * 8. M3U8 URL 去重与优先级排序
 */

import type { Page } from 'playwright';
import type { SiteProvider, SiteSearchResult, ExtendedMetadata } from './types';
import type { ScrapeResult } from '@/types';

// ============================================================
// 通用常量
// ============================================================

/** 演员/主演正则匹配模式（中英文），所有站点通用 */
const ACTOR_PATTERNS = [
  { pattern: /主演[：:]\s*(.+)/, group: 1 },
  { pattern: /演员[：:]\s*(.+)/, group: 1 },
  { pattern: /艺人[：:]\s*(.+)/, group: 1 },
  { pattern: /出演[：:]\s*(.+)/, group: 1 },
  { pattern: /女优[：:]\s*(.+)/, group: 1 },
  { pattern: /男优[：:]\s*(.+)/, group: 1 },
  { pattern: /主役[：:]\s*(.+)/, group: 1 },
  { pattern: /监督[：:]\s*(.+)/, group: 1 },
  { pattern: /Starring[：:]\s*(.+)/i, group: 1 },
  { pattern: /Actress[：:]\s*(.+)/i, group: 1 },
  { pattern: /Actor[：:]\s*(.+)/i, group: 1 },
  { pattern: /Cast[：:]\s*(.+)/i, group: 1 },
  { pattern: /出演者[：:]\s*(.+)/, group: 1 },
];

/** 通用播放按钮选择器（所有站点共用） */
const DEFAULT_PLAY_BUTTON_SELECTORS = [
  '.play-btn', '.player-play', '.video-play',
  '[onclick*="play"]', '.play-button', '.start-btn',
  '.btn-play', '.play-icon', '[id*="play"]',
  '[class*="play"]', '[class*="player"]',
];

/** 通用 M3U8 排除关键词 */
const DEFAULT_M3U8_EXCLUDE_PATTERNS = ['ad', 'stat', 'analytics', 'tracker', 'beacon'];

/** 通用搜索结果选择器（MacCMS / 常见 CMS 标准） */
const DEFAULT_SEARCH_RESULT_SELECTORS = [
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

/** 搜索结果列表中匹配日期文本的正则（YYYY-MM-DD / YYYY-MM / YYYY） */
const DATE_PATTERNS = [
  /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/,
  /\b(\d{4}[-/]\d{1,2})\b/,
  /\b(\d{4})\b/,
];

/** 通用搜索结果列表项中的日期选择器 */
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

/** 通用标签选择器 */
const DEFAULT_TAG_SELECTORS = '.category a, .tag a, .tags a, [class*="tag"] a';

/** 通用演员选择器 */
const DEFAULT_ACTOR_SELECTORS = [
  '.actor a', '.actors a', '.star a', '.stars a',
  '.cast a', '.performer a', '.model a',
  '[class*="actor"] a', '[class*="star"] a',
  '[class*="performer"] a', '[class*="model"] a',
  '.avatar-name', '.actor-name', '.star-name',
  '[class*="kv"] a', '.celebrity a',
  '.video-actor', '.media-star',
];

// ============================================================
// 抽象基类
// ============================================================

/**
 * 站点提供者抽象基类。
 *
 * 提供所有通用的爬取逻辑实现，子类只需覆写抽象方法和配置属性。
 */
export abstract class BaseSiteProvider implements SiteProvider {
  // ============================================================
  // 抽象属性（子类必须实现）
  // ============================================================

  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  abstract readonly enabled: boolean;

  // ============================================================
  // 可覆写的配置属性（带默认值）
  // ============================================================

  /** 搜索结果页 CSS 选择器列表，子类可覆写以添加站点特有选择器 */
  readonly searchResultSelectors: string[] = DEFAULT_SEARCH_RESULT_SELECTORS;

  /** 播放按钮选择器 */
  readonly playButtonSelectors: string[] = DEFAULT_PLAY_BUTTON_SELECTORS;

  /** M3U8 排除关键词 */
  readonly m3u8ExcludePatterns: string[] = DEFAULT_M3U8_EXCLUDE_PATTERNS;

  /** 标签 DOM 选择器 */
  readonly tagSelectors: string = DEFAULT_TAG_SELECTORS;

  /** 演员 DOM 选择器 */
  readonly actorSelectors: string[] = DEFAULT_ACTOR_SELECTORS;

  /** 搜索结果列表中日期元素的 CSS 选择器 */
  readonly dateSelectors?: string[] = DEFAULT_DATE_SELECTORS;

  // ============================================================
  // 抽象方法（子类必须实现）
  // ============================================================

  /** 构造搜索 URL（站点特有路由） */
  abstract buildSearchUrl(keyword: string): string;

  /** 清洗标题（去除站点前缀/后缀） */
  abstract cleanTitle(rawTitle: string): string;

  /** 判断 URL 是否属于该站点 */
  abstract matchesUrl(url: string): boolean;

  // ============================================================
  // 通用实现
  // ============================================================

  /**
   * 从搜索结果页面提取视频链接列表（含发布日期）。
   *
   * 使用 searchResultSelectors 中的 CSS 选择器遍历 DOM，
   * 过滤出视频详情页链接（包含 /vod/ 路径的链接），
   * 并通过 dateSelectors 从列表项中提取发布日期。
   *
   * @param page - 已导航到搜索页的 Playwright Page
   * @returns 视频链接数组（url + title + coverUrl + date）
   */
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
          document.querySelectorAll(sel).forEach((el) => {
            const href = (el as HTMLAnchorElement).href;
            const text = el.textContent?.trim() || '';
            const titleAttr = el.getAttribute('title') || '';

            // 只保留视频详情页链接
            if (href && href.includes('/vod') && !seen.has(href)) {
              if (
                href.includes('/vod/detail/') ||
                href.includes('/vod/play/') ||
                href.includes('/vod/show/') ||
                href.match(/\/vod\/\d+/)
              ) {
                seen.add(href);

                // 增强标题提取：从多个来源尝试获取标题
                let title = titleAttr || text || '';

                // 如果标题为空，尝试从父容器中的标题元素提取
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

                // 如果标题仍为空，尝试从 img 的 alt 属性提取
                if (!title) {
                  const img = el.querySelector('img') ||
                    el.closest('li,div')?.querySelector('img');
                  if (img) {
                    title = img.getAttribute('alt') || '';
                  }
                }

                // 提取封面图
                const img = el.querySelector('img') ||
                  el.closest('li,div')?.querySelector('img');
                const coverUrl =
                  img?.getAttribute('data-original') ||
                  img?.getAttribute('data-src') ||
                  img?.getAttribute('src') ||
                  undefined;

                // 提取发布日期
                let date: string | undefined;
                const container = el.closest('li, div, .item, .module-item, .stui-vodlist__item, .vodlist_item, .searchlist_item');
                if (container) {
                  // 尝试从日期选择器匹配的元素中提取
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

                  // 兜底：从容器文本中匹配日期模式
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
   * 从视频页面提取元信息（标题、标签、演员）。
   *
   * @param page - 已导航到视频页的 Playwright Page
   * @returns 包含清洗后标题、标签数组、演员数组的对象
   */
  async extractMetadata(page: Page): Promise<{
    title: string;
    tags: string[];
    actors: string[];
  }> {
    // ----------------------------------------------------------
    // 1. 提取原始标题（document.title 或 OG title）
    // ----------------------------------------------------------
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

    // 使用站点特定的标题清洗逻辑
    const title = this.cleanTitle(rawTitle);

    // ----------------------------------------------------------
    // 2. 提取标签
    // ----------------------------------------------------------
    const tags = await page.evaluate((tagSel: string) => {
      const tagList: string[] = [];

      // 从 meta keywords 提取
      const metaKeywords = document.querySelector('meta[name="keywords"]');
      if (metaKeywords) {
        const content = metaKeywords.getAttribute('content');
        if (content) {
          tagList.push(
            ...content
              .split(/[,;，；]/)
              .map((t) => t.trim())
              .filter((t) => t && !t.includes(' - ') && t.length < 50)
          );
        }
      }

      // 从 OG 标签提取
      document.querySelectorAll('meta[property*="tag"], meta[name*="tag"]').forEach((el) => {
        const content = el.getAttribute('content');
        if (content) tagList.push(content.trim());
      });

      // 从分类链接提取
      document.querySelectorAll(tagSel).forEach((el) => {
        const text = el.textContent?.trim();
        if (text && text.length < 50) tagList.push(text);
      });

      return [...new Set(tagList)];
    }, this.tagSelectors);

    // ----------------------------------------------------------
    // 3. 提取演员/作者
    // ----------------------------------------------------------
    const actors = await page.evaluate((actorSels: string[]) => {
      const actorList: string[] = [];

      // 从 JSON-LD 提取
      try {
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        jsonLdScripts.forEach((script) => {
          try {
            const data = JSON.parse(script.textContent || '{}');
            const crawlActor = (obj: Record<string, unknown>) => {
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
            // 忽略 JSON 解析错误
          }
        });
      } catch {
        // 忽略
      }

      // 从 DOM 选择器提取
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

    // 从页面文本中通过正则匹配演员
    const pageText = await page.evaluate(() => document.body.innerText || '');
    for (const { pattern, group } of ACTOR_PATTERNS) {
      const match = pageText.match(pattern);
      if (match && match[group]) {
        const names = match[group]
          .split(/[,，、/|&]/)
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
   * 默认的扩展元信息提取实现。
   *
   * 基类提供默认实现，委托给 extractMetadata。
   * 子类可覆写此方法以提供更丰富的元信息提取。
   *
   * @param page - 已导航到视频页的 Playwright Page
   * @returns 扩展元信息对象
   */
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

  /**
   * 自动点击播放按钮，触发 M3U8 请求。
   *
   * 遍历 playButtonSelectors 中的选择器，点击第一个可见的播放按钮。
   *
   * @param page - Playwright Page 实例
   */
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
          // 继续尝试下一个选择器
        }
      }
    } catch {
      // 自动点击是尽力而为
    }
  }

  /**
   * 扫描页面 JS 中内嵌的 M3U8 URL。
   *
   * 提取顺序：
   * 1. 直接访问全局 player_aaaa 变量（MacCMS 标准）
   * 2. 正则匹配 player_aaaa 赋值语句（fallback）
   * 3. 正则扫描所有 script 中的 m3u8 URL
   *
   * @param page - Playwright Page 实例
   * @returns 找到的 M3U8 URL 数组
   */
  async scanJsForM3U8(page: Page): Promise<string[]> {
    try {
      return page.evaluate(() => {
        const urls: string[] = [];
        const tryAddUrl = (rawUrl: string) => {
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

        // 1. 直接访问全局 player_aaaa 变量
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const playerData = (window as any).player_aaaa;
          if (playerData && typeof playerData.url === 'string') {
            tryAddUrl(playerData.url);
          }
        } catch {}

        // 2. 正则匹配 player_aaaa 赋值语句（fallback）
        if (urls.length === 0) {
          try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
              const content = script.textContent || script.innerHTML || '';
              const match = content.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;/);
              if (match) {
                const playerData = JSON.parse(match[1]);
                if (playerData.url && typeof playerData.url === 'string') {
                  tryAddUrl(playerData.url);
                }
                break;
              }
            }
          } catch {}
        }

        // 3. 正则扫描所有 script 中的 m3u8 URL
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
   * 从捕获的 M3U8 URL 列表中选择最佳的一个。
   *
   * 排序规则：
   * 1. 优先选择包含高分辨率标识的 URL（1080p、4K 等）
   * 2. 其次选择 URL 较长的（通常包含更多参数）
   *
   * @param urls - 捕获到的 M3U8 URL 数组
   * @returns 最佳 M3U8 URL，无匹配则返回空字符串
   */
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
   * 设置 M3U8 网络请求拦截器。
   *
   * 拦截所有网络请求，捕获包含 .m3u8 的 URL，
   * 过滤掉广告/统计相关的 URL。
   *
   * @param page - Playwright Page 实例
   * @param captured - 用于存储捕获结果的数组
   */
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

  /**
   * 执行完整的视频页面爬取流程。
   *
   * 流程：
   * 1. 设置 M3U8 请求拦截器
   * 2. 等待页面加载
   * 3. 提取标题、标签、演员
   * 4. 点击播放按钮触发 M3U8 请求
   * 5. 扫描 JS 中的内嵌 M3U8 URL
   * 6. 去重并选择最佳 M3U8 URL
   *
   * @param page - 已导航到视频页的 Playwright Page
   * @param pageUrl - 视频页面 URL
   * @returns 爬取结果
   */
  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const capturedM3U8: string[] = [];

    // 1. 设置 M3U8 拦截器（passive listener，不阻塞请求）
    this.setupM3U8Interceptor(page, capturedM3U8);

    // 2. 等待页面加载稳定
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
    } catch {
      // 超时非致命
    }

    // 3. 提取元信息（优先使用扩展元信息以获取分类、导演等）
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

    // 4. 点击播放按钮
    await this.clickPlayButton(page);

    // 等待 M3U8 请求触发
    await page.waitForTimeout(1000);

    // 5. 扫描主页面 JS 中的 M3U8
    const jsM3u8 = await this.scanJsForM3U8(page);
    capturedM3U8.push(...jsM3u8);

    // 5.1 扫描 iframe 中的 player_aaaa（MacCMS 播放器通常在 iframe 内）
    try {
      const frames = page.frames();
      for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        try {
          const iframeM3u8 = await frame.evaluate(() => {
            const urls: string[] = [];
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const playerData = (window as any).player_aaaa;
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
          // 跨域 iframe 无法访问
        }
      }
    } catch {
      // 忽略
    }

    console.log(`[Scrape] ${pageUrl} — 捕获到 ${capturedM3U8.length} 个 M3U8 URL: ${capturedM3U8.join(', ')}`);

    // 6. 选择最佳 M3U8
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
