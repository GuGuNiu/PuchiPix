import type { Page, BrowserContext } from 'playwright';
import { BaseSiteProvider } from '../base-provider';
import type { ExtendedMetadata, GallerySiteProvider, SiteSearchResult, BlockCheckResult } from '../types';
import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
  ScrapeResult,
} from '@/types';
import { MAX_GALLERY_PAGES, PAGE_DELAY_MIN, PAGE_DELAY_MAX, randomDelay, sleep } from '@/lib/core/anti-crawler';
import { DomainHealthTracker } from '@/lib/core/domain-health-tracker';
import { getSiteAccountManager, type CookieData } from '../site-account-manager';
import { logT } from '@/lib/i18n/server';
import {
  extractDownloadLinksFromPage,
  isThreadPurchasable,
} from '../sjs-actions';
import { getProtagonistService } from '@/lib/protagonist/protagonist-service';

/** 司机社多域名列表（主域名优先） */
const SITE_DOMAINS = [
  'https://sjs66.com',
  'https://sjs47.com',
  'https://sjs47.net',
  'https://sjslt.cc',
  'https://xsijishe.net',
];

/** 主域名（用于 URL 归一化） */
const PRIMARY_DOMAIN = 'https://sjs66.com';

/** Discuz Cookie 前缀 */
const DISCUZ_COOKIE_PREFIX = 'SgL6_2132_';

/** 图片占位图 URL（Discuz 懒加载占位 GIF） */
const PLACEHOLDER_GIF = '/static/image/common/none.gif';

/**
 * 从帖子 URL 中提取帖子 ID。
 *
 * thread-707390-1-1.html → "707390"
 * forum.php?mod=viewthread&tid=707390 → "707390"
 */
export function extractThreadId(url: string): string | null {
  // 匹配 thread-{tid}-{page}-{fid}.html
  const match1 = url.match(/thread-(\d+)-\d+-\d+\.html/);
  if (match1) return match1[1];

  // 匹配 mod=viewthread&tid={tid}
  const match2 = url.match(/[?&]tid=(\d+)/);
  if (match2) return match2[1];

  return null;
}

/**
 * 从版块 URL 中提取版块 ID。
 *
 * forum-2-1.html → "2"
 */
export function extractForumId(url: string): string | null {
  const match = url.match(/forum-(\d+)-\d+\.html/);
  return match ? match[1] : null;
}

/**
 * 将任意域名 URL 替换为指定域名。
 */
function replaceDomain(url: string, targetDomain: string): string {
  return url.replace(/^https?:\/\/[^/]+/, targetDomain);
}

/** 域名健康度跟踪器 */
const domainHealthTracker = new DomainHealthTracker();

export class SjsProvider extends BaseSiteProvider implements GallerySiteProvider {
  readonly id = 'sjs';
  readonly name = '司机社';
  readonly baseUrl = PRIMARY_DOMAIN;
  readonly enabled = true;

  readonly playButtonSelectors: string[] = [];
  readonly m3u8ExcludePatterns: string[] = ['ad', 'stat', 'analytics'];

  /** 所有镜像域名 */
  readonly domains: string[] = SITE_DOMAINS;

  /** 当前使用的账户 ID（登录后设置） */
  private currentAccountId: number | null = null;

