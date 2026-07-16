import { pinyin as pinyinPro } from 'pinyin-pro';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CharacterEntry,
  CharacterMatch,
  ContentCategory,
  GameIndexEntry,
  CharacterDBIndex,
  GameCharacterFile,
  LegacyGameType,
  GAME_LABELS,
} from './types';
import { PinyinMatcher, getPinyinMatcher } from './utils/pinyin-matcher';
import { AliasLibrary, getAliasLibrary } from './utils/alias-library';

export type { CharacterEntry, CharacterMatch, ContentCategory, GameIndexEntry };

export interface CharacterDBConfig {
  /** 拼音匹配相似度阈值 */
  pinyinSimilarityThreshold: number;
  /** 是否启用模糊匹配 */
  enableFuzzyMatch: boolean;
  /** 是否启用别名库 */
  enableAliasLibrary: boolean;
  /** 最小匹配置信度 */
  minConfidence: number;
}

export class CharacterDBService {
  /** 精确名称索引（name → entry） */
  private exactIndex = new Map<string, CharacterEntry>();
  /** 别名索引（alias → entry） */
  private aliasIndex = new Map<string, CharacterEntry>();
  /** 拼音索引（pinyin → entry） */
  private pinyinIndex = new Map<string, CharacterEntry>();
  /** 游戏索引（gameId → entries） */
  private gameIndex = new Map<string, CharacterEntry[]>();
  /** 分类索引（category → entries） */
  private categoryIndex = new Map<ContentCategory, CharacterEntry[]>();
  /** 所有角色列表 */
  private allCharacters: CharacterEntry[] = [];
  /** 索引数据 */
  private index: CharacterDBIndex | null = null;
  /** 基础路径 */
  private basePath: string;
  /** 是否已加载 */
  private loaded = false;
  /** 配置 */
  private config: CharacterDBConfig;
  /** 拼音匹配器 */
  private pinyinMatcher: PinyinMatcher;
  /** 别名库 */
  private aliasLibrary: AliasLibrary;

  constructor(config: Partial<CharacterDBConfig> = {}) {
    // 基于当前文件位置计算基础路径
    this.basePath = path.join(process.cwd(), 'src', 'lib', 'character-db');

    // 初始化配置
    this.config = {
      pinyinSimilarityThreshold: 0.6,
      enableFuzzyMatch: true,
      enableAliasLibrary: true,
      minConfidence: 0.5,
      ...config,
    };

    // 初始化拼音匹配器
    this.pinyinMatcher = getPinyinMatcher({
      similarityThreshold: this.config.pinyinSimilarityThreshold,
      enableFuzzy: this.config.enableFuzzyMatch,
    });

    // 初始化别名库
    this.aliasLibrary = getAliasLibrary({
      loadBuiltIn: this.config.enableAliasLibrary,
    });
  }

  /**
   * 加载角色数据库
   * 读取 index.json 和所有游戏角色文件，构建内存索引
   */
  async load(): Promise<void> {
    try {
      const indexPath = path.join(this.basePath, 'index.json');
      const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
      this.index = JSON.parse(indexContent) as CharacterDBIndex;

      // 清空现有数据
      this.clearIndexes();

      // 加载每个启用的游戏角色文件
      for (const game of this.index.games.filter(g => g.enabled)) {
        await this.loadGameFile(game);
      }

      this.loaded = true;

      // 构建拼音匹配器索引
      this.pinyinMatcher.buildIndex(this.allCharacters);

      console.log(
        `[CharacterDBService] 加载完成: ${this.allCharacters.length} 个角色, ${this.index.games.filter(g => g.enabled).length} 个游戏/作品, 别名库: ${this.aliasLibrary.getRuleCount()} 条规则`
      );
    } catch (err) {
      console.error('[CharacterDBService] 加载失败:', err);
      throw err;
    }
  }

