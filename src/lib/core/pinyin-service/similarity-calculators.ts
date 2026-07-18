/**
 * 相似度计算器集合
 *
 * 提供多种字符串相似度算法实现。
 */

import type { SimilarityCalculator, SimilarityAlgorithm } from './types';

/**
 * Levenshtein 编辑距离算法
 *
 * 计算两个字符串之间的最小编辑距离（插入、删除、替换）。
 */
export class LevenshteinCalculator implements SimilarityCalculator {
  name: SimilarityAlgorithm = 'levenshtein';

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const distance = this.levenshteinDistance(s1, s2);
    const maxLen = Math.max(s1.length, s2.length);

    return 1 - distance / maxLen;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    let prev = new Array(n + 1);
    let curr = new Array(n + 1);

    for (let j = 0; j <= n; j++) {
      prev[j] = j;
    }

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
      }
      [prev, curr] = [curr, prev];
    }

    return prev[n];
  }
}

/**
 * Jaro-Winkler 相似度算法
 *
 * 适合短字符串比较，对前缀匹配给予更高权重。
 */
export class JaroWinklerCalculator implements SimilarityCalculator {
  name: SimilarityAlgorithm = 'jaroWinkler';
  private readonly scalingFactor = 0.1;
  private readonly maxPrefixLength = 4;

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const jaro = this.jaroSimilarity(s1, s2);
    const prefixLength = this.commonPrefixLength(s1, s2);
    const jaroWinkler = jaro + prefixLength * this.scalingFactor * (1 - jaro);

    return Math.min(jaroWinkler, 1.0);
  }

  private jaroSimilarity(s1: string, s2: string): number {
    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0 && len2 === 0) return 1.0;
    if (len1 === 0 || len2 === 0) return 0.0;

    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, len2);

      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    return (
      (matches / len1 +
        matches / len2 +
        (matches - transpositions / 2) / matches) / 3
    );
  }

  private commonPrefixLength(s1: string, s2: string): number {
    let length = 0;
    const minLen = Math.min(s1.length, s2.length, this.maxPrefixLength);

    for (let i = 0; i < minLen; i++) {
      if (s1[i] === s2[i]) {
        length++;
      } else {
        break;
      }
    }

    return length;
  }
}

/**
 * Bigram (二元语法) 相似度算法
 *
 * 将字符串拆分为连续的二元组，计算集合的 Dice 系数。
 * Dice 系数 = 2×|A∩B| / (|A|+|B|)，对部分匹配比 Jaccard 更宽容，
 * 适合拼音模糊匹配场景。
 */
export class BigramCalculator implements SimilarityCalculator {
  name: SimilarityAlgorithm = 'bigram';

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const bigrams1 = this.getBigrams(s1);
    const bigrams2 = this.getBigrams(s2);

    const intersection = this.getIntersection(bigrams1, bigrams2);
    const denominator = bigrams1.size + bigrams2.size;

    if (denominator === 0) return 0.0;

    return (2 * intersection.size) / denominator;
  }

  private getBigrams(str: string): Set<string> {
    const bigrams = new Set<string>();

    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }

    return bigrams;
  }

  private getIntersection(set1: Set<string>, set2: Set<string>): Set<string> {
    const intersection = new Set<string>();

    for (const item of set1) {
      if (set2.has(item)) {
        intersection.add(item);
      }
    }

    return intersection;
  }
}

/**
 * 组合相似度计算器
 *
 * 综合 Levenshtein、Jaro-Winkler 和 Bigram(Dice) 三种算法的加权结果。
 * 默认权重为 Levenshtein×0.4 + JaroWinkler×0.3 + Bigram(Dice)×0.3，
 * 权重经归一化后求和，确保总分在 0-1 范围内。
 */
export class CombinedCalculator implements SimilarityCalculator {
  name: SimilarityAlgorithm = 'combined';
  private calculators: Map<SimilarityAlgorithm, SimilarityCalculator>;
  private weights: Map<SimilarityAlgorithm, number>;

  constructor(weights?: {
    levenshtein?: number;
    jaroWinkler?: number;
    bigram?: number;
  }) {
    this.calculators = new Map<SimilarityAlgorithm, SimilarityCalculator>([
      ['levenshtein', new LevenshteinCalculator()],
      ['jaroWinkler', new JaroWinklerCalculator()],
      ['bigram', new BigramCalculator()],
    ]);

    const totalWeight =
      (weights?.levenshtein ?? 0.4) +
      (weights?.jaroWinkler ?? 0.3) +
      (weights?.bigram ?? 0.3);

    this.weights = new Map([
      ['levenshtein', (weights?.levenshtein ?? 0.4) / totalWeight],
      ['jaroWinkler', (weights?.jaroWinkler ?? 0.3) / totalWeight],
      ['bigram', (weights?.bigram ?? 0.3) / totalWeight],
    ]);
  }

  calculate(s1: string, s2: string): number {
    let score = 0;

    for (const [algo, calculator] of this.calculators) {
      const weight = this.weights.get(algo) ?? 0.33;
      score += calculator.calculate(s1, s2) * weight;
    }

    return Math.min(score, 1.0);
  }
}

/**
 * 相似度计算器工厂
 */
export function createSimilarityCalculator(
  algorithm: SimilarityAlgorithm,
  weights?: { levenshtein?: number; jaroWinkler?: number; bigram?: number }
): SimilarityCalculator {
  switch (algorithm) {
    case 'levenshtein':
      return new LevenshteinCalculator();
    case 'jaroWinkler':
      return new JaroWinklerCalculator();
    case 'bigram':
      return new BigramCalculator();
    case 'combined':
      return new CombinedCalculator(weights);
    default:
      return new LevenshteinCalculator();
  }
}
