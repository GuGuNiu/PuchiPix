import prisma from '@/lib/db/prisma';
import { getCharacterDBService } from '@/lib/character-db';
import type { CharacterMatch } from '@/lib/character-db';
import { logT } from '@/lib/i18n/server';
import { getPinyinService } from '@/lib/core/pinyin-service';

/** 主角名字解析结果 */
export interface ProtagonistParseResult {
  /** 提取到的原始名字 */
  rawName: string;
  /** 标准化后的名字 */
  standardName: string;
  /** 中文部分 */
  chinesePart: string;
  /** 拼音/英文部分 */
  pinyinPart: string;
  /** 是否是混名 */
  isMixedName: boolean;
  /** 置信度（0-1） */
  confidence: number;
  /** 匹配的别名列表 */
  matchedAliases: string[];
}

/** 主角统计信息 */
export interface ProtagonistStats {
  /** 标准名字 */
  standardName: string;
  /** 出现次数 */
  count: number;
  /** 所有别名及其出现次数 */
  aliases: { name: string; count: number }[];
  /** 图库列表 */
  galleries: { id: number; title: string; coverUrl: string }[];
}
import {
  toStandardPinyin,
  calculateSimilarity,
  parseMixedName,
} from './utils';
import { extractFromTitleSmart } from './title-extractor';
import type { TitleExtractorDeps } from './title-extractor';
import {
  learnPerson as learnPersonOp,
  importGameCharacters as importGameCharsOp,
  normalizeFromDatabase as normalizeFromDbOp,
  getProtagonistStats as getStatsOp,
  getAllProtagonists as getAllOp,
} from './person-manager';
import type { PersonCacheEntry, PersonManagerDeps } from './person-manager';

export type { PersonCacheEntry };

export class ProtagonistService {
  private personCache: Map<string, PersonCacheEntry> = new Map();
  private pinyinCache: Map<string, PersonCacheEntry> = new Map();
  private cacheInitialized = false;
  private cacheInitPromise: Promise<void> | null = null;

  toStandardPinyin(chineseName: string): string {
    return toStandardPinyin(chineseName);
  }

  calculateSimilarity(name1: string, name2: string): number {
    return calculateSimilarity(name1, name2);
  }

  parseMixedName(name: string): { chinese: string; pinyin: string; isMixed: boolean } {
    return parseMixedName(name);
  }

  private async ensureCacheInitialized(): Promise<void> {
    if (this.cacheInitialized) return;
    if (this.cacheInitPromise) {
      await this.cacheInitPromise;
      return;
    }
    this.cacheInitPromise = this.initializeCache();
    await this.cacheInitPromise;
  }

  private async initializeCache(): Promise<void> {
    try {
      const persons = await prisma.person.findMany();
      this.personCache.clear();
      this.pinyinCache.clear();

      for (const p of persons) {
        let aliases: string[] = [];
        try {
          aliases = JSON.parse(p.aliases) as string[];
        } catch {
          aliases = [];
        }
        const entry: PersonCacheEntry = {
          name: p.name,
          pinyin: p.pinyin,
          aliases,
          galleryCount: p.galleryCount,
          source: p.source || 'auto',
        };
        this.personCache.set(p.name.toLowerCase(), entry);
        if (p.pinyin) {
          this.pinyinCache.set(p.pinyin, entry);
        }
      }

      this.cacheInitialized = true;
    } catch (err) {
      console.warn(logT('log.protagonist.personCacheInitFailed'), err);
      this.cacheInitialized = true;
    }
  }

  async refreshCache(): Promise<void> {
    this.cacheInitialized = false;
    this.cacheInitPromise = null;
    await this.ensureCacheInitialized();
  }

  matchKnownPerson(text: string, excludeGameCharacters: boolean = true): string | null {
    if (!text) return null;

    const lowerText = text.toLowerCase();
    let bestMatch: string | null = null;
    let bestLen = 0;

    for (const [nameLower, entry] of this.personCache) {
      if (excludeGameCharacters && entry.source === 'game_character') continue;

      if (lowerText.includes(nameLower)) {
        if (entry.name.length > bestLen) {
          bestMatch = entry.name;
          bestLen = entry.name.length;
        }
        continue;
      }
      for (const alias of entry.aliases) {
        if (alias.length >= 2 && lowerText.includes(alias.toLowerCase())) {
          if (entry.name.length > bestLen) {
            bestMatch = entry.name;
            bestLen = entry.name.length;
          }
          break;
        }
      }
    }

    return bestMatch;
  }

