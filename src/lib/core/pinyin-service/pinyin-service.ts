/**
 * 拼音服务
 *
 * 提供统一的拼音转换、匹配和相似度计算能力。
 * 基于 Pinyin-Pro 引擎，支持多种相似度算法（Levenshtein、Jaro-Winkler、Bigram、Combined）。
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
   * 转换文本为拼音
   *
   * @param text - 待转换文本
   * @param options - 转换选项
   * @returns 拼音字符串或数组
   */
  convert(text: string, options?: PinyinConvertOptions): string | string[] {
    const opts = { ...this.config.defaultConvertOptions, ...options };
    return this.engine.convert(text, opts);
  }

  /**
   * 获取文本的拼音变体（全拼、首字母等）
   *
   * @param text - 输入文本
   * @returns 拼音变体信息
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
   * 批量获取拼音变体
   *
   * @param texts - 文本数组
   * @returns 拼音变体数组
   */
  getVariantsBatch(texts: string[]): PinyinVariants[] {
    return texts.map(text => this.getVariants(text));
  }

  /**
   * 匹配文本拼音是否包含指定拼音
   *
   * @param text - 待匹配文本
   * @param pinyin - 拼音模式
   * @param options - 匹配选项
   * @returns 是否匹配
   */
  match(text: string, pinyin: string, options?: PinyinMatchOptions): boolean {
    const opts = { ...this.config.defaultMatchOptions, ...options };
    return this.engine.match(text, pinyin, opts);
  }

  /**
   * 计算两个字符串的相似度
   *
   * @param s1 - 第一个字符串
   * @param s2 - 第二个字符串
   * @param options - 相似度计算选项
   * @returns 相似度分数 (0-1)
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
   * 在候选列表中查找最佳匹配
   *
   * @param text - 查询文本
   * @param candidates - 候选文本列表
   * @param options - 相似度选项
   * @returns 最佳匹配结果
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
   * 查找所有满足相似度阈值的匹配
   *
   * @param text - 查询文本
   * @param candidates - 候选文本列表
   * @param threshold - 相似度阈值（默认使用配置值）
   * @param options - 相似度选项
   * @returns 匹配结果列表（按相似度降序）
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
   * 智能匹配：结合拼音和相似度算法
   *
   * @param text - 查询文本
   * @param candidates - 候选对象列表（需包含 name 字段）
   * @param options - 匹配选项
   * @returns 匹配结果列表
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

      // 精确匹配
      if (item.name === text) {
        seen.add(key);
        results.push({ item, matchType: 'exact', confidence: 1.0 });
        continue;
      }

      // 别名匹配
      if (item.aliases?.includes(text)) {
        seen.add(key);
        results.push({ item, matchType: 'exact', confidence: 0.95 });
        continue;
      }

      // 拼音匹配
      if (opts.usePinyin) {
        const itemVariants = this.getVariants(item.name);

        // 全拼音匹配
        if (itemVariants.full === textVariants.full) {
          seen.add(key);
          results.push({ item, matchType: 'pinyin_full', confidence: 0.9 });
          continue;
        }

        // 首字母匹配
        if (
          itemVariants.initials === textVariants.initials &&
          itemVariants.initials.length >= 2
        ) {
          seen.add(key);
          results.push({ item, matchType: 'pinyin_initials', confidence: 0.85 });
          continue;
        }
      }

      // 相似度匹配
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

  /**
   * 清空拼音变体缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; enabled: boolean } {
    return {
      size: this.cache.size,
      enabled: this.config.enableCache,
    };
  }

  /**
   * 更新配置
   *
   * @param config - 新配置项
   */
  updateConfig(config: Partial<PinyinServiceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<Required<PinyinServiceConfig>> {
    return Object.freeze({ ...this.config });
  }
}

// 单例实例
let pinyinService: PinyinService | null = null;

/**
 * 获取拼音服务单例
 *
 * @param config - 可选配置（首次调用时生效）
 * @returns PinyinService 实例
 */
export function getPinyinService(config?: PinyinServiceConfig): PinyinService {
  if (!pinyinService) {
    pinyinService = new PinyinService(config);
  }
  return pinyinService;
}

/**
 * 重置拼音服务单例（用于测试）
 */
export function resetPinyinService(): void {
  pinyinService = null;
}
