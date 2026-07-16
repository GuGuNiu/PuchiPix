import type { Page, BrowserContext } from 'playwright';
import type { ScrapeResult } from '@/types';

/**
 * 站点基础配置信息。
 * 每个站点提供者都需要提供这些基本信息。
 */
export interface SiteConfig {
  /** 站点唯一标识（如 "kanav"） */
  readonly id: string;
  /** 站点显示名称（如 "KanAV"） */
  readonly name: string;
  /** 站点基础 URL（如 "https://kanav.ad"） */
  readonly baseUrl: string;
  /** 是否启用该站点 */
  readonly enabled: boolean;
}

/**
 * 从搜索结果页提取的单条结果。
 */
export interface SiteSearchResult {
  /** 视频详情页 URL */
  url: string;
  /** 视频标题（从搜索列表提取） */
  title: string;
  /** 封面图 URL（如有） */
  coverUrl?: string;
  /** 发布日期（YYYY-MM-DD 格式，如有） */
  date?: string;
}

/**
 * 同系列视频项（多标签识别结果）。
 */
export interface SeriesItem {
  /** 视频详情页 URL */
  url: string;
  /** 视频标题 */
  title: string;
  /** 视频 ID */
  id: string;
}

/**
 * 单条站点元信息（标题、标签、演员）。
 */
export interface SiteMetadata {
  title: string;
  tags: string[];
  actors: string[];
}

/**
 * 扩展元信息（包含分类、多标签、屏蔽状态等）。
 */
export interface ExtendedMetadata extends SiteMetadata {
  /** 分类数组 */
  categories: string[];
  /** 导演/系列 */
  director: string;
  /** 同系列视频列表（多标签识别） */
  series: SeriesItem[];
  /** 是否应被屏蔽 */
  blocked: boolean;
  /** 屏蔽原因 */
  blockReason?: string;
}

/**
 * 图库站点提供者接口（可选实现）。
 *
 * 支持图库（图片+视频）爬取的站点实现此接口，
 * 提供多页图库爬取、主角定位等图库特有功能。
 */
export interface GallerySiteProvider {
  /** 爬取完整图库（所有页面的图片和视频） */
  scrapeGallery(page: Page, pageUrl: string): Promise<import('@/types').GalleryScrapeResult>;

  /**
   * 是否支持 HTTP 方式爬取图库（无需 Playwright 浏览器）。
   *
   * 服务端渲染的站点（如 WordPress）可返回 true，
   * 由调用方优先使用 scrapeGalleryHttp 路径，
   * 避免浏览器启动和导航开销。
   *
   */
  supportsHttpScrape?: boolean;

  /**
   * 使用 HTTP 方式爬取完整图库（无需 Playwright）。
   *
   * 适用服务端渲染站点，直接 fetch HTML + cheerio 解析，
   * 跳过浏览器启动/导航/渲染开销。
   *
   * @param pageUrl - 图库详情页 URL
   * @returns 爬取结果（与 scrapeGallery 相同格式）
   */
  scrapeGalleryHttp?(pageUrl: string): Promise<import('@/types').GalleryScrapeResult>;

  /**
   * 设置浏览器上下文（用于 Cookie 注入等站点特定配置）。
   *
   * 需要登录态的站点（如 ExHentai 里站）实现此方法，
   * 在 page.goto 之前注入 Cookie。
   *
   * 由调用方（tasks/route.ts、search-engine.ts）在创建页面后、导航前调用。
   *
   * @param context - Playwright BrowserContext
   */
  setupBrowserContext?(context: BrowserContext): Promise<void>;

  /**
   * 判断 URL 是否为列表页（标签页、搜索页、分类页等），而非单个图包详情页
   *
   * 可选实现：未实现时 POST /api/tasks 按图包详情页处理
   *
   */
  isListingPage?(url: string): boolean;

  /**
   * 爬取列表页，提取所有图包详情页链接（支持翻页）
   *
   * @param page - 已导航到列表页的 Playwright Page
   * @param pageUrl - 列表页 URL
   * @returns 图包链接数组（url + title + coverUrl + date）
   */
  scrapeListingPage?(page: Page, pageUrl: string, maxPages?: number): Promise<SiteSearchResult[]>;

  /**
   * 将任意域名的 URL 归一化为主域名 URL
   *
   * 用于数据库存储去重：同一图包无论从哪个镜像域名爬取，
   * 存储的 sourceUrl 都使用主域名
   *
   */
  normalizeUrl?(url: string): string;
}

/**
 * 内容屏蔽检查结果。
 *
 * 统一的内容屏蔽检查结果接口，所有站点提供者都应实现此返回格式。
 *
 */
export interface BlockCheckResult {
  /** 是否被屏蔽 */
  blocked: boolean;
  /** 屏蔽原因（未被屏蔽时为 undefined） */
  reason?: string;
}

/**
 * 站点提供者接口。
 *
 * 每个站点实现此接口，封装该站点特有的：
 * - 搜索 URL 构造方式
 * - 搜索结果页 DOM 选择器
 * - 标题清洗规则（去除站点后缀等）
 * - 播放按钮选择器
 * - URL 匹配规则
 * - 内容屏蔽检查
 * - 多域名自适应（可选）
 *
 */
export interface SiteProvider extends SiteConfig {
  /**
   * 根据关键词构造搜索页面 URL。
   * @param keyword - 搜索关键词
   * @returns 完整的搜索页面 URL
   */
  buildSearchUrl(keyword: string): string;

