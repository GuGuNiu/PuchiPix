import type { Page } from 'playwright';
import { BaseSiteProvider } from '../base-provider';
import type { ExtendedMetadata, GallerySiteProvider, SiteSearchResult } from '../types';
import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
  GalleryZipInfo,
  ScrapeResult,
} from '@/types';
import { MAX_GALLERY_PAGES, PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep, buildAntiCrawlerHeaders } from '@/lib/core/anti-crawler';
import { DomainHealthTracker, shuffleDomainList } from '@/lib/core/domain-health-tracker';
import { detectWaf } from '@/lib/core/waf-detector';
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';
import { getProtagonistService } from '@/lib/protagonist/protagonist-service';
import * as cheerio from 'cheerio';
import {
  BLOCKED_TITLE_KEYWORDS,
  BLOCKED_CATEGORIES,
  BLOCKED_PROTAGONISTS,
  BLOCKED_PROTAGONISTS_ENABLED,
} from '../config/aimeizizi-config';
import { getBlocklistService } from '../blocklist-service';

interface GalleryPageMetadata {
  h1Title: string;
  rawTitle: string;
  tags: string[];
  category: string;
  coverUrl: string;
  publishTime: string;
  currentPage: number;
  totalPages: number;
  images: { url: string; pageIndex: number }[];
  videos: string[];
}

/** 站点镜像域名列表（优先级从高到低，随机起始） */
const SITE_DOMAINS = [
  'https://www.lovecutes.com',
  'https://xx.knit.bid',
  'https://www.lovecutes.net',
];

/** 占位图 URL 片段（懒加载时 src 中的占位 GIF） */
const PLACEHOLDER_FRAGMENT = '/static/zde/timg.gif';

/** 站点后缀模式（用于标题清洗） */
const SITE_SUFFIX_PATTERN = /\s*[-—–]\s*[^-]+[-—–]\s*爱妹子\s*$/;

function parseFileSize(text: string): number {
  const match = text.trim().match(/^([\d.]+)\s*([KMGT]B?|B)$/i);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase().replace('B', '');
  const multipliers: Record<string, number> = {
    B: 1,
    K: 1024,
    M: 1024 * 1024,
    G: 1024 * 1024 * 1024,
    T: 1024 * 1024 * 1024 * 1024,
  };
  return Math.floor(value * (multipliers[unit] || 1));
}

export function extractArticleId(url: string): string | null {
  const match = url.match(/\/article\/(\d+)/);
  return match ? match[1] : null;
}

function replaceDomain(url: string, targetDomain: string): string {
  return url.replace(/^https?:\/\/[^/]+/, targetDomain);
}

/**
 * 从完整 URL 中提取域名（协议 + 主机名）
 *
 * 用于从文章 URL 提取域名，传给 DomainHealthTracker。
 *
 * @param url - 完整 URL
 * @returns 域名（如 'https://www.lovecutes.com'），解析失败返回空字符串
 */
export function extractDomainFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

/** 域名健康度跟踪器单例（使用共享工具类） */
const domainHealthTracker = new DomainHealthTracker();

/**
 * 获取跳房子算法打乱的域名列表
 *
 * @returns 随机起始的域名列表
 */
function shuffleDomains(): string[] {
  return shuffleDomainList([...SITE_DOMAINS]);
}

export class AimeiziziProvider extends BaseSiteProvider implements GallerySiteProvider {
  readonly id = 'aimeizizi';
  readonly name = '爱妹子';
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

  /**
   * 标记域名为健康
   *
   * 由调用方在域名成功响应时调用，清除限流标记。
   *
   * @param domain - 域名
   */
  markDomainHealthy(domain: string): void {
    domainHealthTracker.markHealthy(domain);
  }

  // 搜索 URL 构造
  /**
   * 构造搜索页面 URL
   *
   * 使用域名健康度跟踪器选择最佳域名，避免固定使用主域名被限流。
   *
   * @param keyword - 搜索关键词
   * @returns 搜索页面 URL
   */
  buildSearchUrl(keyword: string): string {
    const domain = domainHealthTracker.getBestDomain(SITE_DOMAINS);
    return `${domain}/?s=${encodeURIComponent(keyword)}`;
  }

  /**
   * 获取搜索页面的多域名自适应 URL 列表
   *
   * 与 getAdaptiveUrls 类似，但用于搜索 URL。
   * 健康域名优先，冷却中的域名排在后面。
   * 调用方依次尝试每个域名，遇到限流时标记并切换。
   *
   * @param keyword - 搜索关键词
   * @returns 按优先级排列的搜索 URL 列表
   */
  getAdaptiveSearchUrls(keyword: string): string[] {
    const encoded = encodeURIComponent(keyword);
    const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
    return orderedDomains.map((d) => `${d}/?s=${encoded}`);
  }

  // 标题清洗
  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';

    let title = rawTitle.trim();

    title = title.replace(/^\[.*?\]\s*/, '');

    title = title.replace(SITE_SUFFIX_PATTERN, '');

    title = title.replace(/\s*[-—–]\s*爱妹子\s*$/i, '');

