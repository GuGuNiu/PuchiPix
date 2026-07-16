/**
 * 拼音匹配器
 *
 * 基于核心拼音服务的角色匹配工具，支持多种相似度算法。
 */

import { getPinyinService, type SimilarityOptions } from '@/lib/core/pinyin-service';
import type { CharacterEntry } from '../types';

export interface PinyinMatchResult {
  character: CharacterEntry;
  matchedText: string;
  matchType: 'pinyin_full' | 'pinyin_initials' | 'pinyin_fuzzy' | 'alias' | 'similar';
  confidence: number;
  similarity: number;
}

export interface PinyinMatcherConfig {
  /** 相似度阈值 (0-1)，低于此值不返回结果 */
  similarityThreshold: number;
  /** 是否启用模糊匹配 */
  enableFuzzy: boolean;
  /** 模糊匹配容错率 */
  fuzzyTolerance: number;
  /** 最大编辑距离 */
  maxEditDistance: number;
  /** 相似度算法选项 */
  similarityOptions?: SimilarityOptions;
}

export class PinyinMatcher {
  private config: PinyinMatcherConfig;
  private pinyinService = getPinyinService();
  /** 角色拼音缓存 */
  private pinyinCache = new Map<string, {
    full: string;
    initials: string;
    aliases: Map<string, { full: string; initials: string }>;
  }>();

  constructor(config: Partial<PinyinMatcherConfig> = {}) {
    this.config = {
      similarityThreshold: 0.6,
      enableFuzzy: true,
      fuzzyTolerance: 0.3,
      maxEditDistance: 2,
      similarityOptions: {
        algorithm: 'combined',
        ignoreCase: true,
        ignoreSpaces: true,
        weights: {
          levenshtein: 0.4,
          jaroWinkler: 0.3,
          bigram: 0.3,
        },
      },
      ...config,
    };
  }

  /**
   * 为角色列表构建拼音索引
   */
  buildIndex(characters: CharacterEntry[]): void {
    this.pinyinCache.clear();

    for (const char of characters) {
      const mainVariants = this.pinyinService.getVariants(char.name);

      // 构建别名拼音映射
      const aliasesPinyin = new Map<string, { full: string; initials: string }>();
      for (const alias of char.aliases) {
        const aliasVariants = this.pinyinService.getVariants(alias);
        aliasesPinyin.set(alias, {
          full: aliasVariants.full,
          initials: aliasVariants.initials,
        });
      }

      this.pinyinCache.set(char.id, {
        full: mainVariants.full,
        initials: mainVariants.initials,
        aliases: aliasesPinyin,
      });
    }
  }

  /**
   * 在文本中查找匹配的角色
   */
  findMatches(text: string, characters: CharacterEntry[]): PinyinMatchResult[] {
    const results: PinyinMatchResult[] = [];
    const seen = new Set<string>();

    if (this.pinyinCache.size === 0) {
      this.buildIndex(characters);
    }

    const candidates = this.extractCandidates(text);

    for (const candidate of candidates) {
      const candidateVariants = this.pinyinService.getVariants(candidate);

      for (const char of characters) {
        const cached = this.pinyinCache.get(char.id);
        if (!cached) continue;

        // 精确匹配
        if (this.exactMatch(candidate, char, cached)) {
          const key = `${char.id}:exact`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              character: char,
              matchedText: candidate,
              matchType: 'alias',
              confidence: 1.0,
              similarity: 1.0,
            });
          }
          continue;
        }

