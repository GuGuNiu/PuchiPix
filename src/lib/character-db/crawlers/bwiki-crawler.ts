/**
 * Bilibili游戏Wiki (BWiki) 爬虫
 *
 * 用于从BWiki获取游戏角色数据，支持：
 * - 原神 (ys)
 * - 崩坏：星穹铁道 (hsr)
 * - 鸣潮 (ww)
 * - 碧蓝航线 (blhx)
 * - 蔚蓝档案 (bluearchive)
 * - 明日方舟 (arknights)
 * - 绝区零 (zzz)
 */

import * as cheerio from 'cheerio';
import type { CharacterEntry, GameCharacterFile, GameIndexEntry } from '../types';

export interface BWikiCrawlerConfig {
  /** 请求间隔(ms)，防止请求过快 */
  requestInterval: number;
  /** 页面加载超时(ms) */
  pageTimeout: number;
  /** 是否使用缓存 */
  useCache: boolean;
}

export class BWikiCrawler {
  private baseUrl = 'https://wiki.biligame.com';
  private config: BWikiCrawlerConfig;

  constructor(config: Partial<BWikiCrawlerConfig> = {}) {
    this.config = {
      requestInterval: 1000,
      pageTimeout: 30000,
      useCache: true,
      ...config,
    };
  }

  /**
   * 爬取指定游戏的所有角色
   */
  async crawlGame(game: GameIndexEntry): Promise<GameCharacterFile> {
    console.log(`[BWikiCrawler] 开始爬取: ${game.name}`);

    const characterNames = await this.fetchCharacterList(game);
    console.log(`[BWikiCrawler] ${game.name} 发现 ${characterNames.length} 个角色`);

    const characters: CharacterEntry[] = [];
    for (const name of characterNames) {
      try {
        await this.sleep(this.config.requestInterval);
        const char = await this.fetchCharacterDetail(name, game);
        if (char) {
          characters.push(char);
        }
      } catch (err) {
        console.warn(`[BWikiCrawler] 获取角色详情失败: ${name}`, err);
      }
    }

    console.log(`[BWikiCrawler] ${game.name} 成功获取 ${characters.length} 个角色详情`);

    return {
      gameId: game.id,
      gameName: game.name,
      lastSync: new Date().toISOString(),
      source: 'bwiki',
      characters,
    };
  }

  /**
   * 从角色筛选页获取角色名称列表
   */
  private async fetchCharacterList(game: GameIndexEntry): Promise<string[]> {
    // 不同游戏的角色列表页路径
    const listPaths: Record<string, string> = {
      genshin: '/ys/角色筛选',
      starrail: '/hsr/角色筛选',
      wuthering: '/ww/角色筛选',
      azurlane: '/blhx/角色筛选',
      bluearchive: '/bluearchive/角色筛选',
      arknights: '/arknights/角色筛选',
      zenless: '/zzz/角色筛选',
    };

    const path = listPaths[game.id];
    if (!path) {
      throw new Error(`[BWikiCrawler] 未知的游戏ID: ${game.id}`);
    }

    const url = `${this.baseUrl}${path}`;
    const html = await this.fetchPage(url);
    const $ = cheerio.load(html);

    const names: string[] = [];

    // 根据游戏解析不同的页面结构
    switch (game.id) {
      case 'genshin':
        // 原神：从角色卡片中提取名称
        $('.character-card a, .card-title, .character-name').each((_, el) => {
          const name = $(el).text().trim();
          if (name && name.length >= 2 && name.length <= 10) {
            names.push(name);
          }
        });
        break;

      case 'starrail':
        // 星穹铁道
        $('.character-item .name, .character-card a').each((_, el) => {
          const name = $(el).text().trim();
          if (name && name.length >= 2 && name.length <= 10) {
            names.push(name);
          }
        });
        break;

      case 'azurlane':
        // 碧蓝航线：从表格或列表中提取
        $('table.wikitable td:first-child, .ship-name, .character-list a').each((_, el) => {
          const name = $(el).text().trim();
          if (name && name.length >= 2 && name.length <= 15) {
            names.push(name);
          }
        });
        break;

      default:
        // 通用策略：查找页面中所有可能是角色名的链接
        $('a').each((_, el) => {
          const name = $(el).text().trim();
          // 过滤条件：2-10个字符，主要是中文
          if (
            name &&
            name.length >= 2 &&
            name.length <= 10 &&
            /[\u4e00-\u9fff]/.test(name) &&
            !/攻略|筛选|图鉴|一览|分类|帮助/.test(name)
          ) {
            names.push(name);
          }
        });
    }

    return [...new Set(names)].filter(name => this.isValidCharacterName(name));
  }

