import type { Page, BrowserContext } from 'playwright';
import { BaseSiteProvider } from '../base-provider';
import type { ExtendedMetadata, GallerySiteProvider, SiteSearchResult, BlockCheckResult } from '../types';
import type {
  GalleryScrapeResult,
  GalleryImageItem,
  ScrapeResult,
} from '@/types';
import { MAX_GALLERY_PAGES, PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep } from '@/lib/core/anti-crawler';
import { logT } from '@/lib/i18n/server';

/**
 * E-Hentai 分类标签位掩码映射。
 *
 * 源自 exloli-plugin-main 的 LABELS 常量。
 * f_cats 参数为"禁用分类"的位掩码：1023 - sum(启用分类的标签值)。
 */
const CATEGORY_LABELS: Record<string, number> = {
  Doujinshi: 2,
  Manga: 4,
  ArtistCG: 8,
  GameCG: 16,
  Western: 512,
  NonH: 256,
  ImageSet: 32,
  Cosplay: 64,
  AsianPorn: 128,
  Misc: 1,
};

/** 分类 ID → 名称映射 */
const CATEGORY_NAMES: Record<number, string> = {
  1: 'Doujinshi',
  2: 'Manga',
  3: 'ArtistCG',
  4: 'GameCG',
  5: 'Western',
  6: 'NonH',
  7: 'ImageSet',
  8: 'Cosplay',
  9: 'AsianPorn',
  10: 'Misc',
};

/** 表站基础 URL */
const BASE_E_URL = 'https://e-hentai.org';
/** 里站基础 URL */
const BASE_EX_URL = 'https://exhentai.org';

/** 站点域名列表 */
const SITE_DOMAINS = [BASE_E_URL, BASE_EX_URL];

/** 每批图片页请求数（防止 IP 限速） */
const IMAGE_BATCH_SIZE = 4;

/** 图片页请求超时（毫秒） */
const IMAGE_FETCH_TIMEOUT = 15000;

/** 每页缩略图数量（E-Hentai 默认 Compact 模式 40 个） */
const THUMBS_PER_PAGE = 40;

/**
 * 从环境变量获取 exhentai Cookie。
 *
 * 只有三个字段都配置时才返回（里站需要完整 Cookie）。
 * 表站（e-hentai.org）无需 Cookie。
 *
 * @returns Cookie 对象或 null
 */
function getExhentaiCookies(): Record<string, string> | null {
  const ipbMemberId = process.env.EXHENTAI_IPB_MEMBER_ID;
  const ipbPassHash = process.env.EXHENTAI_IPB_PASS_HASH;
  const igneous = process.env.EXHENTAI_IGNEOUS;

  if (!ipbMemberId || !ipbPassHash) {
    return null;
  }

  const cookies: Record<string, string> = {
    ipb_member_id: ipbMemberId,
    ipb_pass_hash: ipbPassHash,
  };

  if (igneous) {
    cookies.igneous = igneous;
  }

  return cookies;
}

/**
 * 判断 URL 是否为里站（exhentai.org）。
 */
function isExUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'exhentai.org';
  } catch {
    return false;
  }
}

/**
 * 从图库 URL 中提取图库 ID。
 *
 * https://e-hentai.org/g/12345/abcdef/ → "12345"
 */
