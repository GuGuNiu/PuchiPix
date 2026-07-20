

/** PinyinConvertoption */
export interface PinyinConvertOptions {
  toneType?: 'symbol' | 'num' | 'none';
  type?: 'string' | 'array';
  nonZh?: 'consecutive' | 'removed' | 'spaced';
}

/** PinyinMatchoption */
export interface PinyinMatchOptions {
  precision?: 'start' | 'every' | 'any';
  /** IsnocontinuousMatch */
  continuous?: boolean;
  caseSensitive?: boolean;
}

export type SimilarityAlgorithm = 'levenshtein' | 'jaroWinkler' | 'bigram' | 'combined';

/** SimilarityCalculateoption */
export interface SimilarityOptions {
  algorithm?: SimilarityAlgorithm;
  ignoreCase?: boolean;
  ignoreSpaces?: boolean;
  weights?: {
    levenshtein?: number;
    jaroWinkler?: number;
    bigram?: number;
  };
}

export interface PinyinVariants {
  original: string;
  full: string;
  initials: string;
  withTone?: string;
  /** PinyinArray */
  array: string[];
}

/** Matchresult */
export interface PinyinMatchResult {
  /** IsnoMatch */
  matched: boolean;
  matchedText: string;
  /** Matchtype */
  matchType: 'exact' | 'pinyin_full' | 'pinyin_initials' | 'fuzzy';
  confidence: number;
  similarity: number;
}

/** Pinyinserviceconfig */
export interface PinyinServiceConfig {
  /** DefaultConvertoption */
  defaultConvertOptions?: PinyinConvertOptions;
  /** DefaultMatchoption */
  defaultMatchOptions?: PinyinMatchOptions;
  /** Defaultsimilarityoption */
  defaultSimilarityOptions?: SimilarityOptions;
  similarityThreshold?: number;
  maxEditDistance?: number;
  /** IsnoenabledCache */
  enableCache?: boolean;
}

/** PinyinengineInterface */
export interface PinyinEngine {
  convert(text: string, options?: PinyinConvertOptions): string | string[];
  /** Matchpinyin */
  match(text: string, pinyin: string, options?: PinyinMatchOptions): boolean;
  getVariants(text: string): PinyinVariants;
}

export interface SimilarityCalculator {
  calculate(s1: string, s2: string): number;
  name: SimilarityAlgorithm;
}
