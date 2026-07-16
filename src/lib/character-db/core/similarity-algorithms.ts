/**
 * 相似度算法库
 *
 * 提供多种字符串相似度计算算法
 * - 二元相似度 (Bigram/Dice Coefficient)
 * - Jaccard 相似度
 * - Cosine 相似度
 * - Levenshtein 相似度
 * - Jaro-Winkler 距离
 */

/** 相似度算法接口 */
export interface SimilarityAlgorithm {
  readonly name: string;
  calculate(s1: string, s2: string): number;
}

/**
 * 二元相似度 (Bigram/Dice Coefficient)
 *
 * 将字符串拆分为连续的二元组，计算 Dice 系数
 * 适合短字符串的模糊匹配
 */
export class BigramSimilarity implements SimilarityAlgorithm {
  readonly name = 'bigram';

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const bigrams1 = this.getBigrams(s1);
    const bigrams2 = this.getBigrams(s2);

    if (bigrams1.size === 0 && bigrams2.size === 0) return 1.0;
    if (bigrams1.size === 0 || bigrams2.size === 0) return 0.0;

    // 计算交集
    let intersection = 0;
    for (const bigram of bigrams1) {
      if (bigrams2.has(bigram)) {
        intersection++;
      }
    }

    // Dice 系数: 2 * |A ∩ B| / (|A| + |B|)
    return (2 * intersection) / (bigrams1.size + bigrams2.size);
  }

  private getBigrams(text: string): Set<string> {
    const bigrams = new Set<string>();
    const normalized = text.toLowerCase();

    for (let i = 0; i < normalized.length - 1; i++) {
      bigrams.add(normalized.substring(i, i + 2));
    }

    return bigrams;
  }
}

/**
 * Jaccard 相似度
 *
 * 计算两个集合的交集与并集之比
 */
export class JaccardSimilarity implements SimilarityAlgorithm {
  readonly name = 'jaccard';

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const set1 = new Set(s1.toLowerCase());
    const set2 = new Set(s2.toLowerCase());

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 1.0;
    return intersection.size / union.size;
  }
}

/**
 * Cosine 相似度
 *
 * 基于字符频率向量的余弦相似度
 */
export class CosineSimilarity implements SimilarityAlgorithm {
  readonly name = 'cosine';

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const freq1 = this.getCharFrequency(s1);
    const freq2 = this.getCharFrequency(s2);

    // 获取所有唯一字符
    const allChars = new Set([...Object.keys(freq1), ...Object.keys(freq2)]);

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (const char of allChars) {
      const v1 = freq1[char] || 0;
      const v2 = freq2[char] || 0;

      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    }

    if (norm1 === 0 || norm2 === 0) return 0.0;

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  private getCharFrequency(text: string): Record<string, number> {
    const freq: Record<string, number> = {};
    const normalized = text.toLowerCase();

    for (const char of normalized) {
      freq[char] = (freq[char] || 0) + 1;
    }

    return freq;
  }
}

/**
 * Levenshtein 相似度
 *
 * 基于编辑距离的归一化相似度
 */
export class LevenshteinSimilarity implements SimilarityAlgorithm {
  readonly name = 'levenshtein';

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const distance = this.levenshteinDistance(s1.toLowerCase(), s2.toLowerCase());
    const maxLen = Math.max(s1.length, s2.length);

    if (maxLen === 0) return 1.0;
    return 1 - distance / maxLen;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;

    if (m === 0) return n;
    if (n === 0) return m;

    // 使用滚动数组优化空间
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
          prev[j] + 1,      // 删除
          curr[j - 1] + 1,  // 插入
          prev[j - 1] + cost // 替换
        );
      }
      [prev, curr] = [curr, prev];
    }

    return prev[n];
  }
}

/**
 * Jaro-Winkler 相似度
 *
 * 适合短字符串（如人名）的相似度计算
 * 对前缀匹配的权重更高
 */
