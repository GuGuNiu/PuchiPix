/**
 * sites/providers/aimeizizi-provider.ts — 爱妹子站点提供者
 *
 * 爱妹子是一个 WordPress 驱动的写真图库站点，同一内容分布在不同域名上。
 * 本 Provider 封装该站点的全部爬取逻辑：
 *
 * 1. 多域名自适应（跳房子算法）：
 *    站点存在三个镜像域名，内容完全相同但 WAF 策略不同：
 *    - www.lovecutes.com（主域名）
 *    - xx.knit.bid（镜像）
 *    - www.lovecutes.net（备用）
 *    爬取时随机选择域名，遇到 403/404 自动切换到下一个。
 *
 * 2. 标题清洗与主角定位：
 *    原始格式 "[cosplay] 主角名 - 描述 50P1V - 分类 - 爱妹子"
 *    清洗后 "主角名 - 描述"
 *    主角名通过标题分割 + 标签交叉验证提取。
 *
 * 3. 图库爬取（scrapeGallery）：
 *    - 自动翻页：/article/{id}/page/{n}/
 *    - 图片懒加载：data-src 为真实 URL，src 为占位 GIF
 *    - 图片 URL 解析为绝对路径
 *    - 跨页 URL Set 去重
 *    - 视频采集：M3U8 + MP4
 *
 * 4. ZIP 压缩包信息提取：
 *    部分图包提供整包 ZIP 下载（跳转到 MediaFire 等外站），
 *    从 .download-info-box 提取文件数量、体积、密码、外站 URL。
 *
 * 5. 内容屏蔽：
 *    - AI 生成内容关键词过滤
 *    - 主角名自定义屏蔽（预埋，默认不启用）
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

import type { Page } from 'playwright';
import { BaseSiteProvider } from '../base-provider';
import type { ExtendedMetadata, GallerySiteProvider } from '../types';
import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
  GalleryZipInfo,
  ScrapeResult,
} from '@/types';
import { MAX_GALLERY_PAGES, PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep } from '@/lib/core/anti-crawler';
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';

// ============================================================
// 类型定义
// ============================================================

/** 从页面提取的图库元信息 */
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

// ============================================================
// 常量
// ============================================================

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

/** 需要屏蔽的标题关键词（AI 生成内容） */
const BLOCKED_TITLE_KEYWORDS = [
  'AI Nudes',
  'AI Porn',
  'AI 生成',
  'AI生成',
  '人工智能生成',
  'AI绘图',
  'AI 绘图',
];

/** 需要屏蔽的分类关键词 */
const BLOCKED_CATEGORIES = [
  'AI美女',
  'AI 美女',
  'AI生成',
];

/**
 * 需要屏蔽的主角名列表（预埋功能，默认不启用）
 *
 * 启用方式：在配置中将 blockedProtagonistsEnabled 设为 true
 * @date 2026-07-11
 */
const BLOCKED_PROTAGONISTS: string[] = [];

/** 主角屏蔽功能是否启用（默认关闭） */
const BLOCKED_PROTAGONISTS_ENABLED = false;

// ============================================================
// 工具函数
// ============================================================

/**
 * 解析文件大小文本为字节数
 *
 * "263.8M" → 276590592
 * "1.2G" → 1288490188
 */
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

/**
 * 从 URL 中提取文章 ID
 *
 * /article/32238/ → "32238"
 * https://www.lovecutes.com/article/32238/page/2/ → "32238"
 */
