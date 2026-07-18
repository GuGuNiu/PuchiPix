import type { Page } from 'playwright';
import { BaseSiteProvider } from '../base-provider';
import type { M3U8Candidate } from '@/types';
import type { ScrapeResult } from '@/types';
import type { BlockCheckResult } from '../types';
import { removePublisherPrefix } from '@/lib/utils/title-cleaner';

export class UniversalProvider extends BaseSiteProvider {
  // 站点基础信息
  readonly id = 'universal';
  readonly name = '通用下载器';
  readonly baseUrl = '';
  readonly enabled = true;

  // 站点特有配置
  /** 通用播放按钮选择器 */
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
   * 构造搜索 URL。
   *
   * 通用下载器不支持站点搜索，直接返回关键词本身。
   */
  buildSearchUrl(keyword: string): string {
    return keyword;
  }

  /**
   * 清洗标题。
   *
   * 通用下载器不针对特定站点，仅做基本清理：
   * - 去除首尾空白
   * - 去除常见站点后缀模式
   */
  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';
    let title = rawTitle.trim();

    // 去除发布组前缀
    title = removePublisherPrefix(title);

    // 去除常见站点后缀
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

  /**
   * 判断 URL 是否属于该站点。
   *
   * 通用下载器不绑定特定域名，不参与 SiteRegistry 的 URL 路由。
   * 此方法始终返回 false，确保不影响其他 Provider 的匹配。
   */
  matchesUrl(_url: string): boolean {
    // 不参与 URL 路由匹配
    return false;
  }

  /**
   * 检查内容是否应被屏蔽（标准化接口实现）。
   *
   * 通用下载器不做任何屏蔽，始终返回 { blocked: false }。
   *
   * @param _title - 视频标题
   * @param _category - 分类字符串
   * @param _protagonist - 主角名
   * @returns 屏蔽检查结果（始终不屏蔽）
   */
  checkContentBlocked(
    _title: string,
    _category: string,
    _protagonist?: string
  ): BlockCheckResult {
    return { blocked: false, reason: undefined };
  }

  /**
   * 获取多域名自适应 URL 列表。
   *
   * 通用下载器不支持多域名，返回单元素数组。
   *
   * @param url - 原始 URL
   * @returns [url]
   */
  getAdaptiveUrls(url: string): string[] {
    return [url];
  }

  /**
   * 获取搜索页面的多域名自适应 URL 列表。
   *
   * 通用下载器不支持搜索，返回单元素数组。
   *
   * @param keyword - 搜索关键词
   * @returns [keyword]
   */
  getAdaptiveSearchUrls(keyword: string): string[] {
    return [keyword];
  }

  // 多 M3U8 检测
  /**
   * 从 M3U8 URL 推断标题/标签。
   *
   * 推断策略：
   - 从 URL 路径最后一段提取文件名（去扩展名）
   - 检查 URL 中的分辨率标识（1080p、720p 等）
   - 检查 URL 中的码率标识
   - 检查 URL 中的序号（第1集、第2集等）
   *
   * @param url - M3U8 URL
   * @param pageTitle - 页面标题（用于补充上下文）
   * @returns 推断的标题
   */
  private guessM3U8Title(url: string, pageTitle: string): string {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1] || '';

      // 去除文件扩展名和查询参数
      const name = lastSegment.replace(/\.(m3u8|m3u)$/i, '').replace(/[?#].*$/, '');

      // 检测分辨率标识
      const resolutionMatch = url.match(/(\d{3,4})x(\d{3,4})/i);
      if (resolutionMatch) {
        return `${name || pageTitle} (${resolutionMatch[1]}x${resolutionMatch[2]})`;
      }

      // 检测常见分辨率关键词
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

      // 检测码率标识（如 2000kbps, 3M 等）
      const bitrateMatch = url.match(/(\d{3,5})\s*kbps/i) || url.match(/(\d)M\b/i);
      if (bitrateMatch) {
        return `${name || pageTitle} (${bitrateMatch[0]})`;
      }

      // 检测集数/序号（如 ep01, 第1集, part1 等）
      const epMatch = url.match(/(?:ep|episode|part|第)(\d{1,3})/i);
      if (epMatch) {
        return `${name || pageTitle} (第${epMatch[1]}集)`;
      }

      // 使用路径段作为标题
      if (name && name.length > 2) {
        return name;
      }

      // 兜底：使用页面标题 + URL 域名
      if (pageTitle) {
        return pageTitle;
      }

      return parsed.hostname;
    // URL 解析失败，截取前50字符
    } catch {
      return url.length > 50 ? `${url.substring(0, 50)}...` : url;
    }
  }

  /**
   * 对捕获的 M3U8 URL 列表进行去重和过滤。
   *
   * @param urls - 原始捕获的 M3U8 URL 数组
   * @returns 去重过滤后的 URL 数组
   */
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

  /**
   * 执行完整的视频页面爬取流程。
   *
   * 与基类 scrapePage 的关键区别：
   * - 当检测到多个 M3U8 URL 时，不自动选择最佳，
   *   而是将所有候选项通过 m3u8_candidates 返回，
   *   由上层决定是否弹出用户选择列表。
   * - m3u8_url 仍会填充 selectBestM3U8 的结果作为默认值。
   *
   * @param page - 已导航到视频页的 Playwright Page
   * @param pageUrl - 视频页面 URL
   * @returns 爬取结果（含 m3u8_candidates）
   */
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
        // 跨域 iframe 无法访问
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
      `[UniversalScrape] ${pageUrl} — 捕获到 ${capturedM3U8.length} 个 M3U8 URL: ${capturedM3U8.join(', ')}`,
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