  /**
   * 设置浏览器上下文 Cookie。
   *
   * 从数据库读取账户的认证 Cookie 并注入到浏览器上下文。
   * 如果没有有效 Cookie，将触发登录流程。
   *
   * @param context - Playwright BrowserContext
   */
  async setupBrowserContext(context: BrowserContext): Promise<void> {
    const accountManager = getSiteAccountManager();
    const account = await accountManager.getAvailableAccount(this.id);

    if (!account) {
      console.warn(logT('log.sjs.noAccount'));
      return;
    }

    this.currentAccountId = account.id;

    // 尝试从数据库获取已有 Cookie
    const cookies = await accountManager.getAuthCookies(account.id);

    if (cookies && cookies.length > 0) {
      // 注入已有 Cookie（为所有域名设置）
      const allCookies = [];
      for (const domain of SITE_DOMAINS) {
        const parsedDomain = new URL(domain).hostname;
        for (const cookie of cookies) {
          allCookies.push({
            ...cookie,
            domain: parsedDomain,
          });
        }
      }

      try {
        await context.addCookies(allCookies);
        console.log(logT('log.sjs.cookieInjected', { id: account.id, count: cookies.length }));
      } catch (err) {
        console.warn(logT('log.sjs.cookieInjectionFailed'), err);
      }
    } else {
      // 没有有效 Cookie，执行登录
      console.log(logT('log.sjs.noCookieStartLogin'));
      await this.performLogin(context, account.id, account.username, account.password);
    }
  }

  /**
   * 执行 Discuz 论坛登录流程。
   *
   - 导航到登录页面
   - 填写用户名、密码，勾选自动登录
   - 提交表单
   - 验证登录成功
   - 获取并保存 Cookie
   *
   * @param context - Playwright BrowserContext
   * @param accountId - 账户 ID
   * @param username - 登录账号
   * @param password - 登录密码
   */
  private async performLogin(
    context: BrowserContext,
    accountId: number,
    username: string,
    password: string,
  ): Promise<void> {
    const accountManager = getSiteAccountManager();
    const domain = domainHealthTracker.getBestDomain(SITE_DOMAINS);

    const page = await context.newPage();

    try {
      const loginUrl = `${domain}/member.php?mod=logging&action=login`;
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const loginForm = await page.locator('form[id^="loginform_"]').first();
      if (!loginForm) {
        throw new Error('未找到登录表单');
      }

      const _formhash = await page.locator('form[id^="loginform_"] input[name="formhash"]').inputValue();

      const formId = await loginForm.getAttribute('id');
      const suffix = formId?.replace('loginform_', '') || '';

      await page.locator(`#username_${suffix}`).fill(username);
      await page.locator(`#password3_${suffix}`).fill(password);
      await page.locator(`#cookietime_${suffix}`).check().catch(() => {});

      await page.locator(`form#loginform_${suffix} button[type="submit"], form#loginform_${suffix} input[type="submit"]`).click();

      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});

