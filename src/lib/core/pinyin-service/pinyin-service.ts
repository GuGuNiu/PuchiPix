/**
 * Pinyinservice
 *
 */

import type {
  PinyinServiceConfig,
  PinyinConvertOptions,
  PinyinMatchOptions,
  SimilarityOptions,
  PinyinVariants,
  PinyinMatchResult,
  SimilarityAlgorithm,
} from './types';
import { PinyinProAdapter } from './pinyin-pro-adapter';
import { createSimilarityCalculator } from './similarity-calculators';

export class PinyinService {
  private engine: PinyinProAdapter;
  private config: Required<PinyinServiceConfig>;
  private cache: Map<string, PinyinVariants>;

  constructor(config: PinyinServiceConfig = {}) {
    this.config = {
      defaultConvertOptions: {
        toneType: 'none',
        type: 'string',
        nonZh: 'consecutive',
      },
      defaultMatchOptions: {
        precision: 'every',
        continuous: true,
      },
      defaultSimilarityOptions: {
        algorithm: 'combined',
        ignoreCase: true,
        ignoreSpaces: true,
        weights: {
          levenshtein: 0.4,
          jaroWinkler: 0.3,
          bigram: 0.3,
        },
      },
      similarityThreshold: 0.6,
      maxEditDistance: 3,
      enableCache: true,
      ...config,
    };

    this.engine = new PinyinProAdapter();
    this.cache = new Map();
  }

  /**
   *
   * @param options - Convertoption
   * @returns Pinyin string or array
   */
  convert(text: string, options?: PinyinConvertOptions): string | string[] {
    const opts = { ...this.config.defaultConvertOptions, ...options };
    return this.engine.convert(text, opts);
  }

  /**
   *
   * @returns Pinyin variant info
   */
  getVariants(text: string): PinyinVariants {
    if (!this.config.enableCache) {
      return this.engine.getVariants(text);
    }

    const cached = this.cache.get(text);
    if (cached) {
      return cached;
    }

    const variants = this.engine.getVariants(text);
    this.cache.set(text, variants);
    return variants;
  }

  /**
   *
   * @returns Pinyin variant array
   */
  getVariantsBatch(texts: string[]): PinyinVariants[] {
    return texts.map(text => this.getVariants(text));
  }

  /**
   *
   * @param options - Matchoption
   * @returns isnoMatch
   */
  match(text: string, pinyin: string, options?: PinyinMatchOptions): boolean {
    const opts = { ...this.config.defaultMatchOptions, ...options };
    return this.engine.match(text, pinyin, opts);
  }

  /**
   *
   * @param options - similarityCalculateoption
   */
  calculateSimilarity(
    s1: string,
    s2: string,
    options?: SimilarityOptions
  ): number {
    const opts = { ...this.config.defaultSimilarityOptions, ...options };

    let str1 = s1;
    let str2 = s2;

    if (opts.ignoreCase) {
      str1 = str1.toLowerCase();
      str2 = str2.toLowerCase();
    }

    if (opts.ignoreSpaces) {
      str1 = str1.replace(/\s/g, '');
      str2 = str2.replace(/\s/g, '');
    }

    const calculator = createSimilarityCalculator(
      opts.algorithm ?? 'combined',
      opts.weights
    );

    return calculator.calculate(str1, str2);
  }

  /**
   *
   * @param options - similarityoption
   * @returns Best match result
   */
  findBestMatch(
    text: string,
    candidates: string[],
    options?: SimilarityOptions
  ): { candidate: string; similarity: number; index: number } | null {
    if (candidates.length === 0) return null;

    let bestMatch = candidates[0];
    let bestSimilarity = this.calculateSimilarity(text, candidates[0], options);
    let bestIndex = 0;

    for (let i = 1; i < candidates.length; i++) {
      const similarity = this.calculateSimilarity(text, candidates[i], options);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = candidates[i];
        bestIndex = i;
      }
    }

    return {
      candidate: bestMatch,
      similarity: bestSimilarity,
      index: bestIndex,
    };
  }

  /**
   *
   * @param options - similarityoption
   */
  findMatches(
    text: string,
    candidates: string[],
    threshold?: number,
    options?: SimilarityOptions
  ): Array<{ candidate: string; similarity: number; index: number }> {
    const minThreshold = threshold ?? this.config.similarityThreshold;
    const matches: Array<{ candidate: string; similarity: number; index: number }> = [];

    for (let i = 0; i < candidates.length; i++) {
      const similarity = this.calculateSimilarity(text, candidates[i], options);
      if (similarity >= minThreshold) {
        matches.push({
          candidate: candidates[i],
          similarity,
          index: i,
        });
      }
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   *
   * @param options - Matchoption
   * @returns MatchresultList
   */
  smartMatch<T extends { name: string; aliases?: string[] }>(
    text: string,
    candidates: T[],
    options?: {
      threshold?: number;
      usePinyin?: boolean;
      useSimilarity?: boolean;
      similarityOptions?: SimilarityOptions;
    }
  ): Array<{ item: T; matchType: PinyinMatchResult['matchType']; confidence: number }> {
    const opts = {
      threshold: this.config.similarityThreshold,
      usePinyin: true,
      useSimilarity: true,
      ...options,
    };

    const results: Array<{ item: T; matchType: PinyinMatchResult['matchType']; confidence: number }> = [];
    const seen = new Set<string>();

    const textVariants = this.getVariants(text);

    for (const item of candidates) {
      const key = `${item.name}`;
      if (seen.has(key)) continue;

      if (item.name === text) {
        seen.add(key);
        results.push({ item, matchType: 'exact', confidence: 1.0 });
        continue;
      }

      if (item.aliases?.includes(text)) {
        seen.add(key);
        results.push({ item, matchType: 'exact', confidence: 0.95 });
        continue;
      }

      if (opts.usePinyin) {
        const itemVariants = this.getVariants(item.name);

        if (itemVariants.full === textVariants.full) {
          seen.add(key);
          results.push({ item, matchType: 'pinyin_full', confidence: 0.9 });
          continue;
        }

        if (
          itemVariants.initials === textVariants.initials &&
          itemVariants.initials.length >= 2
        ) {
          seen.add(key);
          results.push({ item, matchType: 'pinyin_initials', confidence: 0.85 });
          continue;
        }
      }

      if (opts.useSimilarity) {
        const similarity = this.calculateSimilarity(
          text,
          item.name,
          opts.similarityOptions
        );
        if (similarity >= opts.threshold) {
          seen.add(key);
          results.push({
            item,
            matchType: 'fuzzy',
            confidence: similarity,
          });
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  
  clearCache(): void {
    this.cache.clear();
  }

  
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.config.enableCache,
    };
  }

  /**
   * Updateconfig
   *
   */
  updateConfig(config: Partial<PinyinServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get currentconfig
   */
  getConfig(): Readonly<Required<PinyinServiceConfig>> {
    return Object.freeze({ ...this.config });
  }
}

let pinyinService: PinyinService | null = null;

/**
 * GetpinyinserviceSingleton
 *
 * @returns PinyinService instance
 */
export function getPinyinService(config?: PinyinServiceConfig): PinyinService {
  if (!pinyinService) {
    pinyinService = new PinyinService(config);
  }
  return pinyinService;
}

/**
 * ResetpinyinserviceSingleton。
 */
export function resetPinyinService(): void {
  pinyinService = null;
}
