/**
 * 主角名字提取和归一化服务
 *
 * 功能：
 * 1. 从各种格式的标题中提取主角名字
 * 2. 识别混名（如"樱井宁宁ningning"、"樱井宁宁yingjingningning"）
 * 3. 基于数据库统计确定标准名字
 * 4. 使用拼音算法进行名字相似度匹配
 *
 * 核心算法：
 * - 二元解析：将混名拆分为中文部分和拼音/英文部分
 * - 拼音归一：将各种变体转换为标准拼音进行比较
 * - 频率统计：基于数据库中出现频率确定标准名字
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 */

import pinyin from 'pinyin';
import prisma from '@/lib/db/prisma';
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';
import type { GameCharacterMatch } from '@/lib/game-characters/game-character-service';

// ============================================================
// 类型定义
// ============================================================

/** 主角名字解析结果 */
export interface ProtagonistParseResult {
  /** 提取到的原始名字 */
  rawName: string;
  /** 标准化后的名字（数据库中的标准名） */
  standardName: string;
  /** 中文部分 */
  chinesePart: string;
  /** 拼音/英文部分 */
  pinyinPart: string;
  /** 是否是混名 */
  isMixedName: boolean;
  /** 置信度（0-1） */
  confidence: number;
  /** 匹配的别名列表 */
  matchedAliases: string[];
}

/** 主角统计信息 */
export interface ProtagonistStats {
  /** 标准名字 */
  standardName: string;
  /** 出现次数 */
  count: number;
  /** 所有别名及其出现次数 */
  aliases: { name: string; count: number }[];
  /** 图库列表 */
  galleries: { id: number; title: string; coverUrl: string }[];
}

// ============================================================
// 核心服务类
// ============================================================

export class ProtagonistService {
  // ----------------------------------------------------------
  // 名字提取
  // ----------------------------------------------------------

  /**
   * 从标题中提取主角名字
   *
   * 支持的格式：
   * - "[写真] 樱井宁宁 - 纯白毛衣" → "樱井宁宁"
   * - "樱井宁宁ningning - 作品名" → "樱井宁宁" (混名)
   * - "[cosplay] 桜井宁宁 - 作品" → "桜井宁宁"
   *
   * @param title - 图库标题
   * @returns 提取到的原始名字
   */
  extractFromTitle(title: string): string {
    if (!title) return '';

    // 去除前缀标签如 [写真]、[cosplay]
    let cleaned = title.replace(/^\[[^\]]+\]\s*/, '');

    // 按分隔符分割（支持 -、—、– 等）
    const parts = cleaned.split(/\s*[-—–]\s*/);

    if (parts.length >= 2) {
      // 第一段通常为主角名
      return parts[0].trim();
    }

    // 没有分隔符时，尝试提取开头的连续中文字符
    const chineseMatch = cleaned.match(/^[\u4e00-\u9fa5]+/);
    if (chineseMatch) {
      return chineseMatch[0];
    }