export class JaroWinklerSimilarity implements SimilarityAlgorithm {
  readonly name = 'jaro-winkler';
  private readonly scalingFactor = 0.1;
  private readonly maxPrefixLength = 4;

  calculate(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    if (!s1 || !s2) return 0.0;

    const jaro = this.jaroDistance(s1, s2);
    const prefixScale = this.getCommonPrefixLength(s1, s2);

    return jaro + prefixScale * this.scalingFactor * (1 - jaro);
  }

  private jaroDistance(s1: string, s2: string): number {
    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0) return len2 === 0 ? 1.0 : 0.0;
    if (len2 === 0) return 0.0;

    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    // 查找匹配字符
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

    // 计算转置数
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

  private getCommonPrefixLength(s1: string, s2: string): number {
    const minLen = Math.min(s1.length, s2.length, this.maxPrefixLength);
    let prefixLen = 0;

    for (let i = 0; i < minLen; i++) {
      if (s1[i] === s2[i]) {
        prefixLen++;
      } else {
        break;
      }
    }

    return prefixLen;
  }
}

/**
 * 组合相似度
 *
 * 组合多种算法，加权计算最终相似度
 */
export class CombinedSimilarity implements SimilarityAlgorithm {
  readonly name = 'combined';

  private algorithms: Array<{ algorithm: SimilarityAlgorithm; weight: number }>;

  constructor(algorithms?: Array<{ algorithm: SimilarityAlgorithm; weight: number }>) {
    this.algorithms = algorithms || [
      { algorithm: new BigramSimilarity(), weight: 0.3 },
      { algorithm: new LevenshteinSimilarity(), weight: 0.3 },
      { algorithm: new JaroWinklerSimilarity(), weight: 0.2 },
      { algorithm: new CosineSimilarity(), weight: 0.2 },
    ];

    // 归一化权重
    const totalWeight = this.algorithms.reduce((sum, a) => sum + a.weight, 0);
    this.algorithms = this.algorithms.map(a => ({
      ...a,
      weight: a.weight / totalWeight,
    }));
  }

  calculate(s1: string, s2: string): number {
    let score = 0;
    for (const { algorithm, weight } of this.algorithms) {
      score += algorithm.calculate(s1, s2) * weight;
    }
    return score;
  }

  /**
   * 获取各算法的详细分数
   */
  getDetailedScores(s1: string, s2: string): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const { algorithm } of this.algorithms) {
      scores[algorithm.name] = algorithm.calculate(s1, s2);
    }
    return scores;
  }
}

/** 算法工厂 */
export class SimilarityAlgorithmFactory {
  private static algorithms = new Map<string, new () => SimilarityAlgorithm>([
    ['bigram', BigramSimilarity],
    ['jaccard', JaccardSimilarity],
    ['cosine', CosineSimilarity],
    ['levenshtein', LevenshteinSimilarity],
    ['jaro-winkler', JaroWinklerSimilarity],
    ['combined', CombinedSimilarity],
  ]);

  static create(name: string): SimilarityAlgorithm {
    const AlgorithmClass = this.algorithms.get(name);
    if (!AlgorithmClass) {
      throw new Error(`未知的相似度算法: ${name}`);
    }
    return new AlgorithmClass();
  }

  static getAvailableAlgorithms(): string[] {
    return Array.from(this.algorithms.keys());
  }

  static register(name: string, algorithmClass: new () => SimilarityAlgorithm): void {
    this.algorithms.set(name, algorithmClass);
  }
}

// 导出默认实例
export const bigramSimilarity = new BigramSimilarity();
export const jaccardSimilarity = new JaccardSimilarity();
export const cosineSimilarity = new CosineSimilarity();
export const levenshteinSimilarity = new LevenshteinSimilarity();
export const jaroWinklerSimilarity = new JaroWinklerSimilarity();
export const combinedSimilarity = new CombinedSimilarity();