        // 全拼音匹配（使用相似度算法）
        const fullSim = this.pinyinService.calculateSimilarity(
          candidateVariants.full,
          cached.full,
          this.config.similarityOptions
        );
        if (fullSim >= this.config.similarityThreshold) {
          const key = `${char.id}:full`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              character: char,
              matchedText: candidate,
              matchType: 'pinyin_full',
              confidence: fullSim,
              similarity: fullSim,
            });
          }
          continue;
        }

        // 首字母匹配
        if (candidateVariants.initials === cached.initials && cached.initials.length >= 2) {
          const key = `${char.id}:initials`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              character: char,
              matchedText: candidate,
              matchType: 'pinyin_initials',
              confidence: 0.9,
              similarity: 0.9,
            });
          }
          continue;
        }

        // 别名匹配
        for (const [alias, aliasPinyin] of cached.aliases) {
          const aliasSim = this.pinyinService.calculateSimilarity(
            candidateVariants.full,
            aliasPinyin.full,
            this.config.similarityOptions
          );
          if (aliasSim >= this.config.similarityThreshold) {
            const key = `${char.id}:alias:${alias}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                character: char,
                matchedText: candidate,
                matchType: 'alias',
                confidence: aliasSim * 0.95,
                similarity: aliasSim,
              });
            }
            break;
          }
        }

        // 模糊匹配（使用 Combined 算法）
        if (this.config.enableFuzzy) {
          const fuzzySim = this.pinyinService.calculateSimilarity(
            candidateVariants.full,
            cached.full,
            {
              ...this.config.similarityOptions,
              algorithm: 'combined',
            }
          );
          if (fuzzySim >= this.config.similarityThreshold) {
            const key = `${char.id}:fuzzy`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                character: char,
                matchedText: candidate,
                matchType: 'pinyin_fuzzy',
                confidence: fuzzySim * 0.85,
                similarity: fuzzySim,
              });
            }
          }
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 从文本中提取候选名称
   */
  private extractCandidates(text: string): string[] {
    const candidates: string[] = [];

    const chineseMatches = text.match(/[\u4e00-\u9fff]{2,10}/g);
    if (chineseMatches) {
      candidates.push(...chineseMatches);
    }

    const englishMatches = text.match(/[a-zA-Z]{2,20}/g);
    if (englishMatches) {
      candidates.push(...englishMatches.map(m => m.toLowerCase()));
    }

    const mixedMatches = text.match(/[\u4e00-\u9fff]+[a-zA-Z]+|[a-zA-Z]+[\u4e00-\u9fff]+/g);
    if (mixedMatches) {
      for (const match of mixedMatches) {
        const chinese = match.match(/[\u4e00-\u9fff]+/g);
        if (chinese) candidates.push(...chinese);
      }
    }

    return [...new Set(candidates)];
  }

  /**
   * 精确匹配检查
   */
  private exactMatch(
    candidate: string,
    char: CharacterEntry,
    cached: { full: string; initials: string; aliases: Map<string, unknown> }
  ): boolean {
    const lowerCandidate = candidate.toLowerCase();

    if (lowerCandidate === char.name.toLowerCase()) return true;
    if (lowerCandidate === cached.full) return true;
    if (lowerCandidate === cached.initials && cached.initials.length >= 2) return true;

    for (const alias of char.aliases) {
      if (lowerCandidate === alias.toLowerCase()) return true;
    }

    return false;
  }

  /**
   * 批量匹配 TAG 列表
   */
  matchTags(tags: string[], characters: CharacterEntry[]): PinyinMatchResult[] {
    const allResults: PinyinMatchResult[] = [];
    const seen = new Set<string>();

    for (const tag of tags) {
      const matches = this.findMatches(tag, characters);
      for (const match of matches) {
        const key = `${match.character.id}:${match.matchType}`;
        if (!seen.has(key)) {
          seen.add(key);
          allResults.push(match);
        }
      }
    }

    return allResults.sort((a, b) => b.confidence - a.confidence);
  }
}

// 导出单例
let pinyinMatcher: PinyinMatcher | null = null;

export function getPinyinMatcher(config?: Partial<PinyinMatcherConfig>): PinyinMatcher {
  if (!pinyinMatcher) {
    pinyinMatcher = new PinyinMatcher(config);
  }
  return pinyinMatcher;
}
