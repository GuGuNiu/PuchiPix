
/** 内容分类 */
export type ContentCategory = 'game' | 'anime' | 'manga' | 'light-novel';

/** 数据源类型 */
export type DataSource = 'bwiki' | 'moegirl' | 'manual';

/** 角色条目 */
export interface CharacterEntry {
  /** 全局唯一ID: "{gameId}-{name}" */
  id: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn?: string;
  /** 日文名 */
  nameJp?: string;
  /** 别名列表（含常见误写、昵称） */
  aliases: string[];
  /** 所属游戏/作品ID */
  gameId: string;
  /** 所属游戏/作品名 */
  gameName: string;
  /** 内容分类 */
  category: ContentCategory;
  /** 稀有度（1-6星） */
  rarity?: number;
  /** 元素/属性 */
  element?: string;
  /** 武器类型 */
  weapon?: string;
  /** 所属阵营 */
  faction?: string;
  /** 声优 */
  cv?: string;
  /** 角色立绘URL */
  imageUrl?: string;
  /** 实装日期 */
  releaseDate?: string;
  /** 是否可玩/主要角色 */
  isPlayable?: boolean;
  /** 标签 */
  tags: string[];
  /** 扩展元数据 */
  metadata: Record<string, unknown>;
}

/** 游戏/作品索引条目 */
export interface GameIndexEntry {
  /** 唯一标识 */
  id: string;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
  /** 内容分类 */
  category: ContentCategory;
  /** JSON文件路径（相对于character-db目录） */
  file: string;
  /** 角色数量 */
  characterCount: number;
  /** 最后同步时间 */
  lastSync: string;
  /** 数据源 */
  source: DataSource;
  /** 数据源URL */
  sourceUrl: string;
  /** 是否启用 */
  enabled: boolean;
}

/** 索引文件结构 */
export interface CharacterDBIndex {
  /** 版本号 */
  version: string;
  /** 最后更新时间 */
  lastUpdated: string;
  /** 游戏/作品列表 */
  games: GameIndexEntry[];
  /** 统计信息 */
  stats: {
    totalGames: number;
    totalCharacters: number;
    totalGamesEnabled: number;
  };
}

/** 单游戏角色库文件结构 */
export interface GameCharacterFile {
  /** 游戏ID */
  gameId: string;
  /** 游戏名 */
  gameName: string;
  /** 游戏版本（如原神5.7） */
  version?: string;
  /** 最后同步时间 */
  lastSync: string;
  /** 数据源 */
  source: DataSource;
  /** 角色列表 */
  characters: CharacterEntry[];
}

/** 匹配类型 */
export type MatchType =
  | 'exact'      // 精确匹配
  | 'alias'      // 别名匹配
  | 'pinyin'     // 拼音匹配（通用）
  | 'pinyin_full'    // 全拼音匹配
  | 'pinyin_initials' // 首字母匹配
  | 'pinyin_fuzzy'    // 模糊拼音匹配
  | 'similar';   // 相似度匹配

/** 匹配结果 */
export interface CharacterMatch {
  /** 匹配到的角色 */
  character: CharacterEntry;
  /** 匹配的原始文本 */
  matchedText: string;
  /** 匹配类型 */
  matchType: MatchType;
  /** 置信度（0-1） */
  confidence: number;
}

/** 同步日志 */
export interface SyncLog {
  /** 开始时间 */
  startedAt: string;
  /** 完成时间 */
  completedAt?: string;
  /** 各游戏同步结果 */
  games: GameSyncResult[];
  /** 错误记录 */
  errors: SyncError[];
}

/** 单游戏同步结果 */
export interface GameSyncResult {
  gameId: string;
  /** 新增角色数 */
  added: number;
  /** 删除角色数 */
  removed: number;
  /** 修改角色数 */
  modified: number;
}

/** 同步错误 */
export interface SyncError {
  gameId: string;
  error: string;
}

/** 向后兼容：游戏类型  */
export type LegacyGameType =
  | 'genshin'
  | 'starrail'
  | 'wuthering'
  | 'azurlane'
  | 'bluearchive'
  | 'arknights'
  | 'zenless';

/** 向后兼容：游戏标签映射 */
export const GAME_LABELS: Record<LegacyGameType, string> = {
  genshin: '原神',
  starrail: '星穹铁道',
  wuthering: '鸣潮',
  azurlane: '碧蓝航线',
  bluearchive: '碧蓝档案',
  arknights: '明日方舟',
  zenless: '绝区零',
};
