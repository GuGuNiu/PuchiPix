/**
 * 角色识别库入口
 *
 * 导出所有类型和服务
 */

// 类型导出
export type {
  ContentCategory,
  DataSource,
  CharacterEntry,
  GameIndexEntry,
  CharacterDBIndex,
  GameCharacterFile,
  CharacterMatch,
  MatchType,
  SyncLog,
  GameSyncResult,
  SyncError,
  LegacyGameType,
} from './types';

export { GAME_LABELS } from './types';

// 服务导出
export {
  CharacterDBService,
  getCharacterDBService,
  resetCharacterDBService,
} from './character-db-service';
export type { CharacterDBConfig } from './character-db-service';

// 爬虫导出
export {
  BWikiCrawler,
  getBWikiCrawler,
  type BWikiCrawlerConfig,
} from './crawlers/bwiki-crawler';

// 同步调度器导出
export {
  CharacterDBScheduler,
  getCharacterDBScheduler,
  type SchedulerConfig,
} from './sync/scheduler';

// 拼音匹配器导出
export {
  PinyinMatcher,
  getPinyinMatcher,
  type PinyinMatchResult,
  type PinyinMatcherConfig,
} from './utils/pinyin-matcher';

// 别名库导出
export {
  AliasLibrary,
  getAliasLibrary,
  type AliasRule,
  type AliasLibraryConfig,
} from './utils/alias-library';
