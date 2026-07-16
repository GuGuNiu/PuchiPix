/**
 * 拼音服务模块
 *
 * 提供拼音转换、匹配和相似度计算的统一 API。
 * 支持多种相似度算法：Levenshtein、Jaro-Winkler、Bigram、Combined。
 */

// 类型导出
export type {
  PinyinConvertOptions,
  PinyinMatchOptions,
  SimilarityOptions,
  SimilarityAlgorithm,
  PinyinVariants,
  PinyinMatchResult,
  PinyinServiceConfig,
  PinyinEngine,
  SimilarityCalculator,
} from './types';

// 服务导出
export {
  PinyinService,
  getPinyinService,
  resetPinyinService,
} from './pinyin-service';

// 引擎适配器导出
export { PinyinProAdapter } from './pinyin-pro-adapter';

// 相似度计算器导出
export {
  LevenshteinCalculator,
  JaroWinklerCalculator,
  BigramCalculator,
  CombinedCalculator,
  createSimilarityCalculator,
} from './similarity-calculators';