  fuzzyMatchPerson(name: string, threshold: number = 0.8, excludeGameCharacters: boolean = true): string | null {
    if (!name) return null;

    const namePinyin = this.toStandardPinyin(name);
    if (!namePinyin) return null;

    let bestMatch: string | null = null;
    let bestSim = threshold;

    for (const [py, entry] of this.pinyinCache) {
      if (excludeGameCharacters && entry.source === 'game_character') continue;
      const sim = getPinyinService().calculateSimilarity(namePinyin, py, { algorithm: 'bigram' });
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = entry.name;
      }
    }

    return bestMatch;
  }

  private async ensureCharDBLoaded(): Promise<void> {
    const db = getCharacterDBService();
    if (!db.isLoaded()) {
      await db.load();
    }
  }

  async matchGameCharacterInText(text: string): Promise<string | null> {
    if (!text) return null;
    await this.ensureCharDBLoaded();
    const matches = getCharacterDBService()
      .identifyInText(text)
      .filter(m => m.character.category === 'game');
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.character.name.length - a.character.name.length);
    return matches[0].character.name;
  }

  private getExtractorDeps(): TitleExtractorDeps {
    return {
      matchKnownPerson: (text, exclude) => this.matchKnownPerson(text, exclude),
      fuzzyMatchPerson: (name, threshold, exclude) => this.fuzzyMatchPerson(name, threshold, exclude),
      matchGameCharacterInText: (text) => this.matchGameCharacterInText(text),
      isGameCharacter: (name) => this.isGameCharacter(name),
    };
  }

  async extractFromTitleSmart(title: string, tags: string[] = []): Promise<string> {
    if (!title) return '';
    await this.ensureCacheInitialized();
    return extractFromTitleSmart(title, tags, this.getExtractorDeps());
  }

  private getManagerDeps(): PersonManagerDeps {
    return {
      personCache: this.personCache,
      pinyinCache: this.pinyinCache,
      toStandardPinyin: (name) => this.toStandardPinyin(name),
      fuzzyMatchPerson: (name, threshold, exclude) => this.fuzzyMatchPerson(name, threshold, exclude),
      isGameCharacter: (name) => this.isGameCharacter(name),
    };
  }

  async learnPerson(name: string, source: string = 'auto'): Promise<void> {
    if (!name) return;
    if (await this.isGameCharacter(name)) return;
    await this.ensureCacheInitialized();
    await learnPersonOp(name, source, this.getManagerDeps());
  }

  async importGameCharacters(): Promise<number> {
    return importGameCharsOp(
      (name) => this.toStandardPinyin(name),
      () => this.refreshCache(),
    );
  }

  async normalizeFromDatabase(rawName: string): Promise<ProtagonistParseResult> {
    return normalizeFromDbOp(rawName);
  }

  async getProtagonistStats(standardName: string): Promise<ProtagonistStats | null> {
    return getStatsOp(standardName);
  }

  async getAllProtagonists(): Promise<{ name: string; count: number; coverUrl: string }[]> {
    return getAllOp();
  }

  async identifyGameCharacters(tags: string[]): Promise<string[]> {
    await this.ensureCharDBLoaded();
    const matches = getCharacterDBService()
      .identifyInTags(tags)
      .filter(m => m.character.category === 'game');
    return matches.map((m) => m.character.name);
  }

  async identifyGameCharsDetailed(tags: string[]): Promise<CharacterMatch[]> {
    await this.ensureCharDBLoaded();
    return getCharacterDBService()
      .identifyInTags(tags)
      .filter(m => m.character.category === 'game');
  }

  async isGameCharacter(name: string): Promise<boolean> {
    await this.ensureCharDBLoaded();
    const char = getCharacterDBService().getCharacter(name);
    return char !== null && char.category === 'game';
  }
}

let protagonistService: ProtagonistService | null = null;

export function getProtagonistService(): ProtagonistService {
  if (!protagonistService) {
    protagonistService = new ProtagonistService();
  }
  return protagonistService;
}
