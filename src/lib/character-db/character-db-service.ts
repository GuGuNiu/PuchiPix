import { getPinyinService } from '@/lib/core/pinyin-service';
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
import type { PinyinMatcher } from './utils/pinyin-matcher';
import type { AliasLibrary } from './utils/alias-library';
import { getPinyinMatcher } from './utils/pinyin-matcher';
import { getAliasLibrary } from './utils/alias-library';

export type { CharacterEntry, CharacterMatch, ContentCategory, GameIndexEntry };

export interface CharacterDBConfig {
  pinyinSimilarityThreshold: number;
  enableFuzzyMatch: boolean;
  enableAliasLibrary: boolean;
  minConfidence: number;
}

export class CharacterDBService {
  private exactIndex = new Map<string, CharacterEntry>();
  private aliasIndex = new Map<string, CharacterEntry>();
  private pinyinIndex = new Map<string, CharacterEntry>();
  private gameIndex = new Map<string, CharacterEntry[]>();
  private categoryIndex = new Map<ContentCategory, CharacterEntry[]>();
  /** AllroleList */
  private allCharacters: CharacterEntry[] = [];
  /** Indexdata */
  private index: CharacterDBIndex | null = null;
  /** BasePath */
  private basePath: string;
  /** IsnoLoad */
  private loaded = false;
  /** Config */
  private config: CharacterDBConfig;
  private pinyinMatcher: PinyinMatcher;
  private aliasLibrary: AliasLibrary;

  constructor(config: Partial<CharacterDBConfig> = {}) {
    this.basePath = path.join(process.cwd(), 'src', 'lib', 'character-db');

    // Initializeconfig
    this.config = {
      pinyinSimilarityThreshold: 0.6,
      enableFuzzyMatch: true,
      enableAliasLibrary: true,
      minConfidence: 0.5,
      ...config,
    };

    // Initializepinyin matcher
    this.pinyinMatcher = getPinyinMatcher({
      similarityThreshold: this.config.pinyinSimilarityThreshold,
      enableFuzzy: this.config.enableFuzzyMatch,
    });

    // Initializealias library
    this.aliasLibrary = getAliasLibrary({
      loadBuiltIn: this.config.enableAliasLibrary,
    });
  }

  /**
   * Loadroledatalibrary
   */
  async load(): Promise<void> {
    try {
      const indexPath = path.join(this.basePath, 'index.json');
      const indexContent = await fs.promises.readFile(indexPath, 'utf-8');
      this.index = JSON.parse(indexContent) as CharacterDBIndex;

      this.clearIndexes();

      for (const game of this.index.games.filter(g => g.enabled)) {
        await this.loadGameFile(game);
      }

      this.loaded = true;

      // Buildpinyin matcherIndex
      this.pinyinMatcher.buildIndex(this.allCharacters);

      console.log(
        `[CharacterDBService] Loaded: ${this.allCharacters.length} characters, ${this.index.games.filter(g => g.enabled).length} games/works, alias library: ${this.aliasLibrary.getRuleCount()} rules`
      );
    } catch (err) {
      console.error('[CharacterDBService] Load failed:', err);
      throw err;
    }
  }

  /**
   * HeavynewLoaddatalibrary
   */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.load();
  }

  
  private async loadGameFile(game: GameIndexEntry): Promise<void> {
    try {
      const filePath = path.join(this.basePath, game.file);

      if (!fs.existsSync(filePath)) {
        console.warn(`[CharacterDBService] Game file not found: ${filePath}`);
        return;
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const gameFile = JSON.parse(content) as GameCharacterFile;

      this.gameIndex.set(game.id, gameFile.characters);

      // Add tocategoryIndex
      const categoryList = this.categoryIndex.get(game.category) || [];
      categoryList.push(...gameFile.characters);
      this.categoryIndex.set(game.category, categoryList);

      // BuildroleIndex
      for (const char of gameFile.characters) {
        this.allCharacters.push(char);

        this.exactIndex.set(char.name.toLowerCase(), char);

        for (const alias of char.aliases) {
          this.aliasIndex.set(alias.toLowerCase(), char);
        }

        // PinyinIndex
        const py = this.toPinyin(char.name);
        if (py && py !== char.name.toLowerCase()) {
          this.pinyinIndex.set(py, char);
        }
      }

      game.characterCount = gameFile.characters.length;
    } catch (err) {
      console.warn(`[CharacterDBService] Failed to load game file: ${game.id}`, err);
    }
  }

  /**
   * EmptyallIndex
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
   * Convert topinyin
   */
  private toPinyin(text: string): string {
    const py = getPinyinService().convert(text, { type: 'array' });
    if (Array.isArray(py)) {
      return py.join('').toLowerCase();
    }
    return py.toLowerCase().replace(/\s/g, '');
  }

  /**
   * EnsuredatalibraryLoad
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('[CharacterDBService] Database not loaded, call load() first');
    }
  }

  
  identifyInText(text: string): CharacterMatch[] {
    this.ensureLoaded();
    if (!text) return [];

    const results: CharacterMatch[] = [];
    const seen = new Set<string>();

    for (const char of this.allCharacters) {
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

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  
  identifyInTags(tags: string[]): CharacterMatch[] {
    this.ensureLoaded();
    const results: CharacterMatch[] = [];
    const seen = new Set<string>();

    for (const tag of tags) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized || normalized.length < 1) continue;

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

      // BasepinyinMatch
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

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  
  getCharacter(name: string): CharacterEntry | null {
    this.ensureLoaded();
    const normalized = name.trim().toLowerCase();
    return this.exactIndex.get(normalized) || this.aliasIndex.get(normalized) || null;
  }

  
  getCharactersByGame(gameId: string): CharacterEntry[] {
    this.ensureLoaded();
    return this.gameIndex.get(gameId) || [];
  }

  
  getCharactersByCategory(category: ContentCategory): CharacterEntry[] {
    this.ensureLoaded();
    return this.categoryIndex.get(category) || [];
  }

  /**
   * Getallrole
   */
  getAllCharacters(): CharacterEntry[] {
    this.ensureLoaded();
    return [...this.allCharacters];
  }

  
  getAllGames(): GameIndexEntry[] {
    this.ensureLoaded();
    return this.index?.games || [];
  }

  
  getStats(): Record<string, number> {
    this.ensureLoaded();
    const stats: Record<string, number> = {};

    for (const [gameId, characters] of this.gameIndex) {
      stats[gameId] = characters.length;
    }

    return stats;
  }

  
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

  
  isCharacter(name: string): boolean {
    return this.getCharacter(name) !== null;
  }

  /**
   * GetLoadState
   */
  isLoaded(): boolean {
    return this.loaded;
  }
}

// Singletoninstance
let characterDBService: CharacterDBService | null = null;
let characterDBServicePromise: Promise<CharacterDBService> | null = null;

export async function getCharacterDBServiceAsync(): Promise<CharacterDBService> {
  if (characterDBServicePromise) {
    return characterDBServicePromise;
  }

  characterDBServicePromise = (async () => {
    if (!characterDBService) {
      characterDBService = new CharacterDBService();
    }
    if (!characterDBService.isLoaded()) {
      try {
        await characterDBService.load();
      } catch (err) {
        console.error('[CharacterDBService] Async load failed:', err);
      }
    }
    return characterDBService;
  })();

  return characterDBServicePromise;
}

export function getCharacterDBService(): CharacterDBService {
  if (!characterDBService) {
    characterDBService = new CharacterDBService();
  }
  return characterDBService;
}

export function resetCharacterDBService(): void {
  characterDBService = null;
  characterDBServicePromise = null;
}
