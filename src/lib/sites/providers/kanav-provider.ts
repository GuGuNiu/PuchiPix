/**
 * sites/providers/kanav-provider.ts — KanAV (kanav.ad) 站点提供者
 *
 * 封装 kanav.ad 站点特有的逻辑：
 *
 * 1. 搜索 URL 构造：
 *    使用 MacCMS 标准搜索路由 /index.php/vod/search.html?wd={keyword}
 *
 * 2. 标题清洗规则：
 *    原始格式："在线播放 - 视频标题 - KanAV-免费高清中文AV在线看"
 *    清洗后：  "视频标题"
 *    - 去除 "在线播放 - " 等常见前缀
 *    - 去除 " - KanAV-免费高清..." 等站点后缀
 *    - 多段分割时取中间部分
 *
 * 3. URL 匹配：
 *    匹配所有包含 "kanav.ad" 的 URL
 *
 * 4. 站点特有选择器：
 *    搜索结果使用 MacCMS 标准选择器（已在基类提供默认值）
 *
 * 5. 多标签（同系列）识别：
 *    从 player_aaaa.vod_data 提取 vod_name/actor/director
 *    从 .video-countext-tags 提取同系列视频链接列表
 *
 * 6. 分类屏蔽：
 *    默认屏蔽"同人作品"、"动漫番剧"分类的视频
 */

import { BaseSiteProvider } from '../base-provider';
import type { ExtendedMetadata, SeriesItem } from '../types';

// ============================================================
// 类型定义
// ============================================================

/** KanAV 播放器数据中的 vod_data 结构 */
interface KanavVodData {
  vod_name: string;
  vod_actor: string;
  vod_director: string;
  vod_class: string;
}

/** KanAV 播放器数据结构 */
interface KanavPlayerData {
  flag: string;
  encrypt: number;
  trysee: number;
  points: number;
  link: string;
  link_next: string;
  link_pre: string;
  vod_data: KanavVodData;
  url: string;
  url_next: string;
  from: string;
  server: string;
  note: string;
  id: string;
  sid: number;
  nid: number;
}

// ============================================================
// KanavProvider 实现
// ============================================================

export class KanavProvider extends BaseSiteProvider {
  // ----------------------------------------------------------
  // 站点基础信息
  // ----------------------------------------------------------

  readonly id = 'kanav';
  readonly name = 'KanAV';
  readonly baseUrl = 'https://kanav.ad';
  readonly enabled = true;

  // ----------------------------------------------------------
  // 站点特有配置
  // ----------------------------------------------------------

  /** 需要屏蔽的分类关键词 */
  readonly blockedCategories: string[] = [
    '同人作品',
    '同人',
    '动漫番剧',
    '动漫',
  ];

  /** 需要屏蔽的导演关键词（同分类屏蔽） */
  readonly blockedDirectorKeywords: string[] = [
    '同人作品',
    '同人',
    '动漫番剧',
    '动漫',
  ];

  // ----------------------------------------------------------
  // 搜索 URL 构造
  // ----------------------------------------------------------

  /**
   * 构造 kanav.ad 搜索 URL。
   *
   * 使用 MacCMS 标准搜索路由：
   * https://kanav.ad/index.php/vod/search.html?wd={keyword}
   *
   * @param keyword - 搜索关键词
   * @returns 完整搜索 URL
   */
  buildSearchUrl(keyword: string): string {
    return `${this.baseUrl}/index.php/vod/search.html?wd=${encodeURIComponent(keyword)}`;
  }

  // ----------------------------------------------------------
  // 标题清洗
  // ----------------------------------------------------------

  /**
   * 清洗 kanav.ad 视频标题。
   *
   * 常见格式："在线播放 - 视频标题 - KanAV-免费高清中文AV在线看"
   * 清洗后：  "视频标题"
   *
   * 清洗步骤：
   * 1. 去除常见前缀（"在线播放 - "、"在线观看 - " 等）
   * 2. 去除站点后缀（" - KanAV-免费..." 等）
   * 3. 多段分割时取中间部分（去掉首尾两段）
   *
   * @param rawTitle - 从页面提取的原始标题
   * @returns 清洗后的纯视频标题
   */
  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';