function extractArticleId(url: string): string | null {
  const match = url.match(/\/article\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * 将任意爱妹子域名 URL 替换为指定域名
 */
function replaceDomain(url: string, targetDomain: string): string {
  return url.replace(/^https?:\/\/[^/]+/, targetDomain);
}

/**
 * 跳房子算法：随机打乱域名列表，返回尝试顺序
 *
 * 每次调用产生不同的起始位置，避免固定模式被识别。
 */
function shuffleDomains(): string[] {
  const shuffled = [...SITE_DOMAINS];
  const startIdx = Math.floor(Math.random() * shuffled.length);
  return [
    ...shuffled.slice(startIdx),
    ...shuffled.slice(0, startIdx),
  ];
}

// ============================================================
// AimeiziziProvider 实现
// ============================================================

export class AimeiziziProvider extends BaseSiteProvider implements GallerySiteProvider {
  readonly id = 'aimeizizi';
  readonly name = '爱妹子';
  readonly baseUrl = 'https://www.lovecutes.com';
  readonly enabled = true;

  readonly playButtonSelectors: string[] = [];
  readonly m3u8ExcludePatterns: string[] = ['ad', 'stat', 'analytics'];

  /** 所有镜像域名 */
  readonly domains: string[] = SITE_DOMAINS;

  /** 需要屏蔽的标题关键词 */
  readonly blockedTitleKeywords: string[] = BLOCKED_TITLE_KEYWORDS;

  /** 需要屏蔽的分类关键词 */
  readonly blockedCategories: string[] = BLOCKED_CATEGORIES;

  /** 需要屏蔽的主角名列表（预埋，默认不启用） */
  readonly blockedProtagonists: string[] = BLOCKED_PROTAGONISTS;

  /** 主角屏蔽是否启用 */
  readonly blockedProtagonistsEnabled: boolean = BLOCKED_PROTAGONISTS_ENABLED;

  // ----------------------------------------------------------
  // 搜索 URL 构造
  // ----------------------------------------------------------

  buildSearchUrl(keyword: string): string {
    return `${this.baseUrl}/?s=${encodeURIComponent(keyword)}`;
  }

  // ----------------------------------------------------------
  // 标题清洗
  // ----------------------------------------------------------

  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';

    let title = rawTitle.trim();

    // 去除 [cosplay] 等前缀标记
    title = title.replace(/^\[.*?\]\s*/, '');

    // 去除 " - xxx - 爱妹子" 站点后缀
    title = title.replace(SITE_SUFFIX_PATTERN, '');

    // 去除尾部 " - 爱妹子"
    title = title.replace(/\s*[-—–]\s*爱妹子\s*$/i, '');

    return title.trim();
  }

  // ----------------------------------------------------------
  // 主角定位
  // ----------------------------------------------------------

  extractProtagonist(title: string, tags: string[]): string {
    if (!title) return '';

    const parts = title.split(/\s*[-—–]\s*/).filter((p) => p.length > 0);
    if (parts.length >= 2) {
      const candidate = parts[0].trim();

      // 交叉验证：主角名通常也是标签之一
      if (tags.some((tag) => tag === candidate)) {
        return candidate;
      }

      if (candidate.length > 0 && candidate.length < 20) {
        return candidate;
      }
    }

    // 标题不含分隔符时，从标签中查找
    for (const tag of tags) {
      if (tag.length > 1 && tag.length < 20 && title.startsWith(tag)) {
        return tag;
      }
    }

    return '';
  }

  extractDescription(title: string, protagonist: string): string {
    if (!title) return '';
    if (!protagonist) return title;

    let desc = title.replace(protagonist, '').replace(/^\s*[-—–]\s*/, '').trim();

    // 去除尾部的数量标记（如 "21P1V"、"70P"）
    desc = desc.replace(/\s*\d+P\d*V?\s*$/i, '').trim();

    return desc;
  }

  // ----------------------------------------------------------
  // 内容屏蔽检查
  // ----------------------------------------------------------

  checkBlocked(
    title: string,
    category: string,
    protagonist?: string,
  ): { blocked: boolean; reason: string | undefined } {
    // AI 内容关键词检查
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

    // 主角名屏蔽（预埋功能，默认不启用）
    if (this.blockedProtagonistsEnabled && protagonist) {
      for (const blocked of this.blockedProtagonists) {
        if (protagonist === blocked || protagonist.includes(blocked)) {
          return { blocked: true, reason: `主角名被屏蔽: "${blocked}"` };
        }
      }
    }

    return { blocked: false, reason: undefined };
  }

  // ----------------------------------------------------------
  // URL 匹配
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // 搜索结果提取
  // ----------------------------------------------------------

  async extractSearchResults(page: Page) {
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

    return rawResults.filter((item) => {
      const check = this.checkBlocked(item.title, '');
      if (check.blocked) {
        console.log(`[Aimeizizi] 屏蔽搜索结果: "${item.title.substring(0, 50)}..."，原因: ${check.reason}`);
        return false;
      }
      return true;
    });
  }

  // ----------------------------------------------------------
  // 扩展元信息提取
  // ----------------------------------------------------------

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
    const protagonist = this.extractProtagonist(title, raw.tags);

    const metaKeywords = raw.keywordStr
      .split(/[,，;；]/)
      .map((t) => t.trim())
      .filter((t) => t && t.length < 50 && !raw.tags.includes(t));

    return {
      title,
      tags: [...raw.tags, ...metaKeywords],
      actors: protagonist ? [protagonist] : [],
      categories: raw.category ? [raw.category] : [],
      director: protagonist,
      series: [],
      blocked: false,
    };
  }

  // ----------------------------------------------------------
  // 图库页面元信息提取（内部方法）
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // ZIP 下载信息提取
  // ----------------------------------------------------------

  /**
   * 从页面提取 ZIP 压缩包下载信息
   *
   * 页面结构：
   * - .download-info-box：文件数量、大小、尺寸、密码等元信息
   * - .download-section：包含 data-eligibility-url、data-page-id、data-next-url 等 data 属性
   * - .btn-download：下载按钮，初始 href="#"，JS 权限检查后更新为实际链接
   *
   * 下载链接获取流程（无需登录）：
   * 1. 页面 JS 异步调用 /api/download/eligibility?page_id=xxx&next=/article/xxx/ 检查权限
   * 2. 若 can_download=true，resolved_links 包含实际跳转 URL（通常为 ouo.io 短链接）
   * 3. 按钮的 href 被更新为跳转 URL，class 移除 is-pending
   * 4. 若 can_download=false（新文章时间门控），按钮 href 指向登录页，class 为 is-locked
   *
   * 注意：按钮 JS 更新可能延迟（is-pending 未及时移除），
   * 因此始终主动调用 eligibility API 确保获取 resolved_links。
   *
   * @date 2026-07-11
   * @lastModified 2026-07-11
   */
  private async extractZipDownloadInfo(page: Page): Promise<GalleryZipInfo | undefined> {
    await page.waitForSelector('.download-info-box', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('.btn-download', { timeout: 5000 }).catch(() => {});

    // 等待权限检查 JS 执行（is-pending 或 is-locked 状态确定）
    await page.waitForFunction(() => {
      const btn = document.querySelector('.btn-download');
      if (!btn) return true;
      return !btn.classList.contains('is-pending');
    }, { timeout: 8000 }).catch(() => {});

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
        const eligResult = await page.evaluate(async (url) => {
          const resp = await fetch(url, { credentials: 'include' });
          return resp.json();
        }, apiUrl);

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
        // eligibility API 调用失败，保持按钮提取的结果
      }
    }

    return zipInfo;
  }

  // ----------------------------------------------------------
  // 图库完整爬取（GallerySiteProvider 实现）
  // ----------------------------------------------------------

  async scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult> {
    const firstPageData = await this.extractGalleryPageData(page, 0);

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

    // 在翻页前提取 ZIP 下载信息（下载按钮只存在于第一页）
    const zipInfo = await this.extractZipDownloadInfo(page);

    // 翻页爬取
    for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
      await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));

      const pageUrlConstructed = `${pageUrl.replace(/\/$/, '')}/page/${pageNum}/`;

      try {
        await page.goto(pageUrlConstructed, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        await page.waitForSelector('article', { timeout: 5000 }).catch(() => {});

        const pageData = await this.extractGalleryPageData(page, pageNum - 1);

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
      } catch (err) {
        console.error(`[Aimeizizi] 爬取第 ${pageNum} 页失败:`, err);
      }
    }

    // 提取主角和描述
    const title = this.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
    const protagonist = this.extractProtagonist(title, firstPageData.tags);
    const description = this.extractDescription(title, protagonist);

    // 内容屏蔽检查
    const blockCheck = this.checkBlocked(title, firstPageData.category, protagonist);
    if (blockCheck.blocked) {
      console.log(`[Aimeizizi] 屏蔽图库爬取: "${title.substring(0, 50)}..."，原因: ${blockCheck.reason}`);
      throw new Error(`内容被屏蔽: ${blockCheck.reason}`);
    }

    // 合并 meta keywords
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

    // 记录实际使用的域名
    let scrapedDomain = '';
    try {
      const parsed = new URL(pageUrl);
      scrapedDomain = `${parsed.protocol}//${parsed.host}`;
    } catch {}

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

  // ----------------------------------------------------------
  // 单页爬取（SiteProvider 接口实现）
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // 工具方法
  // ----------------------------------------------------------

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
   * 获取多域名自适应 URL
   *
   * 跳房子算法：随机打乱域名列表，返回尝试顺序。
   * 调用方依次尝试每个域名，遇到 403/404 时切换到下一个。
   *
   * @param articleUrl - 原始文章 URL（任意域名）
   * @returns 按随机顺序排列的域名 URL 列表
   * @date 2026-07-11
   */
  getAdaptiveUrls(articleUrl: string): string[] {
    const articleId = extractArticleId(articleUrl);
    if (!articleId) return [articleUrl];

    const domains = shuffleDomains();
    return domains.map((d) => `${d}/article/${articleId}/`);
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
}
