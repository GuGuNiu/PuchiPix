/**
 * sites/types.ts — 站点提供者类型定义
 *
 * 定义站点提供者（SiteProvider）接口，每个站点实现此接口，
 * 提供站点特定的搜索、爬取、标题清洗等逻辑。
 *
 * 架构设计：
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │                   SiteRegistry                       │
 *   │   (管理所有 Provider，根据 URL 路由到正确的 Provider)  │
 *   └──────────────┬──────────────────────┬───────────────┘
 *                  │                      │
 *         ┌────────▼────────┐   ┌────────▼────────┐
 *         │  KanavProvider   │   │  XxxProvider    │  ← 未来扩展
 *         │  (kanav.ad)      │   │  (其他站点)      │
 *         └─────────────────┘   └─────────────────┘
 *                  │
 *         ┌────────▼────────────────────────────┐
 *         │        BaseSiteProvider              │
 *         │  (通用爬取逻辑：M3U8 拦截、播放按钮    │
 *         │   点击、JS 扫描、标签/演员提取)        │
 *         └─────────────────────────────────────┘
 *
 * 展示元信息（中英文名、徽章配色、站点类型等）由 site-modules.ts
 * 统一管理，SiteInfo 接口携带这些信息传递给前端。
 */

import type { Page } from 'playwright';
import type { ScrapeResult } from '@/types';

// ============================================================
// 站点配置（静态元信息）
// ============================================================

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

// ============================================================
// 搜索结果类型
// ============================================================

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

// ============================================================
// 图库站点提供者接口（可选实现）
// ============================================================

/**
 * 图库站点提供者接口（可选实现）。
 *
 * 支持图库（图片+视频）爬取的站点实现此接口，
 * 提供多页图库爬取、主角定位等图库特有功能。
 */
export interface GallerySiteProvider {
  /** 爬取完整图库（所有页面的图片和视频） */
  scrapeGallery(page: Page, pageUrl: string): Promise<import('@/types').GalleryScrapeResult>;
}

// ============================================================
// 站点提供者接口
// ============================================================

/**
 * 站点提供者接口。
 *
 * 每个站点实现此接口，封装该站点特有的：
 * - 搜索 URL 构造方式
 * - 搜索结果页 DOM 选择器
 * - 标题清洗规则（去除站点后缀等）
 * - 播放按钮选择器
 * - URL 匹配规则
 *
 * 通用逻辑（M3U8 拦截、标签提取、演员提取等）由 BaseSiteProvider 提供。
 */
export interface SiteProvider extends SiteConfig {
  // ============================================================
  // 搜索相关
  // ============================================================

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

  // ============================================================
  // 视频页面爬取相关
  // ============================================================

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

  // ============================================================
  // 选择器配置
  // ============================================================

  /** 播放按钮 CSS 选择器列表（用于自动点击触发 M3U8 请求） */
  readonly playButtonSelectors: string[];

  /** 需要排除的 M3U8 URL 关键词（广告、统计等） */
  readonly m3u8ExcludePatterns: string[];

  // ============================================================
  // URL 匹配
  // ============================================================

  /**
   * 判断给定 URL 是否属于该站点。
   * @param url - 待判断的 URL
   * @returns 是否匹配
   */
  matchesUrl(url: string): boolean;
}

// ============================================================
// 前端展示用的站点信息（轻量级，不含方法）
// ============================================================

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
