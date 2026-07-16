/**
 * 游戏角色服务（已迁移到 CharacterDB）
 *
 * 此文件现在作为 CharacterDB 的代理，保持向后兼容
 * 所有实际逻辑已委托给 CharacterDBService
 */

import type { CharacterEntry, CharacterMatch } from '@/lib/character-db/types';
import { getCharacterDBService } from '@/lib/character-db/character-db-service';

/** 向后兼容：游戏类型 */
export type GameType = 'genshin' | 'starrail' | 'wuthering' | 'azurlane' | 'bluearchive' | 'arknights' | 'zenless';

/** 向后兼容：游戏角色 */
export interface GameCharacter {
  name: string;
  aliases?: string[];
  game: GameType;
}

/** 向后兼容：匹配结果 */
export interface GameCharacterMatch {
  character: GameCharacter;
  matchedText: string;
  matchType: 'exact' | 'alias' | 'pinyin';
  confidence: number;
}

/** 向后兼容：游戏标签映射 */
export const GAME_LABELS: Record<GameType, string> = {
  genshin: '原神',
  starrail: '星穹铁道',
  wuthering: '鸣潮',
  azurlane: '碧蓝航线',
  bluearchive: '碧蓝档案',
  arknights: '明日方舟',
  zenless: '绝区零',
};

/**
 * 将 CharacterEntry 转换为向后兼容的 GameCharacter
 */
function toLegacyCharacter(entry: CharacterEntry): GameCharacter {
  return {
    name: entry.name,
    aliases: entry.aliases,
    game: entry.gameId as GameType,
  };
}

/**
 * 将 CharacterMatch 转换为向后兼容的 GameCharacterMatch
 */
function toLegacyMatch(match: CharacterMatch): GameCharacterMatch {
  const legacyMatchType: 'exact' | 'alias' | 'pinyin' =
    match.matchType === 'exact' ? 'exact' :
    match.matchType === 'alias' ? 'alias' : 'pinyin';
  return {
    character: toLegacyCharacter(match.character),
    matchedText: match.matchedText,
    matchType: legacyMatchType,
    confidence: match.confidence,
  };
}

export class GameCharacterService {
  private dbService = getCharacterDBService();
  private initialized = false;

  /**
   * 确保数据库已加载
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      if (!this.dbService.isLoaded()) {
        await this.dbService.load();
      }
      this.initialized = true;
    }
  }

  /**
   * 在 TAG 列表中识别游戏角色
   *
   * @param tags - 图包的 TAG 列表
   * @returns 匹配结果列表（去重）
   */
  async identifyInTags(tags: string[]): Promise<GameCharacterMatch[]> {
    await this.ensureInitialized();
    const matches = this.dbService.identifyInTags(tags);
    // 只返回游戏角色（排除动漫角色）
    return matches
      .filter(m => m.character.category === 'game')
      .map(toLegacyMatch);
  }

  /**
   * 在文本中识别游戏角色名
   *
   * @param text - 待检测文本（如标题）
   * @returns 匹配结果列表
   */
  async identifyInText(text: string): Promise<GameCharacterMatch[]> {
    await this.ensureInitialized();
    const matches = this.dbService.identifyInText(text);
    return matches
      .filter(m => m.character.category === 'game')
      .map(toLegacyMatch);
  }

  /**
   * 按名称精确查找角色
   */
  async getCharacter(name: string): Promise<GameCharacter | null> {
    await this.ensureInitialized();
    const char = this.dbService.getCharacter(name);
    if (char && char.category === 'game') {
      return toLegacyCharacter(char);
    }
    return null;
  }

  /**
   * 获取指定游戏的全部角色
   */
  async getCharactersByGame(game: GameType): Promise<GameCharacter[]> {
    await this.ensureInitialized();
    return this.dbService
      .getCharactersByGame(game)
      .filter(c => c.category === 'game')
      .map(toLegacyCharacter);
  }

  /**
   * 获取全部角色
   */
  async getAllCharacters(): Promise<GameCharacter[]> {
    await this.ensureInitialized();
    return this.dbService
      .getAllCharacters()
      .filter(c => c.category === 'game')
      .map(toLegacyCharacter);
  }

  /**
   * 获取角色总数统计
   */
  async getStats(): Promise<Record<GameType, number>> {
    await this.ensureInitialized();
    const stats = this.dbService.getStats();
    const result: Record<GameType, number> = {
      genshin: 0,
      starrail: 0,
      wuthering: 0,
      azurlane: 0,
      bluearchive: 0,
      arknights: 0,
      zenless: 0,
    };

    for (const [gameId, count] of Object.entries(stats)) {
      if (gameId in result) {
        result[gameId as GameType] = count;
      }
    }

    return result;
  }

  /**
   * 获取游戏标签映射
   */
  getGameLabel(game: GameType): string {
    return GAME_LABELS[game];
  }
}

let gameCharacterService: GameCharacterService | null = null;

export function getGameCharacterService(): GameCharacterService {
  if (!gameCharacterService) {
    gameCharacterService = new GameCharacterService();
  }
  return gameCharacterService;
}