    return cleaned.trim();
  }

  // ----------------------------------------------------------
  // 混名解析
  // ----------------------------------------------------------

  /**
   * 解析混名，分离中文部分和拼音/英文部分
   *
   * 示例：
   * - "樱井宁宁ningning" → { chinese: "樱井宁宁", pinyin: "ningning" }
   * - "樱井宁宁yingjingningning" → { chinese: "樱井宁宁", pinyin: "yingjingningning" }
   * - "桜井宁宁" → { chinese: "桜井宁宁", pinyin: "" }
   *
   * @param name - 原始名字
   * @returns 解析结果
   */
  parseMixedName(name: string): { chinese: string; pinyin: string; isMixed: boolean } {
    if (!name) return { chinese: '', pinyin: '', isMixed: false };

    // 匹配连续中文字符
    const chineseMatch = name.match(/^[\u4e00-\u9fa5]+/);
    const chinese = chineseMatch ? chineseMatch[0] : '';

    // 剩余部分为拼音/英文
    const pinyin = name.substring(chinese.length).trim();

    return {
      chinese,
      pinyin,
      isMixed: pinyin.length > 0,
    };
  }

  // ----------------------------------------------------------
  // 拼音归一化
  // ----------------------------------------------------------

  /**
   * 将中文名字转换为标准拼音
   *
   * @param chineseName - 中文名字
   * @returns 标准拼音（小写无空格）
   */
  toStandardPinyin(chineseName: string): string {
    if (!chineseName) return '';

    try {
      const py = pinyin(chineseName, {
        style: pinyin.STYLE_NORMAL, // 普通风格，无声调
        heteronym: false, // 不启用多音字
      });

      // 展平数组并连接
      return py.flat().join('').toLowerCase();
    } catch {
      return chineseName.toLowerCase().replace(/\s/g, '');
    }
  }

  /**
   * 计算两个名字的相似度
   *
   * 算法：
   * 1. 中文部分直接比较
   * 2. 拼音部分进行模糊匹配
   * 3. 综合计算相似度分数
   *
   * @param name1 - 名字1
   * @param name2 - 名字2
   * @returns 相似度（0-1）
   */
  calculateSimilarity(name1: string, name2: string): number {
    if (!name1 || !name2) return 0;
    if (name1 === name2) return 1;

    const parsed1 = this.parseMixedName(name1);
    const parsed2 = this.parseMixedName(name2);

    // 中文部分相似度
    let chineseSim = 0;
    if (parsed1.chinese === parsed2.chinese) {
      chineseSim = 1;
    } else {
      // 使用拼音比较中文部分
      const py1 = this.toStandardPinyin(parsed1.chinese);
      const py2 = this.toStandardPinyin(parsed2.chinese);
      chineseSim = this.levenshteinSimilarity(py1, py2);
    }

    // 拼音部分相似度
    let pinyinSim = 0;
    if (!parsed1.pinyin && !parsed2.pinyin) {
      pinyinSim = 1; // 都没有拼音部分
    } else if (parsed1.pinyin && parsed2.pinyin) {
      pinyinSim = this.levenshteinSimilarity(
        parsed1.pinyin.toLowerCase(),
        parsed2.pinyin.toLowerCase()
      );
    } else {
      // 一个有拼音一个没拼音，比较中文部分的拼音和带拼音的部分
      const pyChinese = this.toStandardPinyin(parsed1.chinese || parsed2.chinese);
      const pyMixed = (parsed1.pinyin || parsed2.pinyin).toLowerCase();
      pinyinSim = pyMixed.includes(pyChinese) || pyChinese.includes(pyMixed) ? 0.8 : 0;
    }

    // 综合相似度：中文部分权重更高
    return chineseSim * 0.7 + pinyinSim * 0.3;
  }

  /**
   * 计算 Levenshtein 编辑距离相似度
   *
   * @param str1 - 字符串1
   * @param str2 - 字符串2
   * @returns 相似度（0-1）
   */
  private levenshteinSimilarity(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0 && len2 === 0) return 1;
    if (len1 === 0 || len2 === 0) return 0;

    const distance = this.levenshteinDistance(str1, str2);
    const maxLen = Math.max(len1, len2);

    return 1 - distance / maxLen;
  }

  /**
   * 计算 Levenshtein 编辑距离
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str1.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // 删除
          matrix[i][j - 1] + 1, // 插入
          matrix[i - 1][j - 1] + cost // 替换
        );
      }
    }

    return matrix[str1.length][str2.length];
  }

  // ----------------------------------------------------------
  // 数据库统计和归一化
  // ----------------------------------------------------------

  /**
   * 基于数据库统计确定标准名字
   *
   * 策略：
   * 1. 查询数据库中所有相似的主角名
   * 2. 统计每个名字的出现频率
   * 3. 返回出现次数最多的名字作为标准名
   *
   * @param rawName - 原始提取的名字
   * @returns 标准化结果
   */
  async normalizeFromDatabase(rawName: string): Promise<ProtagonistParseResult> {
    if (!rawName) {
      return {
        rawName: '',
        standardName: '',
        chinesePart: '',
        pinyinPart: '',
        isMixedName: false,
        confidence: 0,
        matchedAliases: [],
      };
    }

    const parsed = this.parseMixedName(rawName);
    const chinesePinyin = this.toStandardPinyin(parsed.chinese);

    // 查询数据库中所有主角名
    const allGalleries = await prisma.gallery.findMany({
      where: { protagonist: { not: '' } },
      select: { protagonist: true },
      distinct: ['protagonist'],
    });

    const allNames = allGalleries.map((g) => g.protagonist);

    // 找出相似的名字（相似度 > 0.6）
    const similarNames: { name: string; similarity: number }[] = [];
    for (const name of allNames) {
      const sim = this.calculateSimilarity(rawName, name);
      if (sim > 0.6) {
        similarNames.push({ name, similarity: sim });
      }
    }

    // 按相似度排序
    similarNames.sort((a, b) => b.similarity - a.similarity);

    // 统计每个名字的出现次数
    const nameCounts: { [key: string]: number } = {};
    for (const { name } of similarNames) {
      const count = await prisma.gallery.count({
        where: { protagonist: name },
      });
      nameCounts[name] = count;
    }

    // 选择标准名字：优先出现次数最多的，其次相似度最高的
    let standardName = rawName;
    let maxCount = 0;

    for (const { name, similarity } of similarNames) {
      const count = nameCounts[name];
      if (count > maxCount) {
        maxCount = count;
        standardName = name;
      }
    }

    // 如果没有找到相似的，使用当前解析的中文部分
    if (similarNames.length === 0) {
      standardName = parsed.chinese || rawName;
    }

    return {
      rawName,
      standardName,
      chinesePart: parsed.chinese,
      pinyinPart: parsed.pinyin,
      isMixedName: parsed.isMixed,
      confidence: similarNames.length > 0 ? similarNames[0].similarity : 1,
      matchedAliases: similarNames.map((s) => s.name),
    };
  }

  /**
   * 获取主角的完整统计信息
   *
   * @param standardName - 标准名字
   * @returns 统计信息
   */
  async getProtagonistStats(standardName: string): Promise<ProtagonistStats | null> {
    if (!standardName) return null;

    // 查询该主角的所有图库
    const galleries = await prisma.gallery.findMany({
      where: { protagonist: standardName },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        coverUrl: true,
      },
    });

    if (galleries.length === 0) return null;

    // 查询所有相似的名字作为别名
    const allGalleries = await prisma.gallery.findMany({
      where: { protagonist: { not: '' } },
      select: { protagonist: true },
    });

    const aliasCounts: { [key: string]: number } = {};
    for (const g of allGalleries) {
      const sim = this.calculateSimilarity(standardName, g.protagonist);
      if (sim > 0.6 && g.protagonist !== standardName) {
        aliasCounts[g.protagonist] = (aliasCounts[g.protagonist] || 0) + 1;
      }
    }

    const aliases = Object.entries(aliasCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return {
      standardName,
      count: galleries.length,
      aliases,
      galleries: galleries.map((g) => ({
        id: g.id,
        title: g.title,
        coverUrl: g.coverUrl,
      })),
    };
  }

  /**
   * 获取所有主角列表（用于展示架）
   *
   * @returns 主角列表及其图库数量
   */
  async getAllProtagonists(): Promise<{ name: string; count: number; coverUrl: string }[]> {
    const result = await prisma.gallery.groupBy({
      by: ['protagonist'],
      where: { protagonist: { not: '' } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    // 获取每个主角的最新封面图
    const protagonists = [];
    for (const item of result) {
      const latest = await prisma.gallery.findFirst({
        where: { protagonist: item.protagonist },
        orderBy: { createdAt: 'desc' },
        select: { coverUrl: true },
      });

      protagonists.push({
        name: item.protagonist,
        count: item._count.id,
        coverUrl: latest?.coverUrl || '',
      });
    }

    return protagonists;
  }

  // ----------------------------------------------------------
  // 游戏角色识别
  // ----------------------------------------------------------

  /**
   * 在 TAG 列表中识别游戏角色名
   *
   * 调用 GameCharacterService 进行三级匹配：
   * 1. 精确匹配中文名
   * 2. 别名匹配（英文/罗马音）
   * 3. 拼音模糊匹配
   *
   * @param tags - 图包的 TAG 列表
   * @returns 匹配到的游戏角色名列表
   * @date 2026-07-11
   */
  identifyGameCharacters(tags: string[]): string[] {
    const service = getGameCharacterService();
    const matches = service.identifyInTags(tags);
    return matches.map((m) => m.character.name);
  }

  /**
   * 在 TAG 列表中识别游戏角色（含详细匹配信息）
   *
   * @param tags - 图包的 TAG 列表
   * @returns 匹配结果详情列表
   * @date 2026-07-11
   */
  identifyGameCharactersDetailed(tags: string[]): GameCharacterMatch[] {
    return getGameCharacterService().identifyInTags(tags);
  }

  /**
   * 检查指定名字是否为已知游戏角色
   *
   * @param name - 待检查的名字
   * @returns 是否为游戏角色
   * @date 2026-07-11
   */
  isGameCharacter(name: string): boolean {
    return getGameCharacterService().getCharacter(name) !== null;
  }
}

// ============================================================
// 单例导出
// ============================================================

let protagonistService: ProtagonistService | null = null;

export function getProtagonistService(): ProtagonistService {
  if (!protagonistService) {
    protagonistService = new ProtagonistService();
  }
  return protagonistService;
}