    let title = rawTitle.trim();

    // 步骤 1：去除常见前缀
    title = title.replace(
      /^(在线播放|在线观看|播放|观看|播放页面)\s*[-—–·:：\s]+/i,
      ''
    );

    // 步骤 2：去除站点后缀
    const siteSuffixPatterns = [
      /\s*[-—–]\s*KanAV.*$/i,           // " - KanAV-免费高清中文AV在线看"
      /\s*[-—–]\s*免费.*在线看.*$/i,     // " - 免费高清中文AV在线看"
      /\s*[-—–]\s*高清.*在线看.*$/i,     // " - 高清AV在线看"
      /\s*[-—–]\s*AV.*在线.*$/i,         // " - AV在线看"
      /\s*[-—–]\s*[A-Za-z]+-\s*免费.*$/i, // " - xxx-免费..."
    ];
    for (const pattern of siteSuffixPatterns) {
      title = title.replace(pattern, '');
    }

    // 步骤 3：多段分割取中间（过滤空段）
    const parts = title.split(/\s*[-—–]\s*/).filter(p => p.length > 0);
    if (parts.length >= 3) {
      title = parts.slice(1, -1).join(' - ');
    } else if (parts.length === 2) {
      // 两段：如果第一段像前缀（短），取第二段
      if (parts[0].length <= 6) {
        title = parts[1];
      }
    }

