/**
 * 游戏角色识别服务
 *
 * 在图包站的 TAG 列表或标题文本中识别游戏角色名。
 * 支持三种匹配模式：
 * 1. 精确匹配 — 中文名完全一致
 * 2. 别名匹配 — 英文名/罗马音完全一致
 * 3. 拼音模糊匹配 — 中文名的拼音变体匹配
 *
 * 主要被 AimeiziziProvider 调用，用于在爬取图包时识别
 * TAG 中是否包含原神、星穹铁道、鸣潮、碧蓝航线、碧蓝档案的游戏角色名。
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

import pinyin from 'pinyin';
import {
  ALL_GAME_CHARACTERS,
  GAME_LABELS,
  type GameCharacter,
  type GameType,
} from './character-data';

// ============================================================
// 类型定义
// ============================================================

export interface GameCharacterMatch {
  character: GameCharacter;
  matchedText: string;
  matchType: 'exact' | 'alias' | 'pinyin';
  confidence: number;
}

// ============================================================
// 服务实现
// ============================================================

export class GameCharacterService {
  private readonly exactIndex = new Map<string, GameCharacter>();
  private readonly aliasIndex = new Map<string, GameCharacter>();
  private readonly pinyinIndex = new Map<string, GameCharacter>();
  private readonly allCharacters: GameCharacter[];

  constructor() {
    this.allCharacters = ALL_GAME_CHARACTERS;
    this.buildIndexes();
  }

  /**
   * 构建查找索引
   *
   * 三级索引：
   * - exactIndex: 中文名小写 → 角色
   * - aliasIndex: 英文/罗马音别名小写 → 角色
   * - pinyinIndex: 中文名拼音（无声调）→ 角色
   */
  private buildIndexes(): void {
    for (const char of this.allCharacters) {
      this.exactIndex.set(char.name.toLowerCase(), char);

      if (char.aliases) {
        for (const alias of char.aliases) {
          this.aliasIndex.set(alias.toLowerCase(), char);
        }
      }

      const py = this.toPinyin(char.name);
      if (py && py !== char.name.toLowerCase()) {
        this.pinyinIndex.set(py, char);
      }
    }
  }

  /**
   * 将中文名转为拼音（无声调，小写，无空格）
   */
  private toPinyin(text: string): string {
    try {
      const py = pinyin(text, {
        style: pinyin.STYLE_NORMAL,
        heteronym: false,
      });
      return py.flat().join('').toLowerCase();
    } catch {
      return text.toLowerCase().replace(/\s/g, '');
    }
  }

  /**
   * 在 TAG 列表中识别游戏角色
   *
   * @param tags - 图包的 TAG 列表
   * @returns 匹配结果列表（去重）
   */
  identifyInTags(tags: string[]): GameCharacterMatch[] {
    const results: GameCharacterMatch[] = [];
    const seen = new Set<string>();

    for (const tag of tags) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized || normalized.length < 1) continue;

      // 精确匹配
      const exact = this.exactIndex.get(normalized);
      if (exact) {
        const key = `${exact.game}:${exact.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: exact,
            matchedText: tag,
            matchType: 'exact',
            confidence: 1.0,
          });
        }
        continue;
      }

      // 别名匹配
      const alias = this.aliasIndex.get(normalized);
      if (alias) {
        const key = `${alias.game}:${alias.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: alias,
            matchedText: tag,
            matchType: 'alias',
            confidence: 0.95,
          });
        }
        continue;
      }

      // 拼音匹配
      const tagPinyin = this.toPinyin(tag.trim());
      const pinyinMatch = this.pinyinIndex.get(tagPinyin);
      if (pinyinMatch) {
        const key = `${pinyinMatch.game}:${pinyinMatch.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: pinyinMatch,
            matchedText: tag,
            matchType: 'pinyin',
            confidence: 0.85,
          });
        }
      }
    }

    return results;
  }

  /**
   * 在文本中识别游戏角色名
   *
   * 遍历所有角色名，检查是否作为子串出现在文本中。
   *
   * @param text - 待检测文本（如标题）
   * @returns 匹配结果列表
   */
  identifyInText(text: string): GameCharacterMatch[] {
    if (!text) return [];

    const results: GameCharacterMatch[] = [];
    const seen = new Set<string>();

    for (const char of this.allCharacters) {
      if (text.includes(char.name)) {
        const key = `${char.game}:${char.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            character: char,
            matchedText: char.name,
            matchType: 'exact',
            confidence: 1.0,
          });
        }
        continue;
      }

      if (char.aliases) {
        for (const alias of char.aliases) {
          if (alias.length >= 3 && text.toLowerCase().includes(alias.toLowerCase())) {
            const key = `${char.game}:${char.name}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                character: char,
                matchedText: alias,
                matchType: 'alias',
                confidence: 0.9,
              });
            }
            break;
          }
        }
      }
    }

    return results;
  }

  /**
   * 按名称精确查找角色
   */
  getCharacter(name: string): GameCharacter | null {
    const normalized = name.trim().toLowerCase();
    return this.exactIndex.get(normalized) || this.aliasIndex.get(normalized) || null;
  }

  /**
   * 获取指定游戏的全部角色
   */
  getCharactersByGame(game: GameType): GameCharacter[] {
    return this.allCharacters.filter((c) => c.game === game);
  }

  /**
   * 获取全部角色
   */
  getAllCharacters(): GameCharacter[] {
    return this.allCharacters;
  }

  /**
   * 获取角色总数统计
   */
  getStats(): Record<GameType, number> {
    const stats: Record<GameType, number> = {
      genshin: 0,
      starrail: 0,
      wuthering: 0,
      azurlane: 0,
      bluearchive: 0,
    };
    for (const char of this.allCharacters) {
      stats[char.game]++;
    }
    return stats;
  }

  /**
   * 获取游戏标签映射
   */
  getGameLabel(game: GameType): string {
    return GAME_LABELS[game];
  }
}

// ============================================================
// 单例导出
// ============================================================

let gameCharacterService: GameCharacterService | null = null;

export function getGameCharacterService(): GameCharacterService {
  if (!gameCharacterService) {
    gameCharacterService = new GameCharacterService();
  }
  return gameCharacterService;
}
