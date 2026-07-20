/**
 * Pinyinservicemodule
 *
 */

// TypeExport
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

// ServiceExport
export {
  PinyinService,
  getPinyinService,
  resetPinyinService,
} from './pinyin-service';

// EngineAdapterExport
export { PinyinProAdapter } from './pinyin-pro-adapter';

export {
  LevenshteinCalculator,
  JaroWinklerCalculator,
  BigramCalculator,
  CombinedCalculator,
  createSimilarityCalculator,
} from './similarity-calculators';