  /**
   * 获取单个角色的详情
   */
  private async fetchCharacterDetail(
    name: string,
    game: GameIndexEntry
  ): Promise<CharacterEntry | null> {
    const gamePaths: Record<string, string> = {
      genshin: 'ys',
      starrail: 'hsr',
      wuthering: 'ww',
      azurlane: 'blhx',
      bluearchive: 'bluearchive',
      arknights: 'arknights',
      zenless: 'zzz',
    };

    const gamePath = gamePaths[game.id];
    if (!gamePath) return null;

    const url = `${this.baseUrl}/${gamePath}/${encodeURIComponent(name)}`;

    try {
      const html = await this.fetchPage(url);
      const $ = cheerio.load(html);

      // 提取别名（从页面信息框中）
      const aliases: string[] = [];

      // 查找信息框中的别名/昵称字段
      $('.infobox th:contains("别名"), .infobox th:contains("昵称"), .infobox th:contains("英文名")').each((_, el) => {
        const aliasText = $(el).next('td').text().trim();
        if (aliasText) {
          const parts = aliasText.split(/[,，、\/]/).map(s => s.trim()).filter(Boolean);
          aliases.push(...parts);
        }
      });

      // 提取稀有度（如果有）
      let rarity: number | undefined;
      const rarityText = $('.infobox th:contains("稀有度"), .infobox th:contains("星级")').next('td').text();
      if (rarityText) {
        const match = rarityText.match(/(\d)/);
        if (match) rarity = parseInt(match[1]);
      }

      // 提取元素/属性
      let element: string | undefined;
      const elementText = $('.infobox th:contains("元素"), .infobox th:contains("属性"), .infobox th:contains("命途")').next('td').text();
      if (elementText) {
        element = elementText.trim();
      }

      // 提取武器类型
      let weapon: string | undefined;
      const weaponText = $('.infobox th:contains("武器"), .infobox th:contains("兵种")').next('td').text();
      if (weaponText) {
        weapon = weaponText.trim();
      }

      // 提取阵营
      let faction: string | undefined;
      const factionText = $('.infobox th:contains("阵营"), .infobox th:contains("势力")').next('td').text();
      if (factionText) {
        faction = factionText.trim();
      }

      // 提取声优
      let cv: string | undefined;
      const cvText = $('.infobox th:contains("CV"), .infobox th:contains("声优")').next('td').text();
      if (cvText) {
        cv = cvText.trim();
      }

      return {
        id: `${game.id}-${name}`,
        name,
        aliases: [...new Set(aliases)],
        gameId: game.id,
        gameName: game.name,
        category: 'game',
        rarity,
        element,
        weapon,
        faction,
        cv,
        tags: [],
        metadata: {},
      };
    } catch (err) {
      console.warn(`[BWikiCrawler] 获取角色详情失败: ${name}`, err);
      return {
        id: `${game.id}-${name}`,
        name,
        aliases: [],
        gameId: game.id,
        gameName: game.name,
        category: 'game',
        tags: [],
        metadata: {},
      };
    }
  }

  /**
   * 获取页面内容
   */
  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.text();
  }

  /**
   * 验证角色名是否有效
   */
  private isValidCharacterName(name: string): boolean {
    const invalidPatterns = [
      /^第[一二三四五六七八九十\d]+章/,
      /^攻略/,
      /^图鉴/,
      /^筛选/,
      /^分类/,
      /^帮助/,
      /^首页/,
      /^导航/,
      /^模板/,
      /^文件/,
      /^特殊:/,
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(name)) return false;
    }

    // 长度检查
    if (name.length < 2 || name.length > 15) return false;

    // 至少包含一个中文字符
    if (!/[\u4e00-\u9fff]/.test(name)) return false;

    return true;
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出单例
let bwikiCrawler: BWikiCrawler | null = null;

export function getBWikiCrawler(config?: Partial<BWikiCrawlerConfig>): BWikiCrawler {
  if (!bwikiCrawler) {
    bwikiCrawler = new BWikiCrawler(config);
  }
  return bwikiCrawler;
}