      await page.goto(`${domain}/`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

      const logoutLink = await page.locator('a[href*="action=logout"]').first();
      const isLoggedIn = await logoutLink.isVisible({ timeout: 5000 }).catch(() => false);

      if (!isLoggedIn) {
        throw new Error('登录失败：未检测到登录状态');
      }

      const cookies = await context.cookies();
      const sjsCookies = cookies
        .filter((c) => {
          const hostname = new URL(domain).hostname;
          return c.domain.includes(hostname);
        })
        .map((c): CookieData => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
          ...(c.expires > 0 ? { expires: c.expires } : {}),
        }));

      if (sjsCookies.length === 0) {
        throw new Error('登录后未获取到 Cookie');
      }

      await accountManager.saveAuthCookies(accountId, sjsCookies, DISCUZ_COOKIE_PREFIX);
      console.log(logT('log.sjs.loginSuccess', { id: accountId, count: sjsCookies.length }));

      // 标记域名健康
      domainHealthTracker.markHealthy(domain);

    } catch (err) {
      console.error(logT('log.sjs.loginFailed'), err);
      await accountManager.markLoginFailed(accountId, err instanceof Error ? err.message : String(err));

      // 尝试切换域名重试
      domainHealthTracker.markRateLimited(domain);

      throw new Error(`司机社登录失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /**
   * 构造搜索页面 URL。
   *
   * Discuz 搜索 URL 格式：
   * search.php?mod=forum&srchtxt=keyword&searchsubmit=yes
   *
   * 搜索提交后会重定向到带 searchid 的结果页。
   */
  buildSearchUrl(keyword: string): string {
    const domain = domainHealthTracker.getBestDomain(SITE_DOMAINS);
    return `${domain}/search.php?mod=forum&srchtxt=${encodeURIComponent(keyword)}&searchsubmit=yes`;
  }

  /**
   * 获取搜索页面的多域名自适应 URL 列表。
   */
  getAdaptiveSearchUrls(keyword: string): string[] {
    const encoded = encodeURIComponent(keyword);
    const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
    return orderedDomains.map((d) => `${d}/search.php?mod=forum&srchtxt=${encoded}&searchsubmit=yes`);
  }

  /**
   * 清洗原始标题。
   *
   * 去除 Discuz 页面标题中的站点后缀：
   * "帖子标题 - 视图写真 - 司机社 - 求出处?..." → "帖子标题"
   */
  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';

    let title = rawTitle.trim();

    // 去除站点后缀链：" - 版块名 - 司机社 - 求出处?..."
    title = title.replace(/\s*-\s*司机社\s*-\s*求出处.*$/i, '');
    title = title.replace(/\s*-\s*司机社.*$/i, '');

    // 去除版块名后缀：" - 视图写真"
    title = title.replace(/\s*-\s*(视图写真|飙车场|求出处|国产视频|欧美视频|日本AV|网黄博主资源|VR视频|AI合成视频|图生视频|2D动漫|3D动漫|本子|PC游戏|手机游戏|悬赏区|色情文学|闲聊|GIF出处)\s*$/i, '');

    title = title
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    return title.trim();
  }

  /**
   * 判断 URL 是否属于司机社。
   *
   * 匹配域名：sjs66.com, sjs47.com, sjs47.net, sjslt.cc
   */
  matchesUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'sjs66.com' ||
        hostname === 'www.sjs66.com' ||
        hostname === 'sjs47.com' ||
        hostname === 'www.sjs47.com' ||
        hostname === 'sjs47.net' ||
        hostname === 'www.sjs47.net' ||
        hostname === 'sjslt.cc' ||
        hostname === 'www.sjslt.cc' ||
        hostname === 'xsijishe.net' ||
        hostname === 'www.xsijishe.net' ||
        hostname.endsWith('.sjs66.com') ||
        hostname.endsWith('.sjs47.com') ||
        hostname.endsWith('.sjs47.net') ||
        hostname.endsWith('.sjslt.cc') ||
        hostname.endsWith('.xsijishe.net')
      );
    } catch {
      return false;
    }
  }

  /**
   * 检查内容是否应被屏蔽。
   *
   * 司机社默认不屏蔽任何内容。
   * 后续可根据需要添加屏蔽规则。
   */
  checkContentBlocked(
    _title: string,
    _category: string,
    _protagonist?: string,
  ): BlockCheckResult {
    return { blocked: false, reason: undefined };
  }

  /**
   * 从搜索结果页面提取帖子链接列表。
   *
   * Discuz 搜索结果页结构：
   * - 搜索结果项：li.nexwateritems
   * - 帖子链接：a[href*="mod=viewthread&tid="]
   * - 标题：链接文本或链接内文本
   * - 作者：li 内的用户名文本
   * - 回复数：li 内的数字
   *
   * 注意：搜索结果 URL 使用 forum.php?mod=viewthread&tid=xxx 格式，
   * 需要转换为 thread-{tid}-1-1.html 格式进行归一化。
   */
  async extractSearchResults(page: Page): Promise<SiteSearchResult[]> {
    return page.evaluate(() => {
      const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
      const seen = new Set<string>();

      // 搜索结果列表项
      const items = document.querySelectorAll('li.nexwateritems');

      items.forEach((item) => {
        const link = item.querySelector('a[href*="mod=viewthread&tid="]') as HTMLAnchorElement;
        if (!link) return;

        const tidMatch = link.href.match(/tid=(\d+)/);
        if (!tidMatch) return;
        const tid = tidMatch[1];

        // 构造标准帖子 URL
        const url = `${window.location.origin}/thread-${tid}-1-1.html`;
        if (seen.has(tid)) return;
        seen.add(tid);

        let title = link.textContent?.trim() || '';
        if (!title) {
          const h3 = item.querySelector('h3 a, h3');
          title = h3?.textContent?.trim() || '';
        }

        let date: string | undefined;
        const allText = item.textContent || '';
        const dateMatch = allText.match(/(\d{4}-\d{1,2}-\d{1,2}|\d+分钟前|\d+小时前|昨天|前天|\d+天前)/);
        if (dateMatch) {
          date = dateMatch[1];
        }

        results.push({ url, title, date });
      });

      return results.slice(0, 30);
    });
  }

  /**
   * 从帖子详情页提取扩展元信息。
   *
   * Discuz 帖子页面结构：
   * - 标题：#thread_subject
   * - 第一楼帖子：#postlist > div[id^="post_"]
   * - 作者：.authi a
   * - 日期：.authi em
   * - 内容：.t_f
   */
  async extractExtendedMetadata(page: Page): Promise<ExtendedMetadata> {
    const raw = await page.evaluate(() => {
      // 帖子标题
      const titleEl = document.querySelector('#thread_subject');
      const title = titleEl?.textContent?.trim() || document.title || '';

      // 第一楼帖子
      const firstPost = document.querySelector('#postlist div[id^="post_"]');
      const authorEl = firstPost?.querySelector('.authi a, .pi .authi a');
      const author = authorEl?.textContent?.trim() || '';

      // 日期
      const dateEl = firstPost?.querySelector('.authi em, .pti .authi em');
      const dateText = dateEl?.textContent?.trim() || '';
      let date = '';
      const dateMatch = dateText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
      if (dateMatch) {
        date = dateMatch[1];
      } else {
        // Discuz 相对时间格式："发表于 5 小时前"
        const relMatch = dateText.match(/发表于\s*(.+)/);
        if (relMatch) {
          date = relMatch[1];
        }
      }

      // 版块/分类（从面包屑导航）
      let category = '';
      const breadcrumbLinks = document.querySelectorAll('.z a, #ct .z a');
      if (breadcrumbLinks.length >= 2) {
        category = breadcrumbLinks[breadcrumbLinks.length - 1]?.textContent?.trim() || '';
      }

      // 标签（Discuz 帖子可能有标签）
      const tags: string[] = [];
      document.querySelectorAll('.ptg a, .ptg mbk a').forEach((a) => {
        const text = a.textContent?.trim();
        if (text && text.length < 30) tags.push(text);
      });

      // meta keywords
      const metaKeywords = document.querySelector('meta[name="keywords"]');
      const keywordStr = metaKeywords?.getAttribute('content') || '';

      // 封面图（帖子内第一张图片）
      let coverUrl = '';
      const contentEl = firstPost?.querySelector('.t_f');
      if (contentEl) {
        const imgs = contentEl.querySelectorAll('img');
        for (const img of imgs) {
          const file = img.getAttribute('file') || '';
          const src = img.getAttribute('src') || '';
          const url = file || src;
          if (url && !url.includes('/static/image/common/none.gif') && !url.startsWith('data:')) {
            coverUrl = url;
            break;
          }
        }
      }

      return {
        title,
        author,
        date,
        category,
        tags,
        keywordStr,
        coverUrl,
        documentTitle: document.title,
      };
    });

    const title = this.cleanTitle(raw.title || raw.documentTitle);

    const metaKeywords = raw.keywordStr
      .split(/[,，;；]/)
      .map((t) => t.trim())
      .filter((t) => t && t.length < 50 && !raw.tags.includes(t));

    return {
      title,
      tags: [...raw.tags, ...metaKeywords],
      actors: raw.author ? [raw.author] : [],
      categories: raw.category ? [raw.category] : [],
      director: raw.author,
      series: [],
      blocked: false,
    };
  }

  /**
   * 爬取完整帖子（所有页面的图片和视频）。
   *
   * Discuz 帖子图片采集策略：
   * - 第一楼帖子内容 .t_f 中的所有 img[file]（实际 URL 在 file 属性中）
   * - 附件下载链接 a[href*="mod=attachment&aid="]（需登录才能下载）
   * - 外链图片（直接 src 属性）
   * - 帖子可能有多页（.pg 分页），需翻页采集
   *
   * @param page - 已导航到帖子详情页的 Playwright Page
   * @param pageUrl - 帖子 URL
   * @returns 图库爬取结果
   */
  async scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult> {
    // 检测付费帖子并解析下载链接
    const pageHtml = await page.content();
    const needsPurchase = isThreadPurchasable(pageHtml);
    const downloadLinks = extractDownloadLinksFromPage(pageHtml);

    if (needsPurchase) {
      console.log(logT('log.sjs.paidContent'));
    } else if (downloadLinks.length > 0) {
      console.log(logT('log.sjs.detectedDownloadLinks', { count: downloadLinks.length }));
    }

    const metadata = await this.extractExtendedMetadata(page);
    const firstPageData = await this.extractPostContent(page, 0);
    const totalPages = await this.getThreadTotalPages(page);
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

    // 翻页采集
    const threadId = extractThreadId(pageUrl);
    const forumId = extractForumId(pageUrl) || '1';

    for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
      await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));

      const pageUrlConstructed = `${this.baseUrl}/thread-${threadId}-${pageNum}-${forumId}.html`;

      try {
        await page.goto(pageUrlConstructed, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        const pageData = await this.extractPostContent(page, pageNum - 1);

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

        console.log(logT('log.sjs.pageNewImages', { page: pageNum, total: allImages.length }));
      } catch (err) {
        console.error(logT('log.sjs.scrapePageFailed', { page: pageNum }), err);
        break;
      }
    }

    // 标记账户已使用
    if (this.currentAccountId) {
      const accountManager = getSiteAccountManager();
      await accountManager.markUsed(this.currentAccountId).catch(() => {});
    }

    // 记录实际使用的域名
    let scrapedDomain = '';
    try {
      const parsed = new URL(pageUrl);
      scrapedDomain = `${parsed.protocol}//${parsed.host}`;
    } catch {
    }

    const protagonist = await this.extractProtagonist(metadata.title, metadata.tags);

    // 游戏角色识别服务不可用时忽略
    let gameCharacters: string[] | undefined;
    try {
      const { getGameCharacterService } = await import('@/lib/game-characters/game-character-service');
      const charService = getGameCharacterService();
      const charMatches = await charService.identifyInTags(metadata.tags);
      gameCharacters = charMatches.length > 0 ? charMatches.map((m) => m.character.name) : undefined;
    } catch {
    }

    return {
      sourceUrl: pageUrl,
      title: metadata.title,
      protagonist,
      description: metadata.title,
      category: metadata.categories[0] || '',
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
      // 付费帖子相关
      needsPurchase,
      downloadLinks: downloadLinks.length > 0 ? downloadLinks : undefined,
    };
  }

  /**
   * 从帖子页面提取图片、视频和封面信息。
   *
   * Discuz 帖子图片结构：
   * - 懒加载图片：img[file="actual_url"]，src 为占位 GIF
   * - 附件图片：img[aid="xxx"]，file 属性为实际 URL
   * - 外链图片：img[src="http://..."]，无 file 属性
   *
   * @param page - 已导航到帖子页的 Playwright Page
   * @param pageIndex - 页码索引
   */
  private async extractPostContent(
    page: Page,
    pageIndex: number,
  ): Promise<{
    images: { url: string; pageIndex: number }[];
    videos: string[];
    coverUrl: string;
    publishTime: string;
  }> {
    return page.evaluate(
      ({ pageIndex, placeholderGif }) => {
        const images: { url: string; pageIndex: number }[] = [];
        const videos: string[] = [];
        let coverUrl = '';
        let publishTime = '';

        // 第一楼帖子内容
        const firstPost = document.querySelector('#postlist div[id^="post_"]');
        if (!firstPost) {
          return { images, videos, coverUrl, publishTime };
        }

        const contentEl = firstPost.querySelector('.t_f');
        if (!contentEl) {
          return { images, videos, coverUrl, publishTime };
        }

        // 图片采集
        const imgs = contentEl.querySelectorAll('img');
        imgs.forEach((img) => {
          const file = img.getAttribute('file') || '';
          const src = img.getAttribute('src') || '';

          // 优先使用 file 属性（Discuz 懒加载的实际 URL）
          let url = file;
          if (!url || url.includes(placeholderGif)) {
            // 如果 file 也是占位图或为空，尝试 src
            url = src;
          }

          if (
            url &&
            !url.includes(placeholderGif) &&
            !url.startsWith('data:') &&
            !url.includes('/static/image/common/')
          ) {
            images.push({ url, pageIndex });

            // 第一张有效图片作为封面
            if (!coverUrl) {
              coverUrl = url;
            }
          }
        });

        // 视频采集
        contentEl.querySelectorAll('video source, video, embed, iframe').forEach((el) => {
          const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
          if (src && (src.includes('.mp4') || src.includes('.m3u8') || src.includes('.flv'))) {
            videos.push(src);
          }
        });

        // 帖子中的视频链接（文本形式）
        contentEl.querySelectorAll('a').forEach((a) => {
          const href = a.href;
          if (href && (href.includes('.mp4') || href.includes('.m3u8'))) {
            videos.push(href);
          }
        });

        // 发布时间
        const dateEl = firstPost.querySelector('.authi em, .pti .authi em');
        const dateText = dateEl?.textContent?.trim() || '';
        const dateMatch = dateText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
        if (dateMatch) {
          publishTime = dateMatch[1];
        }

        return { images, videos, coverUrl, publishTime };
      },
      { pageIndex, placeholderGif: PLACEHOLDER_GIF },
    );
  }

  /**
   * 获取帖子总页数。
   *
   * Discuz 帖子分页结构：
   * .pg .last span 或 .pg a 中的最大页码
   */
  private async getThreadTotalPages(page: Page): Promise<number> {
    return page.evaluate(() => {
      // 尝试从分页链接中获取最大页码
      const pageLinks = document.querySelectorAll('.pg a, .pgs a');
      let maxPage = 1;

      pageLinks.forEach((a) => {
        const text = a.textContent?.trim() || '';
        const num = parseInt(text);
        if (!isNaN(num) && num > maxPage) {
          maxPage = num;
        }
      });

      // 尝试从 .last span 获取
      const lastSpan = document.querySelector('.pg .last span, .pgs .last span');
      if (lastSpan) {
        const text = lastSpan.textContent?.trim() || '';
        const num = parseInt(text);
        if (!isNaN(num) && num > maxPage) {
          maxPage = num;
        }
      }

      // 也检查 .pg label input 的 title 属性
      const pageInput = document.querySelector('.pg label input, .pgs label input') as HTMLInputElement;
      if (pageInput) {
        const title = pageInput.getAttribute('title') || '';
        const match = title.match(/(\d+)/);
        if (match) {
          const num = parseInt(match[1]);
          if (num > maxPage) {
            maxPage = num;
          }
        }
      }

      return maxPage;
    });
  }

  /**
   * 从标题中智能提取主角名
   *
   * 委托给 ProtagonistService.extractFromTitleSmart 进行 6 级策略解析。
   * 司机社帖子标题格式多样：
   * - "coser[林檎蜜纪]两套..." → 林檎蜜纪
   * - "鱼子酱Fish（私拍）- 山青涩" → 鱼子酱Fish
   * - "爆机少女喵小吉 - 浣溪沙" → 爆机少女喵小吉
   * - "[JVID] G奶女神媛媛..." → G奶女神媛媛
   *
   * @param title - 帖子标题
   * @param tags - 标签列表
   * @returns 提取到的主角名，无法确定返回空字符串
   *
   */
  private async extractProtagonist(title: string, tags: string[] = []): Promise<string> {
    if (!title) return '';
    const service = getProtagonistService();
    const name = await service.extractFromTitleSmart(title, tags);

    // 自动学习
    if (name) {
      service.learnPerson(name).catch((err) => {
        console.warn(logT('log.sjs.learnPersonFailed'), err);
      });
    }

    return name;
  }

  /**
   * 单页爬取（视频站点接口，司机社为图库站点，此方法仅返回元信息）。
   */
  async scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult> {
    const metadata = await this.extractExtendedMetadata(page);

    const videos: string[] = [];
    const contentEl = await page.evaluate(() => {
      const firstPost = document.querySelector('#postlist div[id^="post_"]');
      return firstPost?.querySelector('.t_f')?.innerHTML || '';
    });

    const videoMatches = contentEl.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|flv)[^\s"'<>]*/gi);
    if (videoMatches) {
      videos.push(...videoMatches);
    }

    const m3u8Url = videos.find((v) => v.includes('.m3u8')) || '';

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
   * 判断 URL 是否为列表页。
   *
   * 司机社 URL 模式：
   * - 帖子详情页：thread-{tid}-{page}-{fid}.html 或 forum.php?mod=viewthread&tid=xxx
   * - 版块列表页：forum-{fid}-{page}.html 或 forum.php?mod=forumdisplay&fid=xxx
   * - 搜索页：search.php?mod=forum&srchtxt=xxx
   * - 首页：/ 或 forum.php
   *
   * 只有 thread- 和 mod=viewthread 为详情页，其余均为列表页。
   */
  isListingPage(url: string): boolean {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname;
      const query = parsed.searchParams;

      // 帖子详情页
      if (path.match(/thread-\d+-\d+-\d+\.html/)) return false;
      if (query.get('mod') === 'viewthread') return false;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 爬取列表页，提取所有帖子详情页链接（支持翻页）。
   *
   * Discuz 版块列表页结构：
   * - 帖子容器：#threadlisttableid > div[id^="normalthread_"]
   * - 帖子标题：a.s.xst
   * - 分页：forum-{fid}-{page}.html
   *
   * 搜索结果页结构：
   * - 结果项：li.nexwateritems
   * - 帖子链接：a[href*="mod=viewthread&tid="]
   * - 分页：search.php?mod=forum&searchid=xxx&page=N
   */
  async scrapeListingPage(
    page: Page,
    pageUrl: string,
    maxPages: number = 20,
  ): Promise<SiteSearchResult[]> {
    const allResults: SiteSearchResult[] = [];
    const seenTids = new Set<string>();
    const MAX_LISTING_PAGES = Math.min(maxPages, MAX_GALLERY_PAGES);

    const isSearchPage = pageUrl.includes('search.php') || pageUrl.includes('searchid=');

    for (let pageNum = 1; pageNum <= MAX_LISTING_PAGES; pageNum++) {
      if (pageNum > 1) {
        await sleep(randomDelay(PAGE_DELAY_MIN, PAGE_DELAY_MAX));
      }

      const results = isSearchPage
        ? await this.extractSearchResults(page)
        : await this.extractForumListResults(page);

      if (results.length === 0) {
        console.log(logT('log.sjs.listPageNoResults', { page: pageNum }));
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

      console.log(logT('log.sjs.listPageNewResults', { page: pageNum, count: newCount, total: allResults.length }));

      if (newCount === 0) break;

      // 导航到下一页
      const nextUrl = await this.getNextPageUrl(page, pageUrl, pageNum);

      if (!nextUrl) {
        console.log(logT('log.sjs.listPageNoNext'));
        break;
      }

      try {
        await page.goto(nextUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
      } catch (err) {
        console.error(logT('log.sjs.navNextFailed'), err);
        break;
      }
    }

    return allResults;
  }

  /**
   * 从版块列表页提取帖子链接。
   *
   * Discuz 自定义主题版块列表结构：
   * - 帖子容器：#threadlisttableid > div[id^="normalthread_"]
   * - 置顶帖子：#threadlisttableid > div[id^="stickthread_"]
   * - 标题链接：a.s.xst
   */
  private async extractForumListResults(page: Page): Promise<SiteSearchResult[]> {
    return page.evaluate(() => {
      const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
      const seen = new Set<string>();

      // 版块列表中的帖子
      const threadContainers = document.querySelectorAll(
        '#threadlisttableid > div[id^="normalthread_"], #threadlisttableid > div[id^="stickthread_"]'
      );

      threadContainers.forEach((container) => {
        const titleLink = container.querySelector('a.s.xst') as HTMLAnchorElement;
        if (!titleLink) return;

        const href = titleLink.href;
        if (!href || seen.has(href)) return;
        seen.add(href);

        const title = titleLink.textContent?.trim() || '';

        const containerText = container.textContent || '';
        const dateMatch = containerText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
        const date = dateMatch ? dateMatch[1] : undefined;

        results.push({ url: href, title, date });
      });

      return results.slice(0, 50);
    });
  }

  /**
   * 获取下一页 URL。
   *
   * Discuz 分页：
   * - 版块列表：forum-{fid}-{nextPage}.html
   * - 搜索结果：search.php?mod=forum&searchid=xxx&page={nextPage}
   * - 分页链接：.pg a[href] 或 .pgs a[href]
   */
  private async getNextPageUrl(page: Page, currentUrl: string, currentPage: number): Promise<string | null> {
    // 尝试从页面中提取下一页链接
    const nextLink = await page.evaluate(() => {
      const pgLinks = document.querySelectorAll('.pg a, .pgs a');
      for (const link of pgLinks) {
        const text = link.textContent?.trim() || '';
        if (text === '下一页' || text === 'Next' || text === '›' || text === '»') {
          return (link as HTMLAnchorElement).href;
        }
      }
      // 尝试找到数字 "下一页" 的链接
      const nextNum = String(currentPage + 1);
      for (const link of pgLinks) {
        const text = link.textContent?.trim() || '';
        if (text === nextNum) {
          return (link as HTMLAnchorElement).href;
        }
      }
      return null;
    });

    if (nextLink) return nextLink;

    const isSearchPage = currentUrl.includes('search.php') || currentUrl.includes('searchid=');
    if (!isSearchPage) {
      // 版块列表：forum-{fid}-{page}.html
      const forumId = extractForumId(currentUrl);
      if (forumId) {
        return `${this.baseUrl}/forum-${forumId}-${currentPage + 1}.html`;
      }
    }

    return null;
  }

  /**
   * 将任意域名的 URL 归一化为主域名 URL。
   *
   * sjs47.com/thread-xxx → sjs66.com/thread-xxx
   */
  normalizeUrl(url: string): string {
    // 将 forum.php?mod=viewthread&tid=xxx 转换为 thread-xxx-1-1.html
    const tidMatch = url.match(/[?&]tid=(\d+)/);
    if (tidMatch) {
      const fidMatch = url.match(/[?&]fid=(\d+)/);
      const fid = fidMatch ? fidMatch[1] : '1';
      return `${PRIMARY_DOMAIN}/thread-${tidMatch[1]}-1-${fid}.html`;
    }

    return replaceDomain(url, PRIMARY_DOMAIN);
  }

  /**
   * 获取多域名自适应 URL。
   *
   * 健康域名优先（跳房子算法随机起始），
   * 冷却中的域名排在后面。
   */
  getAdaptiveUrls(url: string): string[] {
    const tid = extractThreadId(url);
    if (!tid) return [url];

    const fid = extractForumId(url) || '1';

    const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
    return orderedDomains.map((d) => `${d}/thread-${tid}-1-${fid}.html`);
  }

  markDomainRateLimited(domain: string): void {
    domainHealthTracker.markRateLimited(domain);
  }

  markDomainHealthy(domain: string): void {
    domainHealthTracker.markHealthy(domain);
  }

  /**
   * 将相对 URL 解析为绝对 URL。
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
}
