import prisma from '@/lib/db/prisma';
import { loggers } from '@/lib/core/infra/logger';
import { getCharacterDBService, getCharacterDBServiceAsync } from '@/lib/character-db';
import type { CharacterMatch } from '@/lib/character-db';
import { logT } from '@/lib/i18n/server';
import { getPinyinService } from '@/lib/core/pinyin-service';


const logger = loggers.protagonistService();
export interface ProtagonistParseResult {
  rawName: string;
  standardName: string;
  chinesePart: string;
  pinyinPart: string;
  isMixedName: boolean;
  confidence: number;
  matchedAliases: string[];
}

export interface ProtagonistStats {
  standardName: string;
  count: number;
  aliases: { name: string; count: number }[];
  /** GraphlibraryList */
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
import {
  AdaptiveExtractor,
  PatternModel,
} from './adaptive-extractor';
import type {
  AdaptiveExtractionResult,
  CandidateGeneratorDeps,
  ScoredCandidate,
} from './adaptive-extractor';

export type { PersonCacheEntry };
export type { AdaptiveExtractionResult, ScoredCandidate };

export class ProtagonistService {
  private personCache: Map<string, PersonCacheEntry> = new Map();
  private pinyinCache: Map<string, PersonCacheEntry> = new Map();
  private cacheInitialized = false;
  private cacheInitPromise: Promise<void> | null = null;

  private patternModel: PatternModel = new PatternModel();
  private adaptiveExtractor: AdaptiveExtractor | null = null;
  private adaptiveInitialized = false;
  private adaptiveInitPromise: Promise<void> | null = null;

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
      logger.warnT('log.protagonist.personCacheInitFailed', undefined, { error: err });
      this.cacheInitialized = true;
    }
  }

  async refreshCache(): Promise<void> {
    this.cacheInitialized = false;
    this.cacheInitPromise = null;
    await this.ensureCacheInitialized();
  }

  
  async refreshAdaptiveModel(): Promise<void> {
    this.adaptiveInitialized = false;
    this.adaptiveInitPromise = null;
    this.patternModel = new PatternModel();
    this.adaptiveExtractor = null;
    await this.ensureAdaptiveInitialized();
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
    await getCharacterDBServiceAsync();
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

  
  private getAdaptiveDeps(): CandidateGeneratorDeps {
    return {
      ...this.getExtractorDeps(),
      patternModel: this.patternModel,
    };
  }

  
  async ensureAdaptiveInitialized(): Promise<void> {
    if (this.adaptiveInitialized) return;
    if (this.adaptiveInitPromise) {
      await this.adaptiveInitPromise;
      return;
    }
    this.adaptiveInitPromise = this.initializeAdaptive();
    await this.adaptiveInitPromise;
  }

  
  private async initializeAdaptive(): Promise<void> {
    try {
      await this.ensureCacheInitialized();
      await this.ensureCharDBLoaded();

      const galleries = await prisma.gallery.findMany({
        where: {
          protagonist: { not: '' },
          title: { not: '' },
        },
        select: { title: true, protagonist: true, tags: true },
      });

      const samples = galleries.map((g) => {
        let tags: string[] = [];
        try {
          tags = JSON.parse(g.tags || '[]') as string[];
        } catch {
          tags = [];
        }
        return { title: g.title, protagonist: g.protagonist, tags };
      });

      this.adaptiveExtractor = new AdaptiveExtractor(this.getAdaptiveDeps());
      this.adaptiveExtractor.learnFromSamples(samples);

      const knownPublishers = ['森萝财团', '秀人网', '推女郎'];
      for (const pub of knownPublishers) {
        this.patternModel.addToBlacklist(pub);
      }

      this.adaptiveInitialized = true;

      const stats = this.patternModel.getStats();
      console.log(
        `[ProtagonistService] Adaptive engine initialized: ${stats.sampleCount} samples, ${stats.uniqueNames} unique names, ${stats.blacklistSize} blacklist entries`,
      );
    } catch (err) {
      console.warn('[ProtagonistService] Adaptive engine init failed, falling back to legacy strategy', err);
      this.adaptiveInitialized = true;
    }
  }

  
  async extractAdaptive(title: string, tags: string[] = []): Promise<AdaptiveExtractionResult | null> {
    if (!title) return null;
    await this.ensureAdaptiveInitialized();

    if (this.adaptiveExtractor) {
      return this.adaptiveExtractor.extract(title, tags);
    }
    return null;
  }

  
  async extractFromTitleSmart(title: string, tags: string[] = []): Promise<string> {
    if (!title) return '';
    await this.ensureCacheInitialized();

    const adaptiveResult = await this.extractAdaptive(title, tags);
    if (adaptiveResult && adaptiveResult.confidence >= 0.35) {
      this.patternModel.recordSourceOutcome(adaptiveResult.source, true);
      return adaptiveResult.name;
    }

    const legacyResult = await extractFromTitleSmart(title, tags, this.getExtractorDeps());

    if (legacyResult && (!adaptiveResult || adaptiveResult.confidence < 0.35)) {
      this.patternModel.recordSourceOutcome('dash-separator', false);
    }

    return legacyResult;
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
