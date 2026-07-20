/*
 * Character DB Module Exports - v2
 * TypeExport
 */
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

// ServiceExport
export {
  CharacterDBService,
  getCharacterDBService,
  getCharacterDBServiceAsync,
  resetCharacterDBService,
} from './character-db-service';
export type { CharacterDBConfig } from './character-db-service';

// Crawlerexport
export {
  BWikiCrawler,
  getBWikiCrawler,
  type BWikiCrawlerConfig,
} from './crawlers/bwiki-crawler';

// SyncschedulerExport
export {
  CharacterDBScheduler,
  getCharacterDBScheduler,
  type SchedulerConfig,
} from './scheduler';

// Pinyin matcherexport
export {
  PinyinMatcher,
  getPinyinMatcher,
  type PinyinMatchResult,
  type PinyinMatcherConfig,
} from './utils/pinyin-matcher';

// Alias libraryexport
export {
  AliasLibrary,
  getAliasLibrary,
  type AliasRule,
  type AliasLibraryConfig,
} from './utils/alias-library';