    return title.trim();
  }

  // ----------------------------------------------------------
  // URL 匹配
  // ----------------------------------------------------------

  /**
   * 判断 URL 是否属于 kanav.ad 站点。
   *
   * 规则：
   * - 匹配 kanav.ad 域名
   * - 匹配 kanav 相关子域名 (*.kanav.fun 等)
   *
   * @param url - 待判断的 URL
   * @returns 是否属于 kanav.ad
   */
  matchesUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      // 必须严格匹配 kanav.ad 或其子域名
      return hostname === 'kanav.ad' ||
        hostname.endsWith('.kanav.ad') ||
        hostname.includes('kanav.fun');
    } catch {
      return false;
    }
  }

  // ----------------------------------------------------------
  // 多标签识别（同系列视频）
  // ----------------------------------------------------------

  /**
   * 检查标题或导演是否属于需要屏蔽的分类。
   *
   * 规则：
   * - 同人作品/同人 → 屏蔽
   * - 动漫番剧/动漫 → 屏蔽
   *
   * @param director - 导演/分类字段
   * @param categories - 分类数组
   * @returns { blocked: boolean, reason?: string }
   */
  checkBlocked(
    director: string,
    categories: string[]
  ): { blocked: boolean; reason: string | undefined } {
    // 检查导演字段
    if (director) {
      for (const keyword of this.blockedDirectorKeywords) {
        if (director.includes(keyword)) {
          return { blocked: true, reason: `导演字段包含屏蔽关键词: "${keyword}"` };
        }
      }
    }

    // 检查分类字段
    if (categories) {
      for (const cat of categories) {
        for (const keyword of this.blockedCategories) {
          if (cat.includes(keyword)) {
            return { blocked: true, reason: `分类包含屏蔽关键词: "${keyword}"` };
          }
        }
      }
    }

    return { blocked: false, reason: undefined };
  }

  /**
   * 从页面提取完整的 KanavMetadata，包括多标签识别和分类屏蔽。
   *
   * 这是 kanav 站点特有的元信息提取方法，从以下来源提取：
   * 1. player_aaaa JavaScript 变量（vod_data）
   * 2. .video-countext-categories 分类链接
   * 3. .video-countext-tags 标签/同系列链接
   * 4. meta keywords 标签
   *
   * @param page - 已导航到视频页的 Playwright Page
   * @returns KanavMetadata 对象
   */
  async extractExtendedMetadata(page: import('playwright').Page): Promise<ExtendedMetadata> {
    const result = await page.evaluate(
      ({ blockedCats, blockedDirs }) => {
        const metadata: {
          rawTitle: string;
          vodName: string;
          vodActor: string;
          vodDirector: string;
          vodClass: string;
          categories: string[];
          tags: string[];
          seriesRaw: { url: string; title: string; id: string }[];
          metaKeywords: string[];
          date?: string;
        } = {
          rawTitle: '',
          vodName: '',
          vodActor: '',
          vodDirector: '',
          vodClass: '',
          categories: [],
          tags: [],
          seriesRaw: [],
          metaKeywords: [],
          date: undefined,
        };

        // 1. 提取 document.title
        metadata.rawTitle = document.title || '';

        // 2. 从 player_aaaa 提取 vod_data
        try {
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent || '';
            const match = content.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/);
            if (match) {
              const playerData = JSON.parse(match[1]);
              if (playerData.vod_data) {
                metadata.vodName = playerData.vod_data.vod_name || '';
                metadata.vodActor = playerData.vod_data.vod_actor || '';
                metadata.vodDirector = playerData.vod_data.vod_director || '';
                metadata.vodClass = playerData.vod_data.vod_class || '';
              }
              break;
            }
          }
        } catch {
          // 忽略 JSON 解析错误
        }

        // 3. 从 .video-countext-categories 提取分类和上映日期
        const catContainer = document.querySelector('.video-countext-categories');
        if (catContainer) {
          catContainer.querySelectorAll('a[rel="tag"]').forEach((el) => {
            const text = el.textContent?.trim();
            if (!text) return;
            if (text.startsWith('上映日期')) {
              // 提取日期，格式：上映日期：2025-06-18 或 上映日期：2025-06-18 23:59:59
              const dateMatch = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
              if (dateMatch) {
                metadata.date = dateMatch[1];
              }
            } else {
              metadata.categories.push(text);
            }
          });
        }

        // 4. 从 .video-countext-tags 提取标签（包含同系列）
        const tagContainers = document.querySelectorAll('.video-countext-tags');
        tagContainers.forEach((container) => {
          // 检查是否包含 hr-vod class（表示这是同系列区域）
          const hasVodClass = container.querySelector('.hr-vod') !== null;

          container.querySelectorAll('a').forEach((el) => {
            const text = el.textContent?.trim();
            const href = (el as HTMLAnchorElement).href;
            if (!text) return;

            if (hasVodClass && href && href.includes('/vod/play/')) {
              // 同系列视频链接
              const idMatch = href.match(/id\/(\d+)\//);
              const id = idMatch ? idMatch[1] : '';
              metadata.seriesRaw.push({ url: href, title: text, id });
            } else if (!text.startsWith('上映日期')) {
              // 普通标签
              metadata.tags.push(text);
            }
          });
        });

        // 5. 从 meta keywords 提取标签
        const metaKeywords = document.querySelector('meta[name="keywords"]');
        if (metaKeywords) {
          const content = metaKeywords.getAttribute('content');
          if (content) {
            metadata.metaKeywords = content
              .split(/[,，;；]/)
              .map((t) => t.trim())
              .filter((t) => t && !t.includes(' - ') && t.length < 50);
          }
        }

        return metadata;
      },
      { blockedCats: this.blockedCategories, blockedDirs: this.blockedDirectorKeywords }
    );

    // 清洗标题（优先使用 vod_name，更准确）
    const rawTitle = result.vodName || result.rawTitle;
    const title = this.cleanTitle(rawTitle);

    // 检查是否被屏蔽
    const blockCheck = this.checkBlocked(result.vodDirector, result.categories);

    return {
      title,
      tags: [...result.tags, ...result.metaKeywords],
      actors: result.vodActor ? result.vodActor.split(/[,，、/\|&]/).map(s => s.trim()).filter(Boolean) : [],
      categories: result.categories,
      director: result.vodDirector,
      series: result.seriesRaw,
      blocked: blockCheck.blocked,
      blockReason: blockCheck.reason,
    };
  }
}
