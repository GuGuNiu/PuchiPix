
/** Contentcategory */
export type ContentCategory = 'game' | 'anime' | 'manga' | 'light-novel';

/** Datasourcetype */
export type DataSource = 'bwiki' | 'moegirl' | 'manual';

export interface CharacterEntry {
  id: string;
  name: string;
  nameEn?: string;
  nameJp?: string;
  aliases: string[];
  gameId: string;
  gameName: string;
  /** Contentcategory */
  category: ContentCategory;
  rarity?: number;
  element?: string;
  weapon?: string;
  faction?: string;
  cv?: string;
  imageUrl?: string;
  releaseDate?: string;
  isPlayable?: boolean;
  /** Tag */
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface GameIndexEntry {
  id: string;
  name: string;
  nameEn: string;
  /** Contentcategory */
  category: ContentCategory;
  file: string;
  /** Roleamount */
  characterCount: number;
  lastSync: string;
  /** Datasource */
  source: DataSource;
  /** DatasourceURL */
  sourceUrl: string;
  /** Isnoenabled */
  enabled: boolean;
}

/** Indexfilestructure */
export interface CharacterDBIndex {
  version: string;
  lastUpdated: string;
  games: GameIndexEntry[];
  stats: {
    totalGames: number;
    totalCharacters: number;
    totalGamesEnabled: number;
  };
}

export interface GameCharacterFile {
  gameId: string;
  gameName: string;
  version?: string;
  lastSync: string;
  /** Datasource */
  source: DataSource;
  /** RoleList */
  characters: CharacterEntry[];
}

/** Matchtype */
export type MatchType =
  | 'exact'      // Exact match
  | 'alias'      // Alias match
  | 'pinyin'     // General pinyin match
  | 'pinyin_full'    // Full pinyin match
  | 'pinyin_initials' // Initials match
  | 'pinyin_fuzzy'    // Fuzzy pinyin match
  | 'similar';   // Similarity match

/** Matchresult */
export interface CharacterMatch {
  /** Matchto role */
  character: CharacterEntry;
  matchedText: string;
  /** Matchtype */
  matchType: MatchType;
  confidence: number;
}

/** Synclog */
export interface SyncLog {
  startedAt: string;
  completedAt?: string;
  games: GameSyncResult[];
  /** ErrorLog */
  errors: SyncError[];
}

export interface GameSyncResult {
  gameId: string;
  added: number;
  removed: number;
  modified: number;
}

/** SyncError */
export interface SyncError {
  gameId: string;
  error: string;
}

export type LegacyGameType =
  | 'genshin'
  | 'starrail'
  | 'wuthering'
  | 'azurlane'
  | 'bluearchive'
  | 'arknights'
  | 'zenless';

export const GAME_LABELS: Record<LegacyGameType, string> = {
  genshin: '原神',
  starrail: '星穹铁道',
  wuthering: '鸣潮',
  azurlane: '碧蓝航线',
  bluearchive: '碧蓝档案',
  arknights: '明日方舟',
  zenless: '绝区零',
};