    return title.trim();
  }

  // 主角定位
  /**
   * 从标题中智能提取主角名
   *
   * 委托给 ProtagonistService.extractFromTitleSmart 进行 6 级策略解析：
   - Person DB 已知人物子串匹配
   - 游戏角色库 identifyInText 子串匹配
   - 『』【】括号内容解析
   - 标准 "名字 - 描述" 格式 + 交叉验证
   - 标签起始匹配
   - 均不匹配返回空字符串
   *
   *
   * @param title - 图库标题（已清洗）
   * @param tags - 标签列表
   * @returns 提取到的主角名，无法确定返回空字符串
   *
   */
  async extractProtagonist(title: string, tags: string[]): Promise<string> {
    if (!title) return '';
    const service = getProtagonistService();
    const name = await service.extractFromTitleSmart(title, tags);

    // 自动学习
    if (name) {
      service.learnPerson(name).catch((err) => {
        console.warn('[Aimeizizi] learnPerson 失败:', err);
      });
    }

    return name;
  }

  extractDescription(title: string, protagonist: string): string {
    if (!title) return '';
    if (!protagonist) return title;

    let desc = title.replace(protagonist, '').replace(/^\s*[-—–]\s*/, '').trim();

    // 去除尾部的数量标记（如 "21P1V"、"70P"）
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
          return { blocked: true, reason: `标题包含屏蔽关键词: "${keyword}"` };
        }
      }
    }

    if (category) {
      for (const keyword of this.blockedCategories) {
        if (category.includes(keyword)) {
          return { blocked: true, reason: `分类包含屏蔽关键词: "${keyword}"` };
        }
      }
    }

    if (this.blockedProtagonistsEnabled && protagonist) {
      for (const blocked of this.blockedProtagonists) {
        if (protagonist === blocked || protagonist.includes(blocked)) {
          return { blocked: true, reason: `主角名被屏蔽: "${blocked}"` };
        }
      }
    }

    return { blocked: false, reason: undefined };
  }

  async checkContentBlockedAsync(
    title: string,
    category: string,
    protagonist?: string,
  ): Promise<import('../types').BlockCheckResult> {
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
  ): import('../types').BlockCheckResult {
    return this.checkBlocked(title, category, protagonist);
  }

  // URL 匹配
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

  // 搜索结果提取
  async extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
    const rawResults = await page.evaluate(() => {
      const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
      const seen = new Set<string>();
      const PLACEHOLDER = '/static/zde/timg.gif';

      const resolveUrl = (raw: string | null | undefined): string | undefined => {
        if (!raw) return undefined;
        if (raw.includes(PLACEHOLDER) || raw.includes('/static/images/Loading')) return undefined;
        if (raw.startsWith('data:')) return undefined;
        try {
          return new URL(raw, window.location.href).href;
        } catch {
          return undefined;
        }
      };

      document.querySelectorAll('article').forEach((article) => {
        const link = article.querySelector('a[href*="/article/"]') as HTMLAnchorElement;
        if (!link) return;
        const href = link.href;
        if (href && !seen.has(href)) {
          seen.add(href);

          const img = article.querySelector('img');
          const coverUrl =
            resolveUrl(img?.getAttribute('data-original-src')) ||
            resolveUrl(img?.getAttribute('data-src')) ||
            resolveUrl(img?.getAttribute('data-original')) ||
            resolveUrl(img?.getAttribute('src'));

          const titleEl = article.querySelector('h2 a') || link;
          const title =
            titleEl?.getAttribute('title') ||
            titleEl?.textContent?.trim() ||
            link.getAttribute('title') ||
            '';

          const timeEl = article.querySelector('footer time');
          const date = timeEl?.textContent?.trim() || undefined;

          results.push({ url: href, title, coverUrl, date });
        }
      });

      return results.slice(0, 30);
    });

    const filteredResults: typeof rawResults = [];
    for (const item of rawResults) {
      const check = await this.checkContentBlockedAsync(item.title, '');
      if (check.blocked) {
        console.log(`[Aimeizizi] 屏蔽搜索结果: "${item.title.substring(0, 50)}..."，原因: ${check.reason}`);
        continue;
      }
      filteredResults.push(item);
    }
    return filteredResults;
  }

  async extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
    const raw = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const h1Title = h1?.textContent?.trim() || '';

      const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"]');
      let category = '';
      if (breadcrumb) {
        const links = breadcrumb.querySelectorAll('a');
        if (links.length >= 2) {
          category = links[links.length - 1].textContent?.trim() || '';
        }
      }

      const tags: string[] = [];
      document.querySelectorAll('a[href*="/tag/"]').forEach((a) => {
        const text = a.textContent?.trim();
        if (text && text !== '标签' && text.length < 30 && !tags.includes(text)) {
          tags.push(text);
        }
      });

      const metaKeywords = document.querySelector('meta[name="keywords"]');
      const keywordStr = metaKeywords?.getAttribute('content') || '';

      let coverUrl = '';
      const article = document.querySelector('article');
      if (article) {
        const imgs = article.querySelectorAll('img');
        for (const img of imgs) {
          const src = img.getAttribute('src') || '';
          const dataSrc = img.getAttribute('data-src') || '';
          const url = dataSrc || src;
          if (url && !url.includes('/static/zde/timg.gif') && !url.includes('/static/images/Loading')) {
            coverUrl = url;
            break;
          }
        }
      }

      return { h1Title, category, tags, keywordStr, coverUrl, documentTitle: document.title };
    });

    const title = this.cleanTitle(raw.h1Title || raw.documentTitle);
    const protagonist = await this.extractProtagonist(title, raw.tags);

    const metaKeywords = raw.keywordStr
      .split(/[,，;；]/)
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

  private async extractGalleryPageData(page: Page, pageIndex: number): Promise<GalleryPageMetadata> {
    return page.evaluate(
      ({ pageIndex, placeholderFragment }) => {
        const result: GalleryPageMetadata = {
          h1Title: '',
          rawTitle: '',
          tags: [],
          category: '',
          coverUrl: '',
          publishTime: '',
          currentPage: 1,
          totalPages: 1,
          images: [],
          videos: [],
        };

        const h1 = document.querySelector('h1');
        result.h1Title = h1?.textContent?.trim() || '';
        result.rawTitle = document.title;

        const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"]');
        if (breadcrumb) {
          const links = breadcrumb.querySelectorAll('a');
          if (links.length >= 2) {
            result.category = links[links.length - 1].textContent?.trim() || '';
          }
        }

        document.querySelectorAll('a[href*="/tag/"]').forEach((a) => {
          const text = a.textContent?.trim();
          if (text && text !== '标签' && text.length < 30 && !result.tags.includes(text)) {
            result.tags.push(text);
          }
        });

        // 分页信息
        const navs = document.querySelectorAll('nav');
        navs.forEach((nav) => {
          const text = nav.textContent || '';
          const match = text.match(/第\s*(\d+)\s*[頁页].*?共\s*(\d+)\s*[頁页]/);
          if (match) {
            result.currentPage = parseInt(match[1]);
            result.totalPages = parseInt(match[2]);
          }
        });

        // 图片采集
        const article = document.querySelector('article');
        if (article) {
          const imgs = article.querySelectorAll('img');
          imgs.forEach((img) => {
            const src = img.getAttribute('src') || '';
            const dataSrc = img.getAttribute('data-src') || '';
            const url = dataSrc || src;

            if (
              url &&
              !url.includes(placeholderFragment) &&
              !url.includes('/static/images/Loading') &&
              !url.includes('data:image/')
            ) {
              result.images.push({ url, pageIndex });
            }
          });
        }

        // 视频采集
        document.querySelectorAll('video source[src*=".m3u8"]').forEach((source) => {
          const src = source.getAttribute('src') || '';
          if (src) result.videos.push(src);
        });

        document.querySelectorAll('video source[src*=".mp4"]').forEach((source) => {
          const src = source.getAttribute('src') || '';
          if (src && !result.videos.includes(src)) {
            result.videos.push(src);
          }
        });

        document.querySelectorAll('script').forEach((script) => {
          const content = script.textContent || '';
          const matches = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
          if (matches) {
            matches.forEach((url) => {
              if (!result.videos.includes(url)) {
                result.videos.push(url);
              }
            });
          }
        });

        // 封面图
        if (article) {
          const imgs = article.querySelectorAll('img');
          for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            const dataSrc = img.getAttribute('data-src') || '';
            const url = dataSrc || src;
            if (url && !url.includes(placeholderFragment) && !url.includes('/static/images/Loading')) {
              result.coverUrl = url;
              break;
            }
          }
        }

        // 发布时间
        document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
          if (result.publishTime) return;
          try {
            const data = JSON.parse(script.textContent || '');
            if (data['@type'] === 'VideoObject' && data.uploadDate) {
              result.publishTime = String(data.uploadDate).substring(0, 10);
            }
          } catch {}
        });

        if (!result.publishTime && result.coverUrl) {
          const match = result.coverUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
          if (match) {
            result.publishTime = `${match[1]}-${match[2]}-${match[3]}`;
          }
        }

        return result;
      },
      { pageIndex, placeholderFragment: PLACEHOLDER_FRAGMENT },
    );
  }

  // ZIP 下载信息提取
  /**
   * 从页面提取 ZIP 压缩包下载信息
   *
   * 页面结构：
   * - .download-info-box：文件数量、大小、尺寸、密码等元信息
   * - .download-section：包含 data-eligibility-url、data-page-id、data-next-url 等 data 属性
   * - .btn-download：下载按钮，初始 href="#"，JS 权限检查后更新为实际链接
   *
   * 下载链接获取流程（无需登录）：
   - 页面 JS 异步调用 /api/download/eligibility?page_id=xxx&next=/article/xxx/ 检查权限
   - 若 can_download=true，resolved_links 包含实际跳转 URL（通常为 ouo.io 短链接）
   - 按钮的 href 被更新为跳转 URL，class 移除 is-pending
   - 若 can_download=false（新文章时间门控），按钮 href 指向登录页，class 为 is-locked
   *
   * 注意：按钮 JS 更新可能延迟（is-pending 未及时移除），
   * 因此始终主动调用 eligibility API 确保获取 resolved_links。
   *
   */
  private async extractZipDownloadInfo(page: Page): Promise<GalleryZipInfo | undefined> {
    const zT0 = Date.now();
    const zLog = (msg: string): void => console.log(`[ZipInfoTiming] ${Date.now() - zT0}ms — ${msg}`);
    zLog('开始提取 ZIP 下载信息');

    // 快速检测：如果两个关键元素都不存在，直接跳过（避免各 5s 超时浪费）
    const [boxEl, btnEl] = await Promise.all([
      page.$('.download-info-box'),
      page.$('.btn-download'),
    ]);
    if (!boxEl && !btnEl) {
      zLog('无下载信息元素，跳过提取');
      return undefined;
    }
    zLog(`元素检测: box=${!!boxEl}, btn=${!!btnEl}`);

    // 仅在元素存在时等待其稳定
    if (boxEl) {
      await page.waitForSelector('.download-info-box', { timeout: 2000 }).catch(() => {});
    }
    if (btnEl) {
      await page.waitForSelector('.btn-download', { timeout: 2000 }).catch(() => {});
    }
    zLog('等待选择器完成');

    // 等待权限检查 JS 执行（is-pending 或 is-locked 状态确定）
    // 仅在按钮存在时等待
    if (btnEl) {
      await page.waitForFunction(() => {
        const btn = document.querySelector('.btn-download');
        if (!btn) return true;
        return !btn.classList.contains('is-pending');
      }, { timeout: 5000 }).catch(() => {});
    }
    zLog('等待 is-pending 移除完成');

    const raw = await page.evaluate(() => {
      const section = document.querySelector('.download-section');
      const box = document.querySelector('.download-info-box');

      if (!box && !section) return null;

      const titleEl = box?.querySelector('.info-title');
      const title = titleEl?.textContent?.trim() || '';

      let fileCount = 0;
      let fileSizeText = '';
      let imageDimensions = '';
      let password = '';

      if (box) {
        const items = box.querySelectorAll('.info-item');
        items.forEach((item) => {
          const label = item.querySelector('strong')?.textContent?.trim() || '';
          const text = item.textContent?.replace(label, '').trim() || '';

          if (label.includes('文件数量') || label.includes('Files')) {
            const m = text.match(/(\d+)/);
            if (m) fileCount = parseInt(m[1]);
          } else if (label.includes('文件大小') || label.includes('Size')) {
            fileSizeText = text;
          } else if (label.includes('图片尺寸') || label.includes('Dimensions')) {
            imageDimensions = text;
          } else if (label.includes('密码') || label.includes('Password')) {
            const input = item.querySelector('.password-input') as HTMLInputElement | null;
            password = input?.value || text;
          }
        });
      }

      const downloadBtn = document.querySelector('.btn-download') as HTMLAnchorElement | null;
      let downloadUrl = '';
      let provider = '';
      let requiresLogin = false;
      let requiresEmail = false;

      if (downloadBtn) {
        provider = downloadBtn.getAttribute('data-provider') || '';
        const href = downloadBtn.getAttribute('href') || '';
        const label = downloadBtn.querySelector('.download-label')?.textContent?.trim() || '';

        if (provider === 'mediafire' || label.toLowerCase().includes('mediafire')) {
          provider = 'MediaFire';
        }

        if (href && href.startsWith('http') && href !== '#') {
          downloadUrl = href;
        } else if (href && href.startsWith('/') && !href.includes('/auth/login') && href !== '#') {
          downloadUrl = new URL(href, window.location.href).href;
        }

        if (downloadBtn.classList.contains('is-locked') || href.includes('/auth/login')) {
          requiresLogin = true;
        }
      }

      const noticeEl = document.querySelector('.download-notice-text');
      const noticeText = noticeEl?.textContent?.trim() || '';
      if (noticeText.includes('登录') || noticeText.includes('Login')) {
        requiresLogin = true;
      }
      if (noticeText.includes('邮箱') || noticeText.includes('验证') || noticeText.includes('Verify')) {
        requiresEmail = true;
      }

      // 提取 data 属性，用于后续 eligibility API 调用
      const pageId = section?.getAttribute('data-page-id') || '';
      const eligibilityUrl = section?.getAttribute('data-eligibility-url') || '/api/download/eligibility';
      const nextUrl = section?.getAttribute('data-next-url') || '';

      return {
        title,
        fileCount,
        fileSizeText,
        imageDimensions,
        password,
        downloadUrl,
        provider,
        requiresLogin,
        requiresEmail,
        pageId,
        eligibilityUrl,
        nextUrl,
      };
    });

    if (!raw) return undefined;
    if (!raw.fileCount && !raw.fileSizeText && !raw.downloadUrl) return undefined;

    const zipInfo: GalleryZipInfo = {
      title: raw.title,
      fileCount: raw.fileCount,
      fileSizeText: raw.fileSizeText,
      imageDimensions: raw.imageDimensions,
      password: raw.password,
      downloadUrl: raw.downloadUrl,
      provider: raw.provider,
      requiresLogin: raw.requiresLogin,
      requiresEmail: raw.requiresEmail,
    };

    // 始终主动调用 eligibility API，确保获取 resolved_links
    // 按钮可能仍处于 is-pending 状态，但 API 已返回可用链接
    if (raw.pageId) {
      const nextParam = raw.nextUrl || `/article/${raw.pageId}/`;
      const apiUrl = `${raw.eligibilityUrl}?page_id=${raw.pageId}&next=${encodeURIComponent(nextParam)}`;

      try {
        zLog('开始调用 eligibility API');
        const eligResult = await page.evaluate(async (url) => {
          const resp = await fetch(url, { credentials: 'include' });
          return resp.json();
        }, apiUrl);
        zLog('eligibility API 调用完成');

        if (eligResult?.resolved_links && Array.isArray(eligResult.resolved_links) && eligResult.resolved_links.length > 0) {
          zipInfo.downloadUrl = eligResult.resolved_links[0];
          zipInfo.requiresLogin = false;
        }

        if (eligResult?.requires_registration) {
          zipInfo.requiresLogin = true;
        }
        if (eligResult?.requires_email_verification) {
          zipInfo.requiresEmail = true;
        }
      } catch {
        zLog('eligibility API 调用失败');
      }
    }
    zLog('ZIP 下载信息提取完成');
    return zipInfo;
  }

  // 图库完整爬取（GallerySiteProvider 实现）
  async scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult> {
    const sT0 = Date.now();
    const sLog = (msg: string): void => console.log(`[ScrapeGalleryTiming] ${Date.now() - sT0}ms — ${msg}`);
    sLog('开始');

    const firstPageData = await this.extractGalleryPageData(page, 0);
    sLog(`第一页数据提取完成: ${firstPageData.images.length} 张图片, ${firstPageData.videos.length} 个视频, 总页数=${firstPageData.totalPages}`);

    const totalPages = Math.min(firstPageData.totalPages, MAX_GALLERY_PAGES);

    const allImages: GalleryImageItem[] = [];
    const allVideos: GalleryVideoItem[] = [];
    const videoUrlSet = new Set<string>();
    const imageUrlSet = new Set<string>();

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
    sLog(`第一页图片/视频去重完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

    // 在翻页前提取 ZIP 下载信息（下载按钮只存在于第一页）
    const zipInfo = await this.extractZipDownloadInfo(page);
    sLog(`ZIP 信息提取完成: ${zipInfo ? '有' : '无'}`);

    const articleId = extractArticleId(pageUrl);
    let currentDomain = extractDomainFromUrl(pageUrl);

    // 图库翻页间隔（比搜索翻页更短，同一图包内连续翻页风险低）
    const GALLERY_PAGE_DELAY_MIN = 300;
    const GALLERY_PAGE_DELAY_MAX = 600;

    for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
      sLog(`开始翻页第 ${pageNum}/${totalPages} 页`);
      await sleep(randomDelay(GALLERY_PAGE_DELAY_MIN, GALLERY_PAGE_DELAY_MAX));

      let pageData: GalleryPageMetadata | null = null;

      // 尝试当前域名
      try {
        const pageUrlConstructed = `${pageUrl.replace(/\/$/, '')}/page/${pageNum}/`;
        const response = await page.goto(pageUrlConstructed, {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });

        const httpStatus = response?.status();
        if (httpStatus === 403 || httpStatus === 429) {
          domainHealthTracker.markRateLimited(currentDomain);
          console.warn(`[Aimeizizi] 第 ${pageNum} 页遭遇 ${httpStatus}，标记域名 ${currentDomain} 为限流`);

          if (articleId) {
            const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
            for (const fbDomain of fallbackDomains) {
              if (fbDomain === currentDomain) continue;
              const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
              try {
                const fbResp = await page.goto(fbUrl, {
                  waitUntil: 'domcontentloaded',
                  timeout: 15000,
                });
                const fbStatus = fbResp?.status();
                if (fbStatus === 403 || fbStatus === 429) {
                  domainHealthTracker.markRateLimited(fbDomain);
                  continue;
                }
                await page.waitForSelector('article', { timeout: 3000 }).catch(() => {});
                pageData = await this.extractGalleryPageData(page, pageNum - 1);
                currentDomain = fbDomain;
                domainHealthTracker.markHealthy(fbDomain);
                console.log(`[Aimeizizi] 第 ${pageNum} 页切换到域名 ${fbDomain} 成功`);
                break;
              } catch (fbErr) {
                console.warn(`[Aimeizizi] 第 ${pageNum} 页域名 ${fbDomain} 失败:`, fbErr instanceof Error ? fbErr.message : fbErr);
                continue;
              }
            }
          }
        } else {
          await page.waitForSelector('article', { timeout: 3000 }).catch(() => {});
          pageData = await this.extractGalleryPageData(page, pageNum - 1);
        }
      } catch (err) {
        console.error(`[Aimeizizi] 爬取第 ${pageNum} 页失败 (域名 ${currentDomain}):`, err);

        if (articleId) {
          const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
          for (const fbDomain of fallbackDomains) {
            if (fbDomain === currentDomain) continue;
            const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
            try {
              await page.goto(fbUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
              await page.waitForSelector('article', { timeout: 3000 }).catch(() => {});
              pageData = await this.extractGalleryPageData(page, pageNum - 1);
              currentDomain = fbDomain;
              console.log(`[Aimeizizi] 第 ${pageNum} 页切换到域名 ${fbDomain} 成功`);
              break;
            } catch {
              continue;
            }
          }
        }
      }

      // 处理页面数据（无论来自哪个域名）
      if (pageData) {
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
      }
    }

    const title = this.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
    sLog(`标题清洗完成: "${title.substring(0, 40)}"`);
    const protagonist = await this.extractProtagonist(title, firstPageData.tags);
    sLog(`主角提取完成: "${protagonist}"`);
    const description = this.extractDescription(title, protagonist);

const blockCheck = await this.checkContentBlockedAsync(title, firstPageData.category, protagonist);
if (blockCheck.blocked) {
console.log(`[Aimeizizi] 屏蔽图库爬取: "${title.substring(0, 50)}..."，原因: ${blockCheck.reason}`);
throw new Error(`内容被屏蔽: ${blockCheck.reason}`);
    }

    const metaKeywordsStr = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="keywords"]');
      return meta?.getAttribute('content') || '';
    });
    const metaKeywords = metaKeywordsStr
      .split(/[,，;；]/)
      .map((t: string) => t.trim())
      .filter((t: string) => t && t.length < 50);

    const allTags = [...new Set([...firstPageData.tags, ...metaKeywords])];

    // 识别 TAG 中的游戏角色名（原神/星穹铁道/鸣潮/碧蓝航线/碧蓝档案）
    const gameCharMatches = getGameCharacterService().identifyInTags(allTags);
    const gameCharacters = gameCharMatches.map((m) => m.character.name);
    if (gameCharacters.length > 0) {
      console.log(`[Aimeizizi] 识别到游戏角色: ${gameCharacters.join(', ')}`);
    }
    sLog(`后处理完成: tags=${allTags.length}, 游戏角色=${gameCharacters.length}`);

    // 记录实际使用的域名
    let scrapedDomain = '';
    try {
      const parsed = new URL(pageUrl);
      scrapedDomain = `${parsed.protocol}//${parsed.host}`;
    } catch {}

    sLog(`scrapeGallery 全部完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

    return {
      sourceUrl: pageUrl,
      title,
      protagonist,
      description,
      category: firstPageData.category,
      tags: allTags,
      coverUrl: this.resolveUrl(firstPageData.coverUrl),
      publishTime: firstPageData.publishTime || undefined,
      images: allImages,
      videos: allVideos,
      pageCount: totalPages,
      imageCount: allImages.length,
      videoCount: allVideos.length,
      scrapedDomain,
      zipInfo,
      gameCharacters: gameCharacters.length > 0 ? gameCharacters : undefined,
    };
  }

  // 单页爬取（SiteProvider 接口实现）
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

  /**
   * 将相对 URL 解析为绝对 URL
   *
   * 使用当前 baseUrl（主域名）作为基准。
   */
  private resolveUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('//')) {
      return `https:${url}`;
    }
    if (url.startsWith('/')) {
      return `${this.baseUrl}${url}`;
    }
    return url;
  }

  /**
   * 判断 URL 是否为列表页（标签页、搜索页、分类页等）
   *
   * 爱妹子站点的列表页 URL 模式：
   * - /tag/{id}/        标签页
   * - /?s={keyword}     搜索页
   * - /category/{slug}/ 分类页
   * - /                  首页
   * - /page/{n}/         分页列表
   *
   * 只要 URL 不包含 /article/ 就视为列表页
   *
   */
  isListingPage(url: string): boolean {
    return !url.includes('/article/');
  }

  /**
   * 爬取列表页，提取所有图包详情页链接（支持翻页）
   *
   */
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
        console.error(`[Aimeizizi] 爬取列表页第 ${pageNum} 页失败:`, err);
        break;
      }
    }

    return allResults;
  }

  /**
   * 根据列表页 URL 和页码构造分页 URL
   *
   * /tag/2333/ + page 2 → /tag/2333/page/2/
   * /?s=keyword + page 2 → /page/2/?s=keyword
   *
   * 注意：爱妹子站点不支持 ?paged=N 参数（被忽略），
   * 必须使用路径式分页 /page/N/?s=keyword
   *
   */
  private buildListingPageUrl(baseUrl: string, pageNum: number): string {
    const parsed = new URL(baseUrl);
    if (parsed.searchParams.has('s')) {
      // 爱妹子自定义主题不支持 ?paged=N，使用路径式分页
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

  /**
   * 检测页面是否有下一页
   *
   * 爱妹子站点自定义分页结构：
   * <nav class="pagination-nav">
   *   <ul class="pagination">
   *     <li class="next-page"><a href="#" data-page="2">下一页</a></li>
   *   </ul>
   * </nav>
   *
   * 同时兼容标准 WordPress 分页（.page-numbers, .nav-links）
   *
   */
  private async checkNextPage(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      // 标准 WordPress 分页
      const nextLink = document.querySelector(
        'a.next.page-numbers, nav[aria-label="Pagination"] a[rel="next"]'
      );
      if (nextLink) return true;

      // 爱妹子自定义分页：data-page 属性的链接
      const dataPageLinks = document.querySelectorAll('a[data-page]');
      if (dataPageLinks.length > 0) return true;

      // 爱妹子自定义分页：.pagination-nav .next-page
      const customNext = document.querySelector('.pagination-nav .next-page a, .next-page a');
      if (customNext) return true;

      // 通用分页链接检测
      const navLinks = document.querySelectorAll(
        'nav.pagination a, .nav-links a, .pagination-nav .pagination a'
      );
      for (const link of navLinks) {
        const text = link.textContent?.trim() || '';
        if (text.includes('下一页') || text.includes('Next') || text.includes('›') || text.includes('»')) {
          return true;
        }
      }

      // 兜底：页面有多个分页链接
      const pageNumbers = document.querySelectorAll(
        '.page-numbers, nav.pagination a, .pagination-nav .pagination a[data-page]'
      );
      return pageNumbers.length >= 2;
    });
  }

  /**
   * 获取多域名自适应 URL
   *
   * 优先返回健康域名（跳房子算法随机起始），
   * 冷却中的域名排在后面（按剩余冷却时间升序）。
   * 调用方依次尝试每个域名，遇到 403/429 时调用 markDomainRateLimited 标记，
   * 遇到 404 自动切换到下一个。
   *
   * @param articleUrl - 原始文章 URL（任意域名）
   * @returns 按优先级排列的域名 URL 列表
   */
  getAdaptiveUrls(articleUrl: string): string[] {
    const articleId = extractArticleId(articleUrl);
    if (!articleId) return [articleUrl];

    // 优先返回健康域名，冷却中的域名排在后面
    const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
    return orderedDomains.map((d) => `${d}/article/${articleId}/`);
  }

  /**
   * 将任意域名的 URL 转换为主域名 URL
   *
   * 用于数据库存储归一化：同一图包无论从哪个域名爬取，
   * 存储的 sourceUrl 都使用主域名，避免重复记录。
   */
  normalizeUrl(url: string): string {
    return replaceDomain(url, this.baseUrl);
  }

  // HTTP 方式爬取

  readonly supportsHttpScrape = true;
  async scrapeGalleryHttp(pageUrl: string): Promise<GalleryScrapeResult> {
    const hT0 = Date.now();
    const hLog = (msg: string): void => console.log(`[HttpScrapeTiming] ${Date.now() - hT0}ms — ${msg}`);
    hLog(`开始 HTTP 爬取: ${pageUrl}`);

    const articleId = extractArticleId(pageUrl);
    const urlDomain = extractDomainFromUrl(pageUrl);
    const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
    // 将原始 URL 域名排到第一位
    if (urlDomain && orderedDomains.includes(urlDomain)) {
      orderedDomains.splice(orderedDomains.indexOf(urlDomain), 1);
      orderedDomains.unshift(urlDomain);
    }

    // 尝试各域名获取第一页 HTML
    let $: cheerio.CheerioAPI | null = null;
    let usedDomain = '';
    let usedUrl = pageUrl;

    for (const domain of orderedDomains) {
      const tryUrl = articleId
        ? `${domain}/article/${articleId}/`
        : pageUrl;
      try {
        hLog(`HTTP 请求第一页: ${tryUrl}`);
        const resp = await fetch(tryUrl, {
          headers: buildAntiCrawlerHeaders(domain),
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });

        if (resp.status === 403 || resp.status === 429) {
          domainHealthTracker.markRateLimited(domain);
          hLog(`域名 ${domain} 返回 ${resp.status}（WAF 限流），切换`);
          continue;
        }
        if (resp.status === 404) {
          hLog(`域名 ${domain} 返回 404`);
          continue;
        }
        if (!resp.ok) {
          hLog(`域名 ${domain} 返回 ${resp.status}`);
          continue;
        }

        const html = await resp.text();
        const try$ = cheerio.load(html);

        // WAF / 反爬虫拦截检测
        const wafResult = detectWaf(resp.status, html, try$);
        if (wafResult.blocked) {
          domainHealthTracker.markRateLimited(domain);
          hLog(`域名 ${domain} 被 WAF 拦截: ${wafResult.detail}，切换`);
          continue;
        }

        // 验证内容有效性：必须找到 article 元素或 h1 标题
        const articleEl = try$('article').first();
        const h1Text = try$('h1').first().text().trim();
        const titleText = try$('title').text().trim();
        if (articleEl.length === 0 && !h1Text && !titleText) {
          hLog(`域名 ${domain} HTML 无有效内容 (article=${articleEl.length}, h1="${h1Text.substring(0, 20)}")，尝试下一个域名`);
          continue;
        }

        $ = try$;
        usedDomain = domain;
        usedUrl = tryUrl;
        domainHealthTracker.markHealthy(domain);
        hLog(`第一页获取成功 (${html.length} bytes)`);
        break;
      } catch (err) {
        hLog(`域名 ${domain} 请求失败: ${err instanceof Error ? err.message : err}`);
        continue;
      }
    }

    if (!$) {
      throw new Error('所有域名 HTTP 请求均失败');
    }

    // 解析第一页数据
    const firstPageData = this.parseGalleryPageHtml($, 0);
    hLog(`第一页解析完成: ${firstPageData.images.length} 图片, ${firstPageData.videos.length} 视频, 总页数=${firstPageData.totalPages}`);

    const totalPages = Math.min(firstPageData.totalPages, MAX_GALLERY_PAGES);

    const allImages: GalleryImageItem[] = [];
    const allVideos: GalleryVideoItem[] = [];
    const videoUrlSet = new Set<string>();
    const imageUrlSet = new Set<string>();

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

    const zipInfo = this.parseZipInfoFromHtml($, usedDomain);
    hLog(`ZIP 信息提取: ${zipInfo ? '有' : '无'}`);

    // 翻页爬取
    const GALLERY_HTTP_DELAY_MIN = 200;
    const GALLERY_HTTP_DELAY_MAX = 400;

    for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
      hLog(`HTTP 请求第 ${pageNum}/${totalPages} 页`);
      await sleep(randomDelay(GALLERY_HTTP_DELAY_MIN, GALLERY_HTTP_DELAY_MAX));

      let pageData: GalleryPageMetadata | null = null;
      const pageUrlConstructed = `${usedDomain}/article/${articleId}/page/${pageNum}/`;

      try {
        const resp = await fetch(pageUrlConstructed, {
          headers: buildAntiCrawlerHeaders(usedDomain),
          redirect: 'follow',
          signal: AbortSignal.timeout(15000),
        });

        if (resp.status === 403 || resp.status === 429) {
          domainHealthTracker.markRateLimited(usedDomain);
          // 尝试回退域名
          const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
          for (const fbDomain of fallbackDomains) {
            if (fbDomain === usedDomain) continue;
            const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
            try {
              const fbResp = await fetch(fbUrl, {
                headers: buildAntiCrawlerHeaders(fbDomain),
                redirect: 'follow',
                signal: AbortSignal.timeout(10000),
              });
              if (!fbResp.ok) continue;
              const fbHtml = await fbResp.text();
              const fb$ = cheerio.load(fbHtml);
              pageData = this.parseGalleryPageHtml(fb$, pageNum - 1);
              usedDomain = fbDomain;
              domainHealthTracker.markHealthy(fbDomain);
              hLog(`第 ${pageNum} 页切换到域名 ${fbDomain} 成功`);
              break;
            } catch {
              continue;
            }
          }
        } else if (resp.ok) {
          const html = await resp.text();
          const page$ = cheerio.load(html);
          pageData = this.parseGalleryPageHtml(page$, pageNum - 1);
        }
      } catch (err) {
        hLog(`第 ${pageNum} 页请求失败: ${err instanceof Error ? err.message : err}`);
        // 尝试回退域名
        const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
        for (const fbDomain of fallbackDomains) {
          if (fbDomain === usedDomain) continue;
          const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
          try {
            const fbResp = await fetch(fbUrl, {
              headers: buildAntiCrawlerHeaders(fbDomain),
              redirect: 'follow',
              signal: AbortSignal.timeout(10000),
            });
            if (!fbResp.ok) continue;
            const fbHtml = await fbResp.text();
            const fb$ = cheerio.load(fbHtml);
            pageData = this.parseGalleryPageHtml(fb$, pageNum - 1);
            usedDomain = fbDomain;
            hLog(`第 ${pageNum} 页切换到域名 ${fbDomain} 成功`);
            break;
          } catch {
            continue;
          }
        }
      }

      if (pageData) {
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
      }
    }
    hLog(`翻页完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

    const title = this.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
    hLog(`标题清洗: "${title.substring(0, 40)}"`);
    const protagonist = await this.extractProtagonist(title, firstPageData.tags);
    hLog(`主角提取: "${protagonist}"`);
    const description = this.extractDescription(title, protagonist);

const blockCheck = await this.checkContentBlockedAsync(title, firstPageData.category, protagonist);
if (blockCheck.blocked) {
throw new Error(`内容被屏蔽: ${blockCheck.reason}`);
    }

    const metaKeywordsStr = $('meta[name="keywords"]').attr('content') || '';
    const metaKeywords = metaKeywordsStr
      .split(/[,，;；]/)
      .map((t) => t.trim())
      .filter((t) => t && t.length < 50);

    const allTags = [...new Set([...firstPageData.tags, ...metaKeywords])];

    // 识别游戏角色
    const gameCharMatches = getGameCharacterService().identifyInTags(allTags);
    const gameCharacters = gameCharMatches.map((m) => m.character.name);

    // 如果有 ZIP 下载信息且需要调用 eligibility API
    if (zipInfo && zipInfo.downloadUrl === '' && articleId) {
      try {
        hLog('调用 eligibility API');
        const apiUrl = `${usedDomain}/api/download/eligibility?page_id=${articleId}&next=${encodeURIComponent(`/article/${articleId}/`)}`;
        const eligResp = await fetch(apiUrl, {
          headers: buildAntiCrawlerHeaders(usedDomain),
          signal: AbortSignal.timeout(10000),
        });
        if (eligResp.ok) {
          const eligResult = await eligResp.json() as Record<string, unknown>;
          const resolvedLinks = eligResult['resolved_links'];
          if (Array.isArray(resolvedLinks) && resolvedLinks.length > 0) {
            zipInfo.downloadUrl = resolvedLinks[0] as string;
            zipInfo.requiresLogin = false;
          }
          if (eligResult['requires_registration']) {
            zipInfo.requiresLogin = true;
          }
          if (eligResult['requires_email_verification']) {
            zipInfo.requiresEmail = true;
          }
        }
        hLog('eligibility API 完成');
      } catch {
        hLog('eligibility API 失败');
      }
    }

    hLog(`HTTP 爬取全部完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

    return {
      sourceUrl: pageUrl,
      title,
      protagonist,
      description,
      category: firstPageData.category,
      tags: allTags,
      coverUrl: this.resolveUrl(firstPageData.coverUrl),
      publishTime: firstPageData.publishTime || undefined,
      images: allImages,
      videos: allVideos,
      pageCount: totalPages,
      imageCount: allImages.length,
      videoCount: allVideos.length,
      scrapedDomain: usedDomain,
      zipInfo,
      gameCharacters: gameCharacters.length > 0 ? gameCharacters : undefined,
    };
  }

  private parseGalleryPageHtml($: cheerio.CheerioAPI, pageIndex: number): GalleryPageMetadata {
    const result: GalleryPageMetadata = {
      h1Title: '',
      rawTitle: '',
      tags: [],
      category: '',
      coverUrl: '',
      publishTime: '',
      currentPage: 1,
      totalPages: 1,
      images: [],
      videos: [],
    };

    result.h1Title = $('h1').first().text().trim();
    result.rawTitle = $('title').text().trim();

    // 分类（面包屑导航）
    const breadcrumb = $('nav[aria-label="Breadcrumb"]');
    if (breadcrumb.length > 0) {
      const links = breadcrumb.find('a');
      if (links.length >= 2) {
        result.category = links.last().text().trim();
      }
    }

    // 标签
    const tagSet = new Set<string>();
    $('a[href*="/tag/"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text !== '标签' && text.length < 30) {
        tagSet.add(text);
      }
    });
    result.tags = Array.from(tagSet);

    // 分页信息
    $('nav').each((_, nav) => {
      const text = $(nav).text();
      const match = text.match(/第\s*(\d+)\s*[頁页].*?共\s*(\d+)\s*[頁页]/);
      if (match) {
        result.currentPage = parseInt(match[1]);
        result.totalPages = parseInt(match[2]);
      }
    });

    // 图片采集
    const article = $('article').first();
    if (article.length > 0) {
      article.find('img').each((_, img) => {
        const url =
          $(img).attr('data-src') ||
          $(img).attr('data-original-src') ||
          $(img).attr('data-original') ||
          $(img).attr('data-lazy-src') ||
          $(img).attr('src') ||
          '';

        if (
          url &&
          !url.includes(PLACEHOLDER_FRAGMENT) &&
          !url.includes('/static/images/Loading') &&
          !url.includes('data:image/')
        ) {
          result.images.push({ url, pageIndex });
        }
      });

      // 封面图
      article.find('img').each((_, img) => {
        if (result.coverUrl) return;
        const url =
          $(img).attr('data-src') ||
          $(img).attr('data-original-src') ||
          $(img).attr('data-original') ||
          $(img).attr('data-lazy-src') ||
          $(img).attr('src') ||
          '';
        if (url && !url.includes(PLACEHOLDER_FRAGMENT) && !url.includes('/static/images/Loading')) {
          result.coverUrl = url;
        }
      });
    }

    // 视频采集
    $('video source[src*=".m3u8"]').each((_, source) => {
      const src = $(source).attr('src') || '';
      if (src && !result.videos.includes(src)) {
        result.videos.push(src);
      }
    });

    $('video source[src*=".mp4"]').each((_, source) => {
      const src = $(source).attr('src') || '';
      if (src && !result.videos.includes(src)) {
        result.videos.push(src);
      }
    });

    $('script').each((_, script) => {
      const content = $(script).html() || '';
      const matches = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
      if (matches) {
        for (const url of matches) {
          if (!result.videos.includes(url)) {
            result.videos.push(url);
          }
        }
      }
    });

    // 发布时间
    $('script[type="application/ld+json"]').each((_, script) => {
      if (result.publishTime) return;
      try {
        const data = JSON.parse($(script).html() || '');
        if (data['@type'] === 'VideoObject' && data.uploadDate) {
          result.publishTime = String(data.uploadDate).substring(0, 10);
        }
      } catch {}
    });

    if (!result.publishTime && result.coverUrl) {
      const match = result.coverUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
      if (match) {
        result.publishTime = `${match[1]}-${match[2]}-${match[3]}`;
      }
    }

    return result;
  }

  private parseZipInfoFromHtml($: cheerio.CheerioAPI, domain: string): GalleryZipInfo | undefined {
    const box = $('.download-info-box');
    const section = $('.download-section');
    const btn = $('.btn-download');

    if (box.length === 0 && section.length === 0) return undefined;

    let fileCount = 0;
    let fileSizeText = '';
    let imageDimensions = '';
    let password = '';
    let title = '';

    title = box.find('.info-title').text().trim() || '';

    box.find('.info-item').each((_, item) => {
      const label = $(item).find('strong').text().trim() || '';
      const text = $(item).text().replace(label, '').trim();

      if (label.includes('文件数量') || label.includes('Files')) {
        const m = text.match(/(\d+)/);
        if (m) fileCount = parseInt(m[1]);
      } else if (label.includes('文件大小') || label.includes('Size')) {
        fileSizeText = text;
      } else if (label.includes('图片尺寸') || label.includes('Dimensions')) {
        imageDimensions = text;
      } else if (label.includes('密码') || label.includes('Password')) {
        const input = $(item).find('.password-input');
        password = input.val() as string || text;
      }
    });

    let downloadUrl = '';
    let provider = '';
    let requiresLogin = false;
    let requiresEmail = false;

    if (btn.length > 0) {
      provider = btn.attr('data-provider') || '';
      const href = btn.attr('href') || '';
      const label = btn.find('.download-label').text().trim() || '';

      if (provider === 'mediafire' || label.toLowerCase().includes('mediafire')) {
        provider = 'MediaFire';
      }

      if (href && href.startsWith('http') && href !== '#') {
        downloadUrl = href;
      } else if (href && href.startsWith('/') && !href.includes('/auth/login') && href !== '#') {
        downloadUrl = new URL(href, domain).href;
      }

      if (btn.hasClass('is-locked') || href.includes('/auth/login')) {
        requiresLogin = true;
      }
    }

    const noticeText = $('.download-notice-text').text().trim() || '';
    if (noticeText.includes('登录') || noticeText.includes('Login')) {
      requiresLogin = true;
    }
    if (noticeText.includes('邮箱') || noticeText.includes('验证') || noticeText.includes('Verify')) {
      requiresEmail = true;
    }

    const pageId = section.attr('data-page-id') || '';
    const eligibilityUrl = section.attr('data-eligibility-url') || '/api/download/eligibility';
    const nextUrl = section.attr('data-next-url') || '';

    if (!fileCount && !fileSizeText && !downloadUrl && !pageId) return undefined;

    const zipInfo: GalleryZipInfo = {
      title,
      fileCount,
      fileSizeText,
      imageDimensions,
      password,
      downloadUrl,
      provider,
      requiresLogin,
      requiresEmail,
    };

    if (!downloadUrl && pageId) {
      (zipInfo as unknown as Record<string, unknown>)['_pageId'] = pageId;
      (zipInfo as unknown as Record<string, unknown>)['_eligibilityUrl'] = eligibilityUrl;
      (zipInfo as unknown as Record<string, unknown>)['_nextUrl'] = nextUrl;
    }

    return zipInfo;
  }
}