  /**
   * 从已打开的搜索结果页面提取视频链接列表。
   * @param page - Playwright Page 实例（已导航到搜索页）
   * @returns 视频详情页链接数组
   */
  extractSearchResults(page: Page): Promise<SiteSearchResult[]>;

  /**
   * 从已打开的视频页面提取元信息（标题、标签、演员）。
   * @param page - Playwright Page 实例（已导航到视频页）
   * @returns 包含标题、标签、演员的对象
   */
  extractMetadata(page: Page): Promise<{
    title: string;
    tags: string[];
    actors: string[];
  }>;

  /**
   * 从已打开的视频页面提取完整的元信息（包含分类、同系列等多标签数据）。
   *
   * 可选实现：站点可提供更丰富的元信息提取，包含分类、同系列视频列表等。
   * 默认实现委托给 extractMetadata。
   *
   * @param page - Playwright Page 实例（已导航到视频页）
   * @returns 扩展的元信息对象
   */
  extractExtendedMetadata?(page: Page): Promise<ExtendedMetadata>;

  /**
   * 清洗原始标题，去除站点前缀和后缀。
   * @param rawTitle - 从页面提取的原始标题
   * @returns 清洗后的纯视频标题
   */
  cleanTitle(rawTitle: string): string;

  /**
   * 执行完整的视频页面爬取流程（M3U8 拦截 + 元信息提取 + 播放按钮点击）。
   * @param page - Playwright Page 实例（已导航到视频页）
   * @param pageUrl - 视频页面 URL
   * @returns 爬取结果（M3U8 URL、标题、标签、演员）
   */
  scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult>;

  /** 播放按钮 CSS 选择器列表（用于自动点击触发 M3U8 请求） */
  readonly playButtonSelectors: string[];

  /** 需要排除的 M3U8 URL 关键词（广告、统计等） */
  readonly m3u8ExcludePatterns: string[];

  /**
   * 判断给定 URL 是否属于该站点。
   * @param url - 待判断的 URL
   * @returns 是否匹配
   */
  matchesUrl(url: string): boolean;

  /**
   * 检查内容是否应被屏蔽。
   *
   * 统一的内容屏蔽检查接口，各站点实现自己的屏蔽规则：
   * - KanAV：屏蔽 AI 生成内容、同人作品、动漫番剧
   * - 爱妹子：屏蔽 AI 生成内容、特定分类
   *
   * @param title - 视频/图库标题
   * @param category - 分类/标签字符串（逗号分隔）
   * @param protagonist - 主角名（可选）
   * @returns 屏蔽检查结果
   */
  checkContentBlocked(
    title: string,
    category: string,
    protagonist?: string
  ): BlockCheckResult;

  /**
   * 异步检查内容是否应被屏蔽（含数据库用户自定义规则）。
   *
   * 先执行默认配置检查（同步），未命中时再查数据库用户自定义规则。
   * 爬取流程中应优先使用此方法以同时覆盖默认规则和用户自定义规则。
   *
   * @param title - 视频/图库标题
   * @param category - 分类/标签字符串
   * @param protagonist - 主角名（可选）
   * @returns 屏蔽检查结果
   */
  checkContentBlockedAsync?(
    title: string,
    category: string,
    protagonist?: string
  ): Promise<BlockCheckResult>;

  /**
   * 获取多域名自适应 URL 列表。
   *
   * 对于拥有多个镜像域名的站点，返回按健康度排序的 URL 列表。
   * 不支持多域名的站点可返回单元素数组 [originalUrl]。
   *
   * @param url - 原始 URL
   * @returns 按优先级排列的域名 URL 列表
   */
  getAdaptiveUrls?(url: string): string[];

  /**
   * 获取搜索页面的多域名自适应 URL 列表。
   *
   * 与 getAdaptiveUrls 类似，但用于搜索 URL。
   * 不支持多域名的站点可返回单元素数组 [buildSearchUrl(keyword)]。
   *
   * @param keyword - 搜索关键词
   * @returns 按优先级排列的搜索 URL 列表
   */
  getAdaptiveSearchUrls?(keyword: string): string[];

  /**
   * 标记域名为被限流（403/429）。
   *
   * 由调用方在检测到 HTTP 403/429 时调用。
   * 不支持多域名的站点可为空实现。
   *
   * @param domain - 域名
   */
  markDomainRateLimited?(domain: string): void;

  /**
   * 标记域名为健康。
   *
   * 由调用方在域名成功响应时调用。
   * 不支持多域名的站点可为空实现。
   *
   * @param domain - 域名
   */
  markDomainHealthy?(domain: string): void;
}

/** 站点类型：photo = 写真站，video = 视频站 */
export type SiteType = 'photo' | 'video';

/** 徽章配色方案 */
export interface BadgeTheme {
  /** 渐变色 CSS 值 */
  gradient: string;
  /** 实色兜底 */
  solidColor: string;
  /** 文字颜色 */
  textColor: string;
}

/**
 * 传递给前端的站点信息。
 *
 * 除了基础信息外，还携带展示元信息（中英文名、徽章配色、站点类型），
 * 这些信息来源于 site-modules.ts 中的统一配置。
 */
export interface SiteInfo {
  id: string;
  /** 站点显示名称（兼容旧字段，等于 nameCn） */
  name: string;
  /** 中文名 */
  nameCn: string;
  /** 英文名 */
  nameEn: string;
  baseUrl: string;
  enabled: boolean;
  /** 站点类型：photo = 写真站，video = 视频站 */
  type: SiteType;
  /** 徽章配色方案 */
  badge: BadgeTheme;
 /** 图库站点（以图片为主，无视频预览），type === 'photo' 时为 true */
  gallery?: boolean;
}
