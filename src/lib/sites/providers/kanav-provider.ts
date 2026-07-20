import { BaseSiteProvider } from '../base-provider';
import type { ExtendedMetadata, SeriesItem, BlockCheckResult } from '../types';
import { getBlocklistService } from '../blocklist-service';
import { removePublisherPrefix } from '@/lib/utils/title-cleaner';

interface KanavVodData {
  vod_name: string;
  vod_actor: string;
  vod_director: string;
  vod_class: string;
}

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

export class KanavProvider extends BaseSiteProvider {
  readonly id = 'kanav';
  readonly name = 'KanAV';
  readonly baseUrl = 'https://kanav.ad';
  readonly enabled = true;

  readonly blockedCategories: string[] = [
    '同人作品',
    '同人',
    '动漫番剧',
    '动漫',
  ];

  readonly blockedDirectorKeywords: string[] = [
    '同人作品',
    '同人',
    '动漫番剧',
    '动漫',
  ];

  readonly blockedTitleKeywords: string[] = [
    'AI Generated Anime Girl',
    'AI Generated',
  ];

  buildSearchUrl(keyword: string): string {
    return `${this.baseUrl}/index.php/vod/search.html?wd=${encodeURIComponent(keyword)}`;
  }

  cleanTitle(rawTitle: string): string {
    if (!rawTitle) return '';

    let title = rawTitle.trim();

    title = title.replace(
      /^(在线播放|在线观看|播放|观看|播放页面)\s*[-—–·:\s]+/i,
      ''
    );

    title = removePublisherPrefix(title);

    const siteSuffixPatterns = [
      /\s*[-—–]\s*KanAV.*$/i,           // Site name suffix
      /\s*[-—–]\s*免费.*在线看.*$/i,     // Free HD suffix
      /\s*[-—–]\s*高清.*在线看.*$/i,     // HD stream suffix
      /\s*[-—–]\s*AV.*在线.*$/i,         // AV stream suffix
      /\s*[-—–]\s*[A-Za-z]+-\s*免费.*$/i, // Free prefix suffix
    ];
    for (const pattern of siteSuffixPatterns) {
      title = title.replace(pattern, '');
    }

    const parts = title.split(/\s*[-—–]\s*/).filter(p => p.length > 0);
    if (parts.length >= 3) {
      title = parts.slice(1, -1).join(' - ');
    } else if (parts.length === 2) {
      if (parts[0].length <= 6) {
        title = parts[1];
      }
    }

    return title.trim();
  }

  checkBlocked(
    title: string,
    director: string,
    categories: string[]
  ): { blocked: boolean; reason: string | undefined } {
    if (title) {
      const titleLower = title.toLowerCase();
      for (const keyword of this.blockedTitleKeywords) {
        if (titleLower.includes(keyword.toLowerCase())) {
          return { blocked: true, reason: `标题包含屏蔽关键词: "${keyword}"` };
        }
      }
    }

    if (director) {
      for (const keyword of this.blockedDirectorKeywords) {
        if (director.includes(keyword)) {
          return { blocked: true, reason: `导演字段包含屏蔽关键词: "${keyword}"` };
        }
      }
    }

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

  checkContentBlocked(
    title: string,
    category: string,
    _protagonist?: string
  ): BlockCheckResult {
    if (title) {
      const titleLower = title.toLowerCase();
      for (const keyword of this.blockedTitleKeywords) {
        if (titleLower.includes(keyword.toLowerCase())) {
          return { blocked: true, reason: `标题包含屏蔽关键词: "${keyword}"` };
        }
      }
    }

    if (category) {
      const categories = category.split(/[,、/\|&]/).map(s => s.trim()).filter(Boolean);
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

  async checkContentBlockedAsync(
    title: string,
    category: string,
    protagonist?: string,
  ): Promise<BlockCheckResult> {
    const defaultResult = this.checkContentBlocked(title, category, protagonist);
    if (defaultResult.blocked) return defaultResult;

    return getBlocklistService().checkUserRules(this.id, {
      title,
      category,
      protagonist,
    });
  }

  getAdaptiveUrls(url: string): string[] {
    return [url];
  }

  matchesUrl(url: string): boolean {
    return url.includes('kanav') || url.includes(this.baseUrl);
  }

  getAdaptiveSearchUrls(keyword: string): string[] {
    return [this.buildSearchUrl(keyword)];
  }

  markDomainRateLimited?(_domain: string): void {
  }

  markDomainHealthy?(_domain: string): void {
  }

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

        metadata.rawTitle = document.title || '';

        try {
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const content = script.textContent || '';
            const match = content.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/);
            if (match) {
              const playerData = JSON.parse(match[1]) as {
                url?: string;
                vod_data?: {
                  vod_name?: string;
                  vod_actor?: string;
                  vod_director?: string;
                  vod_class?: string;
                };
              };
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
        }

        const catContainer = document.querySelector('.video-countext-categories');
        if (catContainer) {
          catContainer.querySelectorAll('a[rel="tag"]').forEach((el) => {
            const text = el.textContent?.trim();
            if (!text) return;
            if (text.startsWith('上映日期')) {
              const dateMatch = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2})/);
              if (dateMatch) {
                metadata.date = dateMatch[1];
              }
            } else {
              metadata.categories.push(text);
            }
          });
        }

        const tagContainers = document.querySelectorAll('.video-countext-tags');
        tagContainers.forEach((container) => {
          const hasVodClass = container.querySelector('.hr-vod') !== null;

          container.querySelectorAll<HTMLAnchorElement>('a').forEach((el) => {
            const text = el.textContent?.trim();
            const href = el.href;
            if (!text) return;

            if (hasVodClass && href && href.includes('/vod/play/')) {
              const idMatch = href.match(/id\/(\d+)\//);
              const id = idMatch ? idMatch[1] : '';
              metadata.seriesRaw.push({ url: href, title: text, id });
            } else if (!text.startsWith('上映日期')) {
              metadata.tags.push(text);
            }
          });
        });

        const metaKeywords = document.querySelector('meta[name="keywords"]');
        if (metaKeywords) {
          const content = metaKeywords.getAttribute('content');
          if (content) {
            metadata.metaKeywords = content
              .split(/[,;]/)
              .map((t) => t.trim())
              .filter((t) => t && !t.includes(' - ') && t.length < 50);
          }
        }

        return metadata;
      },
      { blockedCats: this.blockedCategories, blockedDirs: this.blockedDirectorKeywords }
    );

    const rawTitle = result.vodName || result.rawTitle;
    const title = this.cleanTitle(rawTitle);

    const blockCheck = this.checkBlocked(title, result.vodDirector, result.categories);

    return {
      title,
      tags: [...result.tags, ...result.metaKeywords],
      actors: result.vodActor ? result.vodActor.split(/[,、/\|&]/).map(s => s.trim()).filter(Boolean) : [],
      categories: result.categories,
      director: result.vodDirector,
      series: result.seriesRaw,
      blocked: blockCheck.blocked,
      blockReason: blockCheck.reason,
    };
  }
}
