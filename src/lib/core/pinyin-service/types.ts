/**
 * 拼音服务类型定义
 *
 * 定义拼音转换、匹配、相似度计算的接口和类型。
 */

/** 拼音转换选项 */
export interface PinyinConvertOptions {
  /** 音调类型 */
  toneType?: 'symbol' | 'num' | 'none';
  /** 输出格式 */
  type?: 'string' | 'array';
  /** 非中文字符处理方式 */
  nonZh?: 'consecutive' | 'removed' | 'spaced';
}

/** 拼音匹配选项 */
export interface PinyinMatchOptions {
  /** 匹配精度 */
  precision?: 'start' | 'every' | 'any';
  /** 是否连续匹配 */
  continuous?: boolean;
  /** 大小写敏感 */
  caseSensitive?: boolean;
}

/** 相似度算法类型 */
export type SimilarityAlgorithm = 'levenshtein' | 'jaroWinkler' | 'bigram' | 'combined';

/** 相似度计算选项 */
export interface SimilarityOptions {
  /** 使用的算法 */
  algorithm?: SimilarityAlgorithm;
  /** 是否忽略大小写 */
  ignoreCase?: boolean;
  /** 是否忽略空格 */
  ignoreSpaces?: boolean;
  /** 权重配置（combined 算法使用） */
  weights?: {
    levenshtein?: number;
    jaroWinkler?: number;
    bigram?: number;
  };
}

/** 拼音变体信息 */
export interface PinyinVariants {
  /** 原始文本 */
  original: string;
  /** 全拼音（无音调） */
  full: string;
  /** 首字母 */
  initials: string;
  /** 带音调拼音 */
  withTone?: string;
  /** 拼音数组 */
  array: string[];
}

/** 匹配结果 */
export interface PinyinMatchResult {
  /** 是否匹配 */
  matched: boolean;
  /** 匹配到的文本 */
  matchedText: string;
  /** 匹配类型 */
  matchType: 'exact' | 'pinyin_full' | 'pinyin_initials' | 'fuzzy';
  /** 置信度 (0-1) */
  confidence: number;
  /** 相似度分数 */
  similarity: number;
}

/** 拼音服务配置 */
export interface PinyinServiceConfig {
  /** 默认转换选项 */
  defaultConvertOptions?: PinyinConvertOptions;
  /** 默认匹配选项 */
  defaultMatchOptions?: PinyinMatchOptions;
  /** 默认相似度选项 */
  defaultSimilarityOptions?: SimilarityOptions;
  /** 相似度阈值 */
  similarityThreshold?: number;
  /** 最大编辑距离 */
  maxEditDistance?: number;
  /** 是否启用缓存 */
  enableCache?: boolean;
}

/** 拼音引擎接口 */
export interface PinyinEngine {
  /** 转换文本为拼音 */
  convert(text: string, options?: PinyinConvertOptions): string | string[];
  /** 匹配拼音 */
  match(text: string, pinyin: string, options?: PinyinMatchOptions): boolean;
  /** 获取拼音变体 */
  getVariants(text: string): PinyinVariants;
}

/** 相似度计算器接口 */
export interface SimilarityCalculator {
  /** 计算两个字符串的相似度 */
  calculate(s1: string, s2: string): number;
  /** 算法名称 */
  name: SimilarityAlgorithm;
}
