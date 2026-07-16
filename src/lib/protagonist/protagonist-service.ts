import prisma from '@/lib/db/prisma';
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';
import type { GameCharacterMatch } from '@/lib/game-characters/game-character-service';
import { logT } from '@/lib/i18n/server';

import type { ProtagonistParseResult, ProtagonistStats } from './protagonist-service/types';
import {
  toStandardPinyin,
  bigramDiceSimilarity,
  calculateSimilarity,
  parseMixedName,
  extractFromTitle,
} from './protagonist-service/utils';
import { extractFromTitleSmart } from './protagonist-service/title-extractor';
import type { TitleExtractorDeps } from './protagonist-service/title-extractor';
import {
  learnPerson as learnPersonOp,
  importGameCharacters as importGameCharsOp,
  normalizeFromDatabase as normalizeFromDbOp,
  getProtagonistStats as getStatsOp,
  getAllProtagonists as getAllOp,
} from './protagonist-service/person-manager';
import type { PersonCacheEntry, PersonManagerDeps } from './protagonist-service/person-manager';

export type { ProtagonistParseResult, ProtagonistStats };
export type { PersonCacheEntry };

export class ProtagonistService {
  private personCache: Map<string, PersonCacheEntry> = new Map();
  private pinyinCache: Map<string, PersonCacheEntry> = new Map();
  private cacheInitialized = false;
  private cacheInitPromise: Promise<void> | null = null;

  toStandardPinyin(chineseName: string): string {
    return toStandardPinyin(chineseName);
  }

  bigramDiceSimilarity(str1: string, str2: string): number {
    return bigramDiceSimilarity(str1, str2);
  }

  calculateSimilarity(name1: string, name2: string): number {
    return calculateSimilarity(name1, name2);
  }

  parseMixedName(name: string): { chinese: string; pinyin: string; isMixed: boolean } {
    return parseMixedName(name);
  }

  extractFromTitle(title: string): string {
    return extractFromTitle(title);
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
          aliases = JSON.parse(p.aliases);
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
      const sim = bigramDiceSimilarity(namePinyin, py);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = entry.name;
      }
    }

    return bestMatch;
  }

  async matchGameCharacterInText(text: string): Promise<string | null> {
    if (!text) return null;
    const matches = await getGameCharacterService().identifyInText(text);
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
    const service = getGameCharacterService();
    const matches = await service.identifyInTags(tags);
    return matches.map((m) => m.character.name);
  }

  async identifyGameCharactersDetailed(tags: string[]): Promise<GameCharacterMatch[]> {
    return await getGameCharacterService().identifyInTags(tags);
  }

  async isGameCharacter(name: string): Promise<boolean> {
    return (await getGameCharacterService().getCharacter(name)) !== null;
  }
}

let protagonistService: ProtagonistService | null = null;

export function getProtagonistService(): ProtagonistService {
  if (!protagonistService) {
    protagonistService = new ProtagonistService();
  }
  return protagonistService;
}
