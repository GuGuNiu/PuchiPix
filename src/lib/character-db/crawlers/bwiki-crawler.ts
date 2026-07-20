import * as cheerio from 'cheerio';
import type { CharacterEntry, GameCharacterFile, GameIndexEntry } from '../types';

export interface BWikiCrawlerConfig {
  requestInterval: number;
  /** PageLoadTimeout(ms) */
  pageTimeout: number;
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

  async crawlGame(game: GameIndexEntry): Promise<GameCharacterFile> {
    console.log(`[BWikiCrawler] Started crawling: ${game.name}`);

    const characterNames = await this.fetchCharacterList(game);
    console.log(`[BWikiCrawler] ${game.name}: found ${characterNames.length} characters`);

    const characters: CharacterEntry[] = [];
    for (const name of characterNames) {
      try {
        await this.sleep(this.config.requestInterval);
        const char = await this.fetchCharacterDetail(name, game);
        if (char) {
          characters.push(char);
        }
      } catch (err) {
        console.warn(`[BWikiCrawler] Failed to fetch character details: ${name}`, err);
      }
    }

    console.log(`[BWikiCrawler] ${game.name}: successfully fetched ${characters.length} character details`);

    return {
      gameId: game.id,
      gameName: game.name,
      lastSync: new Date().toISOString(),
      source: 'bwiki',
      characters,
    };
  }

  
  private async fetchCharacterList(game: GameIndexEntry): Promise<string[]> {
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
      throw new Error(`[BWikiCrawler] Unknown game ID: ${game.id}`);
    }

    const url = `${this.baseUrl}${path}`;
    const html = await this.fetchPage(url);
    const $ = cheerio.load(html);

    const names: string[] = [];

    switch (game.id) {
      case 'genshin':
        $('.character-card a, .card-title, .character-name').each((_, el) => {
          const name = $(el).text().trim();
          if (name && name.length >= 2 && name.length <= 10) {
            names.push(name);
          }
        });
        break;

      case 'starrail':
        $('.character-item .name, .character-card a').each((_, el) => {
          const name = $(el).text().trim();
          if (name && name.length >= 2 && name.length <= 10) {
            names.push(name);
          }
        });
        break;

      case 'azurlane':
        $('table.wikitable td:first-child, .ship-name, .character-list a').each((_, el) => {
          const name = $(el).text().trim();
          if (name && name.length >= 2 && name.length <= 15) {
            names.push(name);
          }
        });
        break;

      default:
        $('a').each((_, el) => {
          const name = $(el).text().trim();
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

      const aliases: string[] = [];

      $('.infobox th:contains("别名"), .infobox th:contains("昵称"), .infobox th:contains("英文名")').each((_, el) => {
        const aliasText = $(el).next('td').text().trim();
        if (aliasText) {
          const parts = aliasText.split(/[,、\/]/).map(s => s.trim()).filter(Boolean);
          aliases.push(...parts);
        }
      });

      let rarity: number | undefined;
      const rarityText = $('.infobox th:contains("稀有度"), .infobox th:contains("星级")').next('td').text();
      if (rarityText) {
        const match = rarityText.match(/(\d)/);
        if (match) rarity = parseInt(match[1]);
      }

      let element: string | undefined;
      const elementText = $('.infobox th:contains("元素"), .infobox th:contains("属性"), .infobox th:contains("命途")').next('td').text();
      if (elementText) {
        element = elementText.trim();
      }

      let weapon: string | undefined;
      const weaponText = $('.infobox th:contains("武器"), .infobox th:contains("兵种")').next('td').text();
      if (weaponText) {
        weapon = weaponText.trim();
      }

      let faction: string | undefined;
      const factionText = $('.infobox th:contains("阵营"), .infobox th:contains("势力")').next('td').text();
      if (factionText) {
        faction = factionText.trim();
      }

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
      console.warn(`[BWikiCrawler] Failed to fetch character details: ${name}`, err);
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
   * Getpagecontent
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

    // LengthCheck
    if (name.length < 2 || name.length > 15) return false;

    if (!/[\u4e00-\u9fff]/.test(name)) return false;

    return true;
  }

  /**
   * Delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let bwikiCrawler: BWikiCrawler | null = null;

export function getBWikiCrawler(config?: Partial<BWikiCrawlerConfig>): BWikiCrawler {
  if (!bwikiCrawler) {
    bwikiCrawler = new BWikiCrawler(config);
  }
  return bwikiCrawler;
}