function extractGalleryId(url: string): string | null {
  const match = url.match(/\/g\/(\d+)\//);
  return match ? match[1] : null;
}

/**
 * 将任意域名 URL 归一化为表站 URL。
 *
 * exhentai.org → e-hentai.org
 */
function normalizeToEhentai(url: string): string {
  return url.replace(/https?:\/\/exhentai\.org/, BASE_E_URL);
}

export class ExhentaiProvider extends BaseSiteProvider implements GallerySiteProvider {
  readonly id = 'exhentai';
  readonly name = 'E-Hentai';
  readonly baseUrl = BASE_E_URL;
  readonly enabled = true;

  readonly playButtonSelectors: string[] = [];
  readonly m3u8ExcludePatterns: string[] = ['ad', 'stat', 'analytics'];

  /** 所有支持域名 */
  readonly domains: string[] = SITE_DOMAINS;

  /**
   * 设置浏览器上下文 Cookie。
   *
   * 对于 exhentai.org（里站），需要注入 ipb_member_id / ipb_pass_hash / igneous Cookie。
   * e-hentai.org（表站）无需 Cookie。
   *
   * 由调用方（tasks/route.ts、search-engine.ts）在 page.goto 之前调用。
   *
   * @param context - Playwright BrowserContext
   */
  async setupBrowserContext(context: BrowserContext): Promise<void> {
    const cookies = getExhentaiCookies();
    if (!cookies) return;

    const cookieList = Object.entries(cookies).map(([name, value]) => ({
      name,
      value,
      domain: '.exhentai.org',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax' as const,
    }));

    // 同时设置 e-hentai.org 和 exhentai.org 的 Cookie
    cookieList.push(
      ...Object.entries(cookies).map(([name, value]) => ({
        name,
        value,
        domain: '.e-hentai.org',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax' as const,
      })),
    );

    await context.addCookies(cookieList);
  }

  // 搜索 URL 构造

  /**
   * 构造搜索页面 URL。
   *
   * 源自 exloli-plugin-main 的 handleParam 方法。
   *
   * 参数说明：
   * - f_search: 搜索关键词
   * - advsearch: 1（启用高级搜索）
   * - f_srdd: 最低星级（0-5）
   * - f_cats: 分类过滤位掩码（0 = 全部分类）
   *
   * @param keyword - 搜索关键词
   * @returns 搜索页面 URL
   */
  buildSearchUrl(keyword: string): string {
    const params = new URLSearchParams();
    params.set('f_search', keyword);
    params.set('advsearch', '1');
    params.set('f_srdd', '0');
    params.set('f_cats', '0');

    return `${BASE_E_URL}/?${params.toString()}`;
  }

  /**
   * 获取搜索页面的多域名自适应 URL 列表。
   *
   * 优先返回表站 URL，里站作为备选。
   */
  getAdaptiveSearchUrls(keyword: string): string[] {
    const encoded = encodeURIComponent(keyword);
    const params = `f_search=${encoded}&advsearch=1&f_srdd=0&f_cats=0`;
    const urls = [`${BASE_E_URL}/?${params}`];

    // 如果配置了里站 Cookie，添加里站搜索 URL
    if (getExhentaiCookies()) {
      urls.push(`${BASE_EX_URL}/?${params}`);
    }

    return urls;
  }

  // 标题清洗

  /**
   * 清洗原始标题。
   *
   * E-Hentai 标题通常为纯文本，无需特殊清洗。
   * 去除可能的前后空格和 HTML 实体。
   */
  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';

    let title = rawTitle.trim();

    title = title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    return title.trim();
  }

  // URL 匹配

  /**
   * 判断 URL 是否属于 E-Hentai / ExHentai。
   *
   * 匹配域名：e-hentai.org, exhentai.org
   * 匹配路径：/g/{id}/{token}/（图库详情页）
   */
  matchesUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'e-hentai.org' ||
        hostname === 'exhentai.org' ||
        hostname.endsWith('.e-hentai.org') ||
        hostname.endsWith('.exhentai.org')
      );
    } catch {
      return false;
    }
  }

  // 内容屏蔽检查

  /**
   * 检查内容是否应被屏蔽。
   *
   * E-Hentai 默认不屏蔽任何内容。
   * 可根据需要添加屏蔽规则（如特定标签、分类等）。
   */
  checkContentBlocked(
    _title: string,
    _category: string,
    _protagonist?: string,
  ): BlockCheckResult {
    return { blocked: false, reason: undefined };
  }

  // 搜索结果提取

  /**
   * 从搜索结果页面提取图库链接列表。
   *
   * 源自 exloli-plugin-main 的 requestPage 方法。
   *
   * E-Hentai 搜索结果页面结构：
   * - table.itg.gltc > tbody > tr（每行为一个图库）
   * - td.gl3c.glname a：图库链接
   * - div.glink：标题文本
   * - td.gl2c img：封面图
   * - div[id^="posted_"]：发布时间
   * - td.gl4c.glhide div:nth-child(2)：页数文本
   *
   * @param page - 已导航到搜索页的 Playwright Page
   * @returns 图库链接数组
   */
  async extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
    return page.evaluate(() => {
      const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
      const seen = new Set<string>();

      // 搜索结果表格行（排除表头和空行）
      const rows = document.querySelectorAll(
        'table.itg.gltc > tbody > tr:not(:first-child):not(:has(td.itd[colspan="4"]))'
      );

      // 兼容 Extended 模式（.itg:not(.gltc)）
      const extendedRows = document.querySelectorAll(
        'table.itg:not(.gltc) > tbody > tr:not(:first-child)'
      );

      const allRows = [...rows, ...extendedRows];

      for (const row of allRows) {
        try {
          const linkEl = row.querySelector('td.gl3c.glname a') as HTMLAnchorElement;
          if (!linkEl) continue;

          const href = linkEl.href;
          if (!href || !href.includes('/g/') || seen.has(href)) continue;
          seen.add(href);

          // 标题
          const titleEl = row.querySelector('td.gl3c.glname a div.glink') as HTMLElement;
          const title = titleEl?.textContent?.trim() || linkEl.textContent?.trim() || '';

          // 封面图
          const coverImg = row.querySelector('td.gl2c img') as HTMLImageElement;
          const coverUrl =
            coverImg?.getAttribute('data-src') ||
            coverImg?.getAttribute('src') ||
            undefined;

          // 发布时间
          const postedEl = row.querySelector('div[id^="posted_"]') as HTMLElement;
          const dateText = postedEl?.textContent?.trim() || '';
          let date: string | undefined;
          if (dateText) {
            const match = dateText.match(/(\d{4}-\d{2}-\d{2})/);
            if (match) {
              date = match[1];
            }
          }

          results.push({ url: href, title, coverUrl, date });
        } catch {
        }
      }

      return results.slice(0, 50);
    });
  }

  // 扩展元信息提取

  /**
   * 从图库详情页提取扩展元信息。
   *
   * 源自 exloli-plugin-main 的 getMoreInfo 方法。
   *
   * 提取内容：
   * - 标题（#gn）
   * - 标签（#taglist table tbody > tr）
   * - 语言、页数、上传时间（#gdd table tbody > tr）
   * - 评分（#gdr #rating_label）
   * - 上传者（#gdn）
   * - 分类（从标签中提取或从页面标题）
   *
   * @param page - 已导航到图库详情页的 Playwright Page
   * @returns 扩展元信息对象
   */
  async extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
    const raw = await page.evaluate(() => {
      // 标题
      const titleEl = document.querySelector('#gn') as HTMLElement;
      const h1Title = titleEl?.textContent?.trim() || document.title || '';

      // 上传者
      const uploaderEl = document.querySelector('#gdn a') as HTMLElement;
      const uploader = uploaderEl?.textContent?.trim() || '';

      // 元信息表格
      const infoRows = document.querySelectorAll('#gdd table tbody > tr');
      let language = '';
      let pages = 0;
      let posted = '';
      let fileSize = '';

      infoRows.forEach((row) => {
        const label = row.querySelector('td.gdt1')?.textContent?.trim() || '';
        const value = row.querySelector('td.gdt2')?.textContent?.trim() || '';

        if (label.includes('Language')) {
          language = value;
        } else if (label.includes('Length') || label.includes('Pages')) {
          const m = value.match(/(\d+)/);
          if (m) pages = parseInt(m[1]);
        } else if (label.includes('Posted')) {
          posted = value;
        } else if (label.includes('File Size')) {
          fileSize = value;
        }
      });

      // 评分
      const ratingEl = document.querySelector('#gdr #rating_label') as HTMLElement;
      const ratingText = ratingEl?.textContent?.trim() || '';
      const ratingMatch = ratingText.match(/Average:\s*([\d.]+)/);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : 0;

      // 标签
      const tags: Record<string, string[]> = {};
      const tagRows = document.querySelectorAll('#taglist table tbody > tr');
      tagRows.forEach((row) => {
        const keyEl = row.querySelector('td.tc') as HTMLElement;
        const key = keyEl?.textContent?.trim().replace(/:$/, '') || '';
        const valueEls = row.querySelectorAll('td > div > a');
        const values: string[] = [];
        valueEls.forEach((el) => {
          const text = el.textContent?.trim();
          if (text) values.push(text);
        });
        if (key && values.length > 0) {
          tags[key] = values;
        }
      });

      // 封面图
      const coverEl = document.querySelector('#gd1 img, #gdc img') as HTMLImageElement;
      const coverUrl =
        coverEl?.getAttribute('data-src') ||
        coverEl?.getAttribute('src') ||
        '';

      // 分类（从页面标题或标签中推断）
      const categoryEl = document.querySelector('#gdc .cs, .cs.ct1, .cs.ct2, .cs.ct3') as HTMLElement;
      const category = categoryEl?.textContent?.trim() || '';

      return {
        h1Title,
        uploader,
        language,
        pages,
        posted,
        fileSize,
        rating,
        tags,
        coverUrl,
        category,
        documentTitle: document.title,
      };
    });

    const title = this.cleanTitle(raw.h1Title || raw.documentTitle);

    // 展平标签为字符串数组
    const flatTags: string[] = [];
    for (const [ns, labels] of Object.entries(raw.tags)) {
      for (const label of labels) {
        flatTags.push(`${ns}:${label}`);
      }
    }

    // 提取主角（从标签的 parod 或 character 命名空间）
    const parodies = raw.tags['parody'] || raw.tags['group'] || [];
    const characters = raw.tags['character'] || [];
    const actors = [...parodies, ...characters];

    return {
      title,
      tags: flatTags,
      actors,
      categories: raw.category ? [raw.category] : [],
      director: raw.uploader,
      series: [],
      blocked: false,
    };
  }

  // 图库完整爬取

  /**
   * 爬取完整图库（所有页面的图片）。
   *
   * 源自 exloli-plugin-main 的 getMoreInfo + requestContent + downloadPicture 方法。
   *
   * 爬取流程：
   * - 从图库详情页提取元信息（标题、标签、评分、页数等）
   * - 收集所有图片页链接（#gdt a，可能跨多个画廊页 ?p=N）
   * - 批量访问图片页，提取实际图片 URL（img#img src）
   * - 返回 GalleryScrapeResult
   *
   * 性能优化：
   * - 使用 page.evaluate + fetch 批量获取图片页 HTML，避免逐页打开浏览器
   * - 每批 IMAGE_BATCH_SIZE 个请求，防止 IP 限速
   * - 限制最大画廊页数 MAX_GALLERY_PAGES 防止无限翻页
   *
   * @param page - 已导航到图库详情页的 Playwright Page
   * @param pageUrl - 图库详情页 URL
   * @returns 图库爬取结果
   */
  async scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult> {
    const metadata = await this.extractExtendedMetadata(page);

    const galleryInfo = await page.evaluate(() => {
      // 页数
      const lengthRow = Array.from(document.querySelectorAll('#gdd table tbody > tr')).find(
        (row) => row.querySelector('td.gdt1')?.textContent?.includes('Length') ||
                   row.querySelector('td.gdt1')?.textContent?.includes('Pages')
      );
      const lengthText = lengthRow?.querySelector('td.gdt2')?.textContent?.trim() || '';
      const pagesMatch = lengthText.match(/(\d+)/);
      const pages = pagesMatch ? parseInt(pagesMatch[1]) : 0;

      // 发布时间
      const postedRow = Array.from(document.querySelectorAll('#gdd table tbody > tr')).find(
        (row) => row.querySelector('td.gdt1')?.textContent?.includes('Posted')
      );
      const postedText = postedRow?.querySelector('td.gdt2')?.textContent?.trim() || '';
      const postedMatch = postedText.match(/(\d{4}-\d{2}-\d{2})/);
      const posted = postedMatch ? postedMatch[1] : '';

      // 封面
      const coverEl = document.querySelector('#gd1 img, #gdc img') as HTMLImageElement;
      const coverUrl = coverEl?.getAttribute('data-src') || coverEl?.getAttribute('src') || '';

      // 上传者
      const uploaderEl = document.querySelector('#gdn a') as HTMLElement;
      const uploader = uploaderEl?.textContent?.trim() || '';

      // 分类
      const categoryEl = document.querySelector('#gdc .cs, .cs') as HTMLElement;
      const category = categoryEl?.textContent?.trim() || '';

      return { pages, posted, coverUrl, uploader, category };
    });

    // 收集所有图片页链接
    const imagePageLinks = await this.collectImagePageLinks(page, pageUrl, galleryInfo.pages);

    // 批量提取实际图片 URL
    const imageUrls = await this.fetchImageUrls(page, imagePageLinks);

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

    // 内容屏蔽检查
    const blockCheck = this.checkContentBlocked(
      metadata.title,
      galleryInfo.category,
      metadata.actors[0],
    );
    if (blockCheck.blocked) {
      throw new Error(`内容被屏蔽: ${blockCheck.reason}`);
    }

    // 游戏角色识别服务不可用时忽略
    let gameCharacters: string[] | undefined;
    try {
      const { getGameCharacterService } = await import('@/lib/game-characters/game-character-service');
      const charService = getGameCharacterService();
      const charMatches = await charService.identifyInTags(metadata.tags);
      gameCharacters = charMatches.length > 0 ? charMatches.map((m) => m.character.name) : undefined;
    } catch {
    }

    // 记录实际使用的域名
    let scrapedDomain = '';
    try {
      const parsed = new URL(pageUrl);
      scrapedDomain = `${parsed.protocol}//${parsed.host}`;
    } catch {
    }

    return {
      sourceUrl: pageUrl,
      title: metadata.title,
      protagonist: metadata.actors[0] || '',
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

  /**
   * 收集图库所有页面的图片页链接。
   *
   * E-Hentai 图库页面结构：
   * - #gdt a：缩略图链接，指向图片页
   * - 每页约 40 个缩略图（Compact 模式）
   * - 多页通过 ?p=N 参数翻页
   *
   * @param page - 已导航到图库详情页的 Playwright Page
   * @param galleryUrl - 图库 URL
   * @param totalImages - 图库总图片数（用于计算翻页数）
   * @returns 图片页 URL 数组
   */
  private async collectImagePageLinks(
    page: Page,
    galleryUrl: string,
    totalImages: number,
  ): Promise<string[]> {
    const allLinks: string[] = [];
    const seenLinks = new Set<string>();

    const galleryPages = Math.min(
      Math.ceil(totalImages / THUMBS_PER_PAGE) || 1,
      MAX_GALLERY_PAGES,
    );

    for (let pageNum = 0; pageNum < galleryPages; pageNum++) {
      // 第一页已在当前页面，无需导航
      if (pageNum > 0) {
        const pageUrl = `${galleryUrl.replace(/\/$/, '')}/?p=${pageNum}`;
        await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));

        try {
          await page.goto(pageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });
        } catch (err) {
          console.error(logT('log.exhentai.scrapePageFailed', { page: pageNum }), err);
          break;
        }
      }

      const links = await page.evaluate(() => {
        const anchors = document.querySelectorAll('#gdt a');
        return Array.from(anchors).map((a) => (a as HTMLAnchorElement).href);
      });

      let newCount = 0;
      for (const link of links) {
        if (link && !seenLinks.has(link)) {
          seenLinks.add(link);
          allLinks.push(link);
          newCount++;
        }
      }

      console.log(logT('log.exhentai.pageNewLinks', { page: pageNum + 1, count: newCount, total: allLinks.length }));

      if (newCount === 0) break;
    }

    return allLinks;
  }

  /**
   * 批量从图片页提取实际图片 URL。
   *
   * 源自 exloli-plugin-main 的 downloadPicture 方法，优化为使用 fetch 批量获取。
   *
   * 每个图片页结构：
   * - img#img：实际图片元素，src 属性为图片 URL
   *
   * @param page - Playwright Page（用于在浏览器上下文中执行 fetch）
   * @param imagePageUrls - 图片页 URL 数组
   * @returns 图片 URL 数组（与输入一一对应，失败的为 null）
   */
  private async fetchImageUrls(
    page: Page,
    imagePageUrls: string[],
  ): Promise<(string | null)[]> {
    const results: (string | null)[] = new Array(imagePageUrls.length).fill(null);

    // 分批处理，每批 IMAGE_BATCH_SIZE 个
    for (let i = 0; i < imagePageUrls.length; i += IMAGE_BATCH_SIZE) {
      const batch = imagePageUrls.slice(i, i + IMAGE_BATCH_SIZE);
      const batchIndices = batch.map((_, j) => i + j);

      // 使用 page.evaluate 在浏览器上下文中批量 fetch
      try {
        const batchResults = await page.evaluate(
          async ({ urls, timeout }: { urls: string[]; timeout: number }) => {
            const results: (string | null)[] = [];

            for (const url of urls) {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const resp = await fetch(url, {
                  signal: controller.signal,
                  credentials: 'include',
                });
                clearTimeout(timeoutId);

                if (!resp.ok) {
                  results.push(null);
                  continue;
                }

                const html = await resp.text();
                const match = html.match(/<img[^>]+id="img"[^>]+src="([^"]+)"/);
                results.push(match ? match[1] : null);
              } catch {
                results.push(null);
              }
            }

            return results;
          },
          { urls: batch, timeout: IMAGE_FETCH_TIMEOUT },
        );

        batchResults.forEach((url, j) => {
          results[batchIndices[j]] = url;
        });
      } catch (err) {
        console.error(logT('log.exhentai.batchFailed', { batch: i }), err);
      }

      // 批间延迟
      if (i + IMAGE_BATCH_SIZE < imagePageUrls.length) {
        await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
      }

      // 进度日志
      const successCount = results.filter(Boolean).length;
      console.log(
        `[ExHentai] 图片 URL 获取进度: ${Math.min(i + IMAGE_BATCH_SIZE, imagePageUrls.length)}/${imagePageUrls.length}（成功 ${successCount}）`,
      );
    }

    return results;
  }

  // 单页爬取

  /**
   * 单页爬取（视频站点接口，E-Hentai 为图库站点，此方法仅返回元信息）。
   */
  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const metadata = await this.extractExtendedMetadata(page);

    return {
      m3u8_url: '',
      title: metadata.title,
      page_url: pageUrl,
      tags: metadata.tags,
      actors: metadata.actors,
      categories: metadata.categories,
      director: metadata.director,
    };
  }

  // 列表页 / URL 归一化

  /**
   * 判断 URL 是否为列表页。
   *
   * E-Hentai URL 模式：
   * - 图库详情页：/g/{id}/{token}/
   * - 搜索页：/?f_search=keyword
   * - 标签页：/tag/{tag}/
   * - 首页：/
   *
   * 只有 /g/ 路径为详情页，其余均为列表页。
   */
  isListingPage(url: string): boolean {
    try {
      const parsed = new URL(url);
      return !parsed.pathname.startsWith('/g/');
    } catch {
      return false;
    }
  }

  /**
   * 爬取列表页，提取所有图库详情页链接（支持翻页）。
   *
   * E-Hentai 列表页翻页机制：
   * - 搜索结果页通过 a#dnext 的 href 跳转到下一页
   * - 下一页 URL 包含 next= 参数（时间戳游标）
   * - 非简单 page=N 参数，需从页面提取下一页 URL
   *
   * @param page - 已导航到列表页的 Playwright Page
   * @param pageUrl - 列表页 URL
   * @param maxPages - 最大翻页数（默认 20）
   * @returns 图库链接数组
   */
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
        console.log(logT('log.exhentai.listPageNoResults', { page: pageNum }));
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

      console.log(logT('log.exhentai.listPageNewResults', { page: pageNum, count: newCount, total: allResults.length }));

      if (newCount === 0) break;

      const nextUrl = await page.evaluate(() => {
        const nextLink = document.querySelector('a#dnext') as HTMLAnchorElement;
        return nextLink?.href || null;
      });

      if (!nextUrl) {
        console.log(logT('log.exhentai.listPageNoNext'));
        break;
      }

      try {
        await page.goto(nextUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (err) {
        console.error(logT('log.exhentai.navNextFailed'), err);
        break;
      }
    }

    return allResults;
  }

  /**
   * 将任意域名的 URL 归一化为表站 URL。
   *
   * exhentai.org → e-hentai.org
   * 用于数据库存储去重。
   */
  normalizeUrl(url: string): string {
    return normalizeToEhentai(url);
  }

  /**
   * 获取多域名自适应 URL。
   *
   * 表站优先，里站作为备选（如果配置了 Cookie）。
   */
  getAdaptiveUrls(url: string): string[] {
    const galleryId = extractGalleryId(url);
    if (!galleryId) return [url];

    const tokenMatch = url.match(/\/g\/\d+\/([a-f0-9]+)\//);
    const token = tokenMatch ? tokenMatch[1] : '';

    if (!token) return [url];

    const urls = [`${BASE_E_URL}/g/${galleryId}/${token}/`];

    // 如果配置了里站 Cookie，添加里站 URL
    if (getExhentaiCookies()) {
      urls.push(`${BASE_EX_URL}/g/${galleryId}/${token}/`);
    }

    return urls;
  }
}

export { extractGalleryId, normalizeToEhentai, isExUrl, CATEGORY_LABELS, CATEGORY_NAMES };