  /**
   * 重新加载数据库
   */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.load();
  }

  /**
   * 加载单个游戏角色文件
   */
  private async loadGameFile(game: GameIndexEntry): Promise<void> {
    try {
      const filePath = path.join(this.basePath, game.file);

      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.warn(`[CharacterDBService] 游戏文件不存在: ${filePath}`);
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const gameFile = JSON.parse(content) as GameCharacterFile;

      // 添加到游戏索引
      this.gameIndex.set(game.id, gameFile.characters);

      // 添加到分类索引
      const categoryList = this.categoryIndex.get(game.category) || [];
      categoryList.push(...gameFile.characters);
      this.categoryIndex.set(game.category, categoryList);

      // 构建角色索引
      for (const char of gameFile.characters) {
        this.allCharacters.push(char);

        // 精确名称索引（小写）
        this.exactIndex.set(char.name.toLowerCase(), char);

        // 别名索引
        for (const alias of char.aliases) {
          this.aliasIndex.set(alias.toLowerCase(), char);
        }

        // 拼音索引
        const py = this.toPinyin(char.name);
        if (py && py !== char.name.toLowerCase()) {
          this.pinyinIndex.set(py, char);
        }
      }

      // 更新索引中的角色数
      game.characterCount = gameFile.characters.length;
    } catch (err) {
      console.warn(`[CharacterDBService] 加载游戏文件失败: ${game.id}`, err);
    }
  }

  /**
   * 清空所有索引
   */
  private clearIndexes(): void {
    this.exactIndex.clear();
    this.aliasIndex.clear();
    this.pinyinIndex.clear();
    this.gameIndex.clear();
    this.categoryIndex.clear();
    this.allCharacters = [];
  }

  /**
   * 转换为拼音
   */
  private toPinyin(text: string): string {
    try {
      const py = pinyinPro(text, {
        toneType: 'none',
        type: 'array',
        nonZh: 'consecutive',
      });
      return (py as string[]).join('').toLowerCase();
    } catch {
      return text.toLowerCase().replace(/\s/g, '');
    }
  }

  /**
   * 确保数据库已加载
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('[CharacterDBService] 数据库未加载，请先调用 load()');
    }
  }

  /**
   * 在文本中识别角色
   * 使用拼音匹配器和别名库进行智能识别
   */
  identifyInText(text: string): CharacterMatch[] {
    this.ensureLoaded();
    if (!text) return [];

    const results: CharacterMatch[] = [];
    const seen = new Set<string>();

    // 1. 精确匹配和基础别名匹配
    for (const char of this.allCharacters) {
      // 精确匹配
      if (text.includes(char.name)) {
        const key = `${char.gameId}:${char.name}:exact`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: char,
            matchedText: char.name,
            matchType: 'exact',
            confidence: 1.0,
          });
        }
        continue;
      }

      // 基础别名匹配
      for (const alias of char.aliases) {
        if (alias.length >= 2 && text.toLowerCase().includes(alias.toLowerCase())) {
          const key = `${char.gameId}:${char.name}:alias`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              character: char,
              matchedText: alias,
              matchType: 'alias',
              confidence: 0.9,
            });
          }
          break;
        }
      }
    }

    // 2. 使用拼音匹配器进行智能匹配
    if (this.config.enableFuzzyMatch) {
      const pinyinMatches = this.pinyinMatcher.findMatches(text, this.allCharacters);
      for (const match of pinyinMatches) {
        if (match.confidence < this.config.minConfidence) continue;

        const key = `${match.character.gameId}:${match.character.name}:${match.matchType}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: match.character,
            matchedText: match.matchedText,
            matchType: match.matchType,
            confidence: match.confidence,
          });
        }
      }
    }

    // 3. 使用别名库匹配
    if (this.config.enableAliasLibrary) {
      const aliasMatches = this.aliasLibrary.findMatches(text);
      for (const match of aliasMatches) {
        const char = this.allCharacters.find(c => c.id === match.rule.targetId);
        if (!char) continue;

        const key = `${char.gameId}:${char.name}:aliaslib`;
        if (!seen.has(key) && match.score >= this.config.minConfidence) {
          seen.add(key);
          results.push({
            character: char,
            matchedText: match.matchedAlias,
            matchType: 'alias',
            confidence: match.score,
          });
        }
      }
    }

    // 按置信度排序
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 在 TAG 列表中识别角色
   * 使用拼音匹配器和别名库进行智能识别
   */
  identifyInTags(tags: string[]): CharacterMatch[] {
    this.ensureLoaded();
    const results: CharacterMatch[] = [];
    const seen = new Set<string>();

    // 1. 基础匹配（精确、别名、拼音）
    for (const tag of tags) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized || normalized.length < 1) continue;

      // 精确匹配
      const exact = this.exactIndex.get(normalized);
      if (exact) {
        const key = `${exact.gameId}:${exact.name}:exact`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: exact,
            matchedText: tag,
            matchType: 'exact',
            confidence: 1.0,
          });
        }
        continue;
      }

      // 别名匹配
      const alias = this.aliasIndex.get(normalized);
      if (alias) {
        const key = `${alias.gameId}:${alias.name}:alias`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: alias,
            matchedText: tag,
            matchType: 'alias',
            confidence: 0.95,
          });
        }
        continue;
      }

      // 基础拼音匹配
      const tagPinyin = this.toPinyin(tag.trim());
      const pinyinMatch = this.pinyinIndex.get(tagPinyin);
      if (pinyinMatch) {
        const key = `${pinyinMatch.gameId}:${pinyinMatch.name}:pinyin`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: pinyinMatch,
            matchedText: tag,
            matchType: 'pinyin',
            confidence: 0.85,
          });
        }
      }
    }

    // 2. 使用拼音匹配器进行智能匹配
    if (this.config.enableFuzzyMatch) {
      const pinyinMatches = this.pinyinMatcher.matchTags(tags, this.allCharacters);
      for (const match of pinyinMatches) {
        if (match.confidence < this.config.minConfidence) continue;

        const key = `${match.character.gameId}:${match.character.name}:${match.matchType}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: match.character,
            matchedText: match.matchedText,
            matchType: match.matchType,
            confidence: match.confidence,
          });
        }
      }
    }

    // 3. 使用别名库匹配
    if (this.config.enableAliasLibrary) {
      for (const tag of tags) {
        const aliasMatches = this.aliasLibrary.findMatches(tag);
        for (const match of aliasMatches) {
          const char = this.allCharacters.find(c => c.id === match.rule.targetId);
          if (!char) continue;

          const key = `${char.gameId}:${char.name}:aliaslib`;
          if (!seen.has(key) && match.score >= this.config.minConfidence) {
            seen.add(key);
            results.push({
              character: char,
              matchedText: match.matchedAlias,
              matchType: 'alias',
              confidence: match.score,
            });
          }
        }
      }
    }

    // 按置信度排序
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 按名称精确查找角色
   */
  getCharacter(name: string): CharacterEntry | null {
    this.ensureLoaded();
    const normalized = name.trim().toLowerCase();
    return this.exactIndex.get(normalized) || this.aliasIndex.get(normalized) || null;
  }

  /**
   * 获取指定游戏/作品的全部角色
   */
  getCharactersByGame(gameId: string): CharacterEntry[] {
    this.ensureLoaded();
    return this.gameIndex.get(gameId) || [];
  }

  /**
   * 获取指定分类的全部角色
   */
  getCharactersByCategory(category: ContentCategory): CharacterEntry[] {
    this.ensureLoaded();
    return this.categoryIndex.get(category) || [];
  }

  /**
   * 获取全部角色
   */
  getAllCharacters(): CharacterEntry[] {
    this.ensureLoaded();
    return [...this.allCharacters];
  }

  /**
   * 获取全部游戏/作品索引
   */
  getAllGames(): GameIndexEntry[] {
    this.ensureLoaded();
    return this.index?.games || [];
  }

  /**
   * 获取统计信息
   */
  getStats(): Record<string, number> {
    this.ensureLoaded();
    const stats: Record<string, number> = {};

    for (const [gameId, characters] of this.gameIndex) {
      stats[gameId] = characters.length;
    }

    return stats;
  }

  /**
   * 获取游戏标签（向后兼容）
   */
  getGameLabel(gameId: string): string {
    const labels: Record<string, string> = {
      genshin: '原神',
      starrail: '星穹铁道',
      wuthering: '鸣潮',
      azurlane: '碧蓝航线',
      bluearchive: '碧蓝档案',
      arknights: '明日方舟',
      zenless: '绝区零',
    };
    return labels[gameId] || gameId;
  }

  /**
   * 检查是否为已知角色
   */
  isCharacter(name: string): boolean {
    return this.getCharacter(name) !== null;
  }

  /**
   * 获取加载状态
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}

// 单例实例
let characterDBService: CharacterDBService | null = null;

/**
 * 获取 CharacterDBService 单例
 */
export function getCharacterDBService(): CharacterDBService {
  if (!characterDBService) {
    characterDBService = new CharacterDBService();
  }
  return characterDBService;
}

/**
 * 重置单例（用于测试）
 */
export function resetCharacterDBService(): void {
  characterDBService = null;
}
