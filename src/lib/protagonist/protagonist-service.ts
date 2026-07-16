import { pinyin as pinyinPro } from 'pinyin-pro';
import prisma from '@/lib/db/prisma';
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';
import type { GameCharacterMatch } from '@/lib/game-characters/game-character-service';
import { logT } from '@/lib/i18n/server';

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

/** Person 缓存条目 */
interface PersonCacheEntry {
  name: string;
  pinyin: string;
  aliases: string[];
  galleryCount: number;
  source: string; // 'auto' | 'manual' | 'game_character'
}

export class ProtagonistService {
  /** Person 数据库缓存（name → entry） */
  private personCache: Map<string, PersonCacheEntry> = new Map();
  /** 拼音 → Person 缓存（pinyin → entry），用于模糊匹配 */
  private pinyinCache: Map<string, PersonCacheEntry> = new Map();
  /** 缓存是否已初始化 */
  private cacheInitialized = false;
  /** 缓存初始化锁 */
  private cacheInitPromise: Promise<void> | null = null;

  toStandardPinyin(chineseName: string): string {
    if (!chineseName) return '';

    try {
      // pinyin-pro 返回带声调的拼音，需要去除声调
      const py = pinyinPro(chineseName, {
        toneType: 'none',
        type: 'array',
        nonZh: 'consecutive',
      });
      return (py as string[]).join('').toLowerCase();
    } catch {
      return chineseName.toLowerCase().replace(/\s/g, '');
    }
  }

  private getBigrams(str: string): Set<string> {
    const bigrams = new Set<string>();
    if (str.length < 2) {
      if (str.length > 0) bigrams.add(str);
      return bigrams;
    }
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  }

  /**
   * 计算 Dice 系数相似度（基于二元组集合）
   *
   * Dice = 2 × |A ∩ B| / (|A| + |B|)
   *
   * 范围 [0, 1]，1 表示完全相同。
   * 对短字符串（2-4 字）比 Levenshtein 更鲁棒，
   * 因为它衡量的是字符组合的共享比例而非编辑操作数。
   *
   * @param str1 - 字符串1
   * @param str2 - 字符串2
   * @returns 相似度（0-1）
   */
  bigramDiceSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const bigrams1 = this.getBigrams(str1);
    const bigrams2 = this.getBigrams(str2);

    if (bigrams1.size === 0 && bigrams2.size === 0) return 1;
    if (bigrams1.size === 0 || bigrams2.size === 0) return 0;

    let intersection = 0;
    for (const bg of bigrams1) {
      if (bigrams2.has(bg)) intersection++;
    }

    return (2 * intersection) / (bigrams1.size + bigrams2.size);
  }

    /**
   * 计算两个名字的综合相似度
   *
   * 算法：
   - 字面 Dice 相似度（权重 0.4）
   - 拼音 Dice 相似度（权重 0.6）
   *
   * 拼音权重更高，因为 "樱井宁宁" 和 "桜井宁宁"
   * 字面只有 1 字不同，但拼音完全一致。
   *
   * @param name1 - 名字1
   * @param name2 - 名字2
   * @returns 相似度（0-1）
   */
  calculateSimilarity(name1: string, name2: string): number {
    if (!name1 || !name2) return 0;
    if (name1 === name2) return 1;

    // 字面 Dice 相似度
    const literalSim = this.bigramDiceSimilarity(name1, name2);

    // 拼音 Dice 相似度
    const py1 = this.toStandardPinyin(name1);
    const py2 = this.toStandardPinyin(name2);
    const pinyinSim = this.bigramDiceSimilarity(py1, py2);

    // 综合：拼音权重 0.6 + 字面权重 0.4
    return pinyinSim * 0.6 + literalSim * 0.4;
  }

  /**
   * 解析混名，分离中文部分和拼音/英文部分
   *
   * 示例：
   * - "樱井宁宁ningning" → { chinese: "樱井宁宁", pinyin: "ningning", isMixed: true }
   * - "桜井宁宁" → { chinese: "桜井宁宁", pinyin: "", isMixed: false }
   *
   * @param name - 原始名字
   * @returns 解析结果
   */
  parseMixedName(name: string): { chinese: string; pinyin: string; isMixed: boolean } {
    if (!name) return { chinese: '', pinyin: '', isMixed: false };

    // 匹配连续中文字符（含日文汉字范围）
    const chineseMatch = name.match(/^[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/);
    const chinese = chineseMatch ? chineseMatch[0] : '';

    // 剩余部分为拼音/英文
    const pinyin = name.substring(chinese.length).trim();

    return {
      chinese,
      pinyin,
      isMixed: pinyin.length > 0,
    };
  }

  /**
   * 从标题中提取主角名字（旧版简单提取，保留兼容）
   *
   * @deprecated 使用 extractFromTitleSmart 替代
   * @param title - 图库标题
   * @returns 提取到的原始名字
   */
  extractFromTitle(title: string): string {
    if (!title) return '';

    const cleaned = title.replace(/^\[[^\]]+\]\s*/, '');
    const parts = cleaned.split(/\s*[-—–]\s*/);

    if (parts.length >= 2) {
      return parts[0].trim();
    }

    const chineseMatch = cleaned.match(/^[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/);
    if (chineseMatch) {
      return chineseMatch[0];
    }

    return cleaned.trim();
  }

  /**
   * 初始化 Person 数据库缓存
   *
   * 将所有 Person 记录加载到内存，
   * 避免每次解析都查库。
   */
  private async ensureCacheInitialized(): Promise<void> {
    if (this.cacheInitialized) return;

    // 防止并发初始化
    if (this.cacheInitPromise) {
      await this.cacheInitPromise;
      return;
    }

    this.cacheInitPromise = this.initializeCache();
    await this.cacheInitPromise;
  }

  /**
   * 从数据库加载全部 Person 到缓存
   */
  private async initializeCache(): Promise<void> {
    try {
      const persons = await prisma.person.findMany();
      this.personCache.clear();
      this.pinyinCache.clear();

      for (const p of persons) {
        let aliases: string[] = [];
        try {
          aliases = JSON.parse(p.aliases);
        } catch {
          aliases = [];
        }
        const entry: PersonCacheEntry = {
          name: p.name,
          pinyin: p.pinyin,
          aliases,
          galleryCount: p.galleryCount,
          source: p.source || 'auto',
        };
        this.personCache.set(p.name.toLowerCase(), entry);
        if (p.pinyin) {
          this.pinyinCache.set(p.pinyin, entry);
        }
      }

      this.cacheInitialized = true;
    } catch (err) {
      console.warn(logT('log.protagonist.personCacheInitFailed'), err);
      this.cacheInitialized = true; // 标记已尝试，避免重复失败
    }
  }

  /**
   * 刷新缓存（外部修改 Person 表后调用）
   */
  async refreshCache(): Promise<void> {
    this.cacheInitialized = false;
    this.cacheInitPromise = null;
    await this.ensureCacheInitialized();
  }

    /**
   * 在文本中查找已知的 Person 名（子串匹配）
   *
   * 遍历 Person 缓存，检查每个 Person 名是否作为子串出现在文本中。
   * 优先匹配名字最长的（避免 "宁宁" 匹配 "樱井宁宁" 时只取部分）。
   *
   * @param text - 待检测文本（如标题）
   * @returns 匹配到的 Person 名，未匹配返回 null
   */
  /**
   * 在文本中查找已知的 Person 名（子串匹配）
   *
   * 遍历 Person 缓存，检查每个 Person 名是否作为子串出现在文本中。
   * 优先匹配名字最长的（避免 "宁宁" 匹配 "樱井宁宁" 时只取部分）。
   *
   * @param text - 待检测文本（如标题）
   * @param excludeGameCharacters - 是否排除 source=game_character 的记录（默认 true）
   *   主角提取时必须排除游戏角色，因为游戏角色不是真实出镜者
   * @returns 匹配到的 Person 名，未匹配返回 null
   */
  matchKnownPerson(text: string, excludeGameCharacters: boolean = true): string | null {
    if (!text) return null;

    const lowerText = text.toLowerCase();
    let bestMatch: string | null = null;
    let bestLen = 0;

    for (const [nameLower, entry] of this.personCache) {
      // 排除游戏角色（游戏角色不是真实出镜者）
      if (excludeGameCharacters && entry.source === 'game_character') continue;

      // 检查标准名
      if (lowerText.includes(nameLower)) {
        if (entry.name.length > bestLen) {
          bestMatch = entry.name;
          bestLen = entry.name.length;
        }
        continue;
      }
      // 检查别名
      for (const alias of entry.aliases) {
        if (alias.length >= 2 && lowerText.includes(alias.toLowerCase())) {
          if (entry.name.length > bestLen) {
            bestMatch = entry.name;
            bestLen = entry.name.length;
          }
          break;
        }
      }
    }

    return bestMatch;
  }

  /**
   * 通过拼音模糊匹配 Person DB
   *
   * 将候选名转为拼音，与缓存中的拼音比较 Dice 相似度。
   *
   * @param name - 候选名
   * @param threshold - 相似度阈值（默认 0.8）
   * @returns 匹配到的标准名，未匹配返回 null
   */
  /**
   * 通过拼音模糊匹配 Person DB
   *
   * 将候选名转为拼音，与缓存中的拼音比较 Dice 相似度。
   *
   * @param name - 候选名
   * @param threshold - 相似度阈值（默认 0.8）
   * @param excludeGameCharacters - 是否排除 source=game_character 的记录（默认 true）
   * @returns 匹配到的标准名，未匹配返回 null
   */
  fuzzyMatchPerson(name: string, threshold: number = 0.8, excludeGameCharacters: boolean = true): string | null {
    if (!name) return null;

    const namePinyin = this.toStandardPinyin(name);
    if (!namePinyin) return null;

    let bestMatch: string | null = null;
    let bestSim = threshold;

    for (const [py, entry] of this.pinyinCache) {
      if (excludeGameCharacters && entry.source === 'game_character') continue;
      const sim = this.bigramDiceSimilarity(namePinyin, py);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = entry.name;
      }
    }

    return bestMatch;
  }

  /**
   * 在文本中识别游戏角色名（子串匹配）
   *
   * 调用 GameCharacterService.identifyInText，
   * 检查标题中是否包含已知游戏角色名。
   *
   * @param text - 待检测文本（如标题）
   * @returns 匹配到的游戏角色名，未匹配返回 null
   */
  async matchGameCharacterInText(text: string): Promise<string | null> {
    if (!text) return null;
    const matches = await getGameCharacterService().identifyInText(text);
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.character.name.length - a.character.name.length);
    return matches[0].character.name;
  }

  /**
   * 从标题中智能提取主角名（7 级策略）
   *
   * 策略优先级（从高到低）：
   - TAG 中的人物名匹配 — TAG 是最可靠的人物标识来源
   - Person DB 已知人物子串匹配 — 标题中包含已知人物名
   - 游戏角色库 identifyInText 子串匹配 — 标题中包含游戏角色名
   - 『』【】括号内容解析 — 括号内按 - 分割逐段检查
   - 标准 "名字 - 描述" 格式 + 交叉验证 — 括号外分割
   - 标签起始匹配 — 标题以某个 tag 开头
   - 均不匹配返回空字符串
   *
   * 关键修复：
   * - 新增策略 0：优先从 TAG 中识别人物名（TAG 是最可靠的来源）
   * - 改进策略 2：当识别到游戏角色时，强制尝试提取前面的 Cosplayer 名
   * - 改进策略 4：正确处理 [分类] 前缀（如 [cosplay]、[私房]）
   *
   * @param title - 图库标题（已清洗）
   * @param tags - 标签列表
   * @returns 提取到的主角名，无法确定返回空字符串
   */
  async extractFromTitleSmart(title: string, tags: string[] = []): Promise<string> {
    if (!title) return '';

    // 确保 Person 缓存已初始化
    await this.ensureCacheInitialized();

    // 预处理：清洗标题（去除 [分类] 前缀）
    const cleanedTitle = this.cleanTitlePrefix(title);

    // 策略 0：从 TAG 中识别人物名（最可靠）
    const personFromTags = await this.extractPersonFromTags(cleanedTitle, tags);
    if (personFromTags) {
      return personFromTags;
    }

    // 策略 1：Person DB 已知人物子串匹配
    const knownPerson = this.matchKnownPerson(cleanedTitle);
    if (knownPerson) {
      return knownPerson;
    }

    // 策略 1.5：AI 生成内容检查（在检查游戏角色之前）
    // AI 生成内容通常没有真实 Cosplayer，直接返回空字符串
    if (this.isAIGenerated(cleanedTitle)) {
      return '';
    }

    // 策略 2：游戏角色库 identifyInText 子串匹配
    const gameChar = await this.matchGameCharacterInText(cleanedTitle);
    if (gameChar) {
      // 关键修复：强制尝试提取游戏角色前面的 Cosplayer 名
      // 对于 "Cosplayer - 游戏作品 游戏角色" 格式，Cosplayer 才是真正的主角
      const cosplayerFromSeparator = this.extractCosplayerBeforeGameChar(cleanedTitle, gameChar);
      if (cosplayerFromSeparator) {
        return cosplayerFromSeparator;
      }
      // 如果没有提取到 Cosplayer，返回空字符串（游戏角色不是主角）
      return '';
    }

    // 策略 3：『』【】括号内容解析
    const bracketResult = await this.extractFromBrackets(cleanedTitle);
    if (bracketResult) {
      return bracketResult;
    }

    // 策略 4：标准 "名字 - 描述" 格式 + 交叉验证
    const standardResult = await this.extractStandardFormat(cleanedTitle, tags);
    if (standardResult) {
      return standardResult;
    }

    // 策略 5：标签起始匹配
    for (const tag of tags) {
      if (tag.length > 1 && tag.length < 20 && cleanedTitle.startsWith(tag)) {
        return tag;
      }
    }

    // 策略 6：均不匹配，返回空字符串
    return '';
  }

  /**
   * 清洗标题前缀
   *
   * 去除 [cosplay]、[私房]、[模特] 等分类前缀
   *
   * @param title - 原始标题
   * @returns 清洗后的标题
   */
  private cleanTitlePrefix(title: string): string {
    if (!title) return '';
    // 去除 [xxx] 前缀（如 [cosplay]、[私房]、[模特]）
    return title.replace(/^\[[^\]]+\]\s*/i, '').trim();
  }

  /**
   * 判断是否为 AI 生成内容
   *
   * @param title - 标题
   * @returns 是否为 AI 生成
   */
  private isAIGenerated(title: string): boolean {
    if (!title) return false;
    const lower = title.toLowerCase();
    return lower.includes('ai porn') ||
           lower.includes('ai nudes') ||
           lower.includes('ai 生成') ||
           lower.includes('ai生成') ||
           lower.includes('ai美女') ||
           lower.includes('ai 美女');
  }

  /**
   * 从 TAG 列表中提取人物名
   *
   * 策略：检查 TAG 是否在标题开头出现，然后检查是否为 Person DB 已知人物，最后进行启发式人名验证。
   *
   * @param title - 清洗后的标题
   * @param tags - TAG 列表
   * @returns 提取到的人物名，未匹配返回 null
   */
  private async extractPersonFromTags(title: string, tags: string[]): Promise<string | null> {
    if (!tags || tags.length === 0) return null;

    // 过滤掉常见非人物 TAG
    const nonPersonTags = new Set([
      '标签', 'cosplay', '大尺度', '美腿', '美胸', '真人写真', '视频',
      '巨乳', '丝袜', '蕾丝', '高跟鞋', '婚纱', '兔女郎', '私房写真',
      '黑丝', '全裸', '露穴', '口交', '交合', '室内', '床拍', '古风',
      '古装', '校服', '白丝', '黑发', '红裙', '湖畔', '浴室', '湿身',
      '内衣', '美RU', '御姐', '私拍', '福利', '极品', '女神', '少女',
      '粉嫩', '美穴', '鲍鱼', '美鲍', '小仙女', '福利姬', 'R18',
      '模特写真', '内购无水印', '秀人网', 'AI美女', 'AI Generated',
      '吞噬星空', '剑来', '凡人修仙传', '电锯人', '葬送的芙莉莲',
      '火影忍者', '漩涡鸣人', '芙莉莲',
    ]);

    // 优先检查：TAG 在标题开头出现（或标题以 TAG 的括号别名开头）
    for (const tag of tags) {
      if (nonPersonTags.has(tag)) continue;
      if (tag.length < 2 || tag.length > 20) continue;
      // 跳过游戏角色 TAG（游戏角色不是真实出镜者）
      if (await this.isGameCharacter(tag)) continue;

      // 检查 TAG 是否在标题开头
      if (title.startsWith(tag)) {
        // 验证是否看起来像人名
        if (this.looksLikePersonName(tag)) {
          return tag;
        }
      }

      // 检查标题是否以 "英文名(中文名)" 格式开头，且中文名匹配 TAG
      // 例如："Irisuare(愛莉) - ..." 且 TAG 中有 "愛莉"
      const parenMatch = title.match(/^([a-zA-Z0-9]+)\s*\(([^)]+)\)/);
      if (parenMatch) {
        const englishName = parenMatch[1];
        const chineseName = parenMatch[2];
        if (chineseName === tag && this.looksLikePersonName(englishName)) {
          return englishName;
        }
      }
    }

    // 其次检查：TAG 是 Person DB 中已知的人物（排除游戏角色）
    for (const tag of tags) {
      if (nonPersonTags.has(tag)) continue;
      // 跳过游戏角色 TAG
      if (await this.isGameCharacter(tag)) continue;
      const knownPerson = this.matchKnownPerson(tag);
      if (knownPerson) {
        return knownPerson;
      }
    }

    // 最后检查：TAG 看起来像人名，且出现在标题分隔符前的第一段
    // 关键修复：对于 "Cosplayer - 游戏角色" 格式，只有分隔符前的 TAG 才是 Cosplayer
    // 分隔符后的 TAG 是角色名/描述词，不应作为主角返回
    for (const tag of tags) {
      if (nonPersonTags.has(tag)) continue;
      if (tag.length < 2 || tag.length > 20) continue;
      // 跳过游戏角色 TAG
      if (await this.isGameCharacter(tag)) continue;

      if (this.looksLikePersonName(tag)) {
        // 检查 TAG 是否出现在标题第一段（分隔符前）
        if (this.isTagInFirstSegment(title, tag)) {
          return tag;
        }
      }
    }

    return null;
  }

  /**
   * 检查 TAG 是否出现在标题第一段（分隔符前）
   *
   * 对于 "Cosplayer - 游戏角色" 格式的标题，
   * 分隔符（-、—、–）前的是 Cosplayer 段，
   * 分隔符后的是角色/描述段。
   *
   * 此辅助函数用于过滤掉只在第二段出现的 TAG（角色名），
   * 只保留第一段中的 TAG（Cosplayer 名）。
   *
   * @param title - 清洗后的标题
   * @param tag - 待检查的 TAG
   * @returns TAG 是否出现在第一段中
   */
  private isTagInFirstSegment(title: string, tag: string): boolean {
    // 找到第一个分隔符位置
    const separatorMatch = title.match(/^(.+?)\s*[-—–]\s*/);
    if (!separatorMatch) {
      // 无分隔符，整个标题就是第一段
      return title.includes(tag);
    }
    const firstSegment = separatorMatch[1];
    return firstSegment.includes(tag);
  }

  /**
   * 从 "Cosplayer - 游戏角色" 模式标题中提取真正的 Cosplayer 名
   *
   * 处理如下标题格式：
   * - "西园寺南歌 - 碧蓝航线 莫加多尔护士：粉发护士装 白丝美腿 23P"
   *   → 游戏角色 "莫加多尔" 在 "-" 后面，前面 "西园寺南歌" 是 Cosplayer
   * - "鱼子酱Fish（私拍）- 山青涩"
   *   → "-" 前面 "鱼子酱Fish" 是 Cosplayer
   *
   * 算法：找到游戏角色名在标题中的位置，检查该位置之前是否有分隔符（-、—、–），如果有则取分隔符前面的文本段作为候选，清洗候选（去除尾部括号内容），验证候选是否为有效人名（已知人物或启发式验证）。
   *
   * @param title - 标题文本
   * @param gameCharName - 已识别的游戏角色名
   * @returns 提取到的 Cosplayer 名，未提取到返回 null
   */
  private extractCosplayerBeforeGameChar(title: string, gameCharName: string): string | null {
    const charIndex = title.indexOf(gameCharName);
    if (charIndex <= 0) return null;

    // 取游戏角色前面的文本
    const beforeChar = title.substring(0, charIndex).trim();
    if (beforeChar.length === 0) return null;

    // 查找最后一个分隔符（-、—、–、：）位置
    // 使用非贪婪匹配，找到第一个分隔符即可
    const separatorMatch = beforeChar.match(/^(.+?)\s*[-—–:：]\s*/);
    if (!separatorMatch) {
      // 如果没有分隔符，检查整个 beforeChar 是否像人名
      const candidate = beforeChar.replace(/[（(][^）)]*[）)]$/, '').trim();
      if (candidate.length >= 2 && candidate.length <= 25) {
        // 宽松验证：只要不像明显的非人名即可
        if (this.isLikelyPersonName(candidate)) {
          return candidate;
        }
      }
      return null;
    }

    let candidate = separatorMatch[1].trim();

    // 清洗：去除尾部括号内容（如 "鱼子酱Fish（私拍）" → "鱼子酱Fish"）
    candidate = candidate.replace(/[（(][^）)]*[）)]$/, '').trim();

    // 去除尾部非名字字符
    candidate = candidate.replace(/^[\s\-—–:：]+|[\s\-—–:：]+$/g, '');

    // 长度检查
    if (candidate.length < 2 || candidate.length > 25) return null;

    // 验证候选是否为已知人物
    const knownPerson = this.matchKnownPerson(candidate);
    if (knownPerson) return knownPerson;

    // 拼音模糊匹配
    const fuzzyMatch = this.fuzzyMatchPerson(candidate);
    if (fuzzyMatch) return fuzzyMatch;

    // 宽松验证：只要不像明显的非人名即可接受
    if (this.isLikelyPersonName(candidate)) {
      return candidate;
    }

    return null;
  }

  /**
   * 宽松判断字符串是否可能是人名
   *
   * 与 looksLikePersonName 不同，此方法更宽松，
   * 用于 Cosplayer 提取场景，只要不像明显的非人名即可。
   *
   * 规则：
   * - 长度 2-25 字符
   * - 不以明显的非名字标记开头（如 "作品"、"合集" 等）
   * - 不包含明显的非名字关键词
   *
   * @param text - 待检查的字符串
   * @returns 是否可能是人名
   */
  private isLikelyPersonName(text: string): boolean {
    if (!text) return false;

    const trimmed = text.trim();

    // 长度检查
    if (trimmed.length < 2 || trimmed.length > 25) return false;

    // 明显的非名字标记（开头）
    const nonNamePrefixes = [
      '作品', '合集', '月', '日', '年', '季度', '期', ' vol',
      '打赏', '资源', '小剧场', '预告', '整理', '篇',
      '图包', '套图', '系列', '完整', '修正', '重制', 'AI ', 'AI',
    ];
    for (const prefix of nonNamePrefixes) {
      if (trimmed.startsWith(prefix)) return false;
    }

    // 明显的非名字关键词（包含）
    const nonNameKeywords = [
      'Porn', 'Nudes', 'Generated', '写真合集', '福利姬',
    ];
    for (const keyword of nonNameKeywords) {
      if (trimmed.toLowerCase().includes(keyword.toLowerCase())) return false;
    }

    // 检查是否以中文、日文或英文字母开头
    if (!/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffa-zA-Z]/.test(trimmed[0])) {
      return false;
    }

    return true;
  }

  /**
   * 策略 3：从括号内容中提取人物名
   *
   * 处理 『xxx-yyy』 或 【xxx-yyy】 格式：
   - 提取括号内容
   - 按 - 分割
   - 逐段检查是否为已知人物/游戏角色/看起来像人名
   *
   * 例如 "4月作品『申鹤-明枪』73P" → 括号内容 "申鹤-明枪"
   * → 分割为 ["申鹤", "明枪"] → "申鹤" 匹配游戏角色 → 返回 "申鹤"
   *
   * @param title - 标题
   * @returns 匹配到的人名，未匹配返回 null
   */
  private async extractFromBrackets(title: string): Promise<string | null> {
    // 匹配 『...』 或 【...】 或 「...」 中的内容
    const bracketMatch = title.match(/[『「【\[]([^」」】\]]+)[」】\]]/);
    if (!bracketMatch) return null;

    const bracketContent = bracketMatch[1];
    const segments = bracketContent.split(/\s*[-—–]\s*/);

    for (const seg of segments) {
      const candidate = seg.trim();
      if (!candidate || candidate.length < 2 || candidate.length > 20) continue;

      // 检查是否为已知 Person
      const person = this.matchKnownPerson(candidate);
      if (person) return person;

      // 检查是否为已知游戏角色 — 游戏角色不是主角，跳过
      if (await this.isGameCharacter(candidate)) continue;

      // 拼音模糊匹配 Person DB
      const fuzzyMatch = this.fuzzyMatchPerson(candidate);
      if (fuzzyMatch) return fuzzyMatch;

      // 启发式检查：看起来像人名
      if (this.looksLikePersonName(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * 策略 4：标准 "名字 - 描述" 格式提取
   *
   * 规则：
   - 按分隔符分割标题
   - 取第一段作为候选
   - 交叉验证：候选名也应出现在标签中，或者看起来像人名
   - 排除以括号结尾的候选（如 "4月作品『申鹤" 不应被提取）
   *
   * @param title - 标题
   * @param tags - 标签列表
   * @returns 提取到的人名，未匹配返回 null
   */
  private async extractStandardFormat(title: string, tags: string[]): Promise<string | null> {
    const parts = title.split(/\s*[-—–]\s*/).filter((p) => p.length > 0);
    if (parts.length < 2) return null;

    const candidate = parts[0].trim();
    if (!candidate || candidate.length >= 25) return null;

    // 排除：候选以未闭合括号结尾（说明分隔符在括号内部）
    if (/[『「【\[]$/.test(candidate)) return null;

    // 交叉验证：候选名也是标签之一
    if (tags.some((tag) => tag === candidate || tag === candidate.replace(/^[^\u4e00-\u9fff]+/, ''))) {
      return candidate;
    }

    // 如果候选本身是游戏角色，跳过此策略
    // （游戏角色不是真实出镜者，不应作为主角返回）
    if (await this.isGameCharacter(candidate)) return null;

    // 检查候选是否为已知 Person（排除游戏角色）
    const person = this.matchKnownPerson(candidate);
    if (person) return person;

    // 拼音模糊匹配
    const fuzzyMatch = this.fuzzyMatchPerson(candidate);
    if (fuzzyMatch) return fuzzyMatch;

    // 启发式：看起来像人名
    if (this.looksLikePersonName(candidate)) {
      return candidate;
    }

    // 特殊处理：候选是纯英文名（如 OwlLit、Xiaoyukiko小鱼 等）
    // 检查候选是否符合 "英文名(中文名)" 或 "纯英文名" 格式
    const englishNameMatch = candidate.match(/^([a-zA-Z][a-zA-Z0-9]*)(?:\s*[（(]([^)）]+)[)）])?$/);
    if (englishNameMatch) {
      const englishName = englishNameMatch[1];
      const chineseName = englishNameMatch[2];

      // 验证英文名长度
      if (englishName.length >= 2 && englishName.length <= 20) {
        // 如果 TAG 中有匹配的中文名，返回英文名
        if (chineseName && tags.some(tag => tag.includes(chineseName))) {
          return candidate;
        }
        // 如果 TAG 中没有人物名，但候选是纯英文名，也接受
        // 这是为了处理 OwlLit 这种情况
        if (!chineseName && /^[a-zA-Z][a-zA-Z0-9]*$/.test(englishName)) {
          // 检查后面的部分是否包含游戏/作品名
          const restOfTitle = parts.slice(1).join(' - ');
          // 如果后面有游戏角色或作品名，则候选很可能是 Cosplayer
          if (await this.matchGameCharacterInText(restOfTitle) ||
              /^(原神|星穹铁道|崩坏|碧蓝航线|碧蓝档案|鸣潮|火影忍者|电锯人|葬送的芙莉莲|明日方舟|绝区零)/.test(restOfTitle)) {
            return candidate;
          }
        }
      }
    }

    return null;
  }

  /**
   * 启发式判断字符串是否看起来像人名
   *
   * 规则：
   - 长度 2-15 字符
   - 以中文或日文汉字开头
   - 不包含明显的非名字标记词（如 "作品"、"合集"、"月"、"日" 等）
   - 不包含数字（纯英文名除外）
   *
   * @param text - 待检查的字符串
   * @returns 是否看起来像人名
   */
  looksLikePersonName(text: string): boolean {
    if (!text) return false;

    const trimmed = text.trim();

    // 长度检查（放宽到 20 字符以支持混名）
    if (trimmed.length < 2 || trimmed.length > 20) return false;

    // 以中文/日文/英文字母开头
    if (!/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffa-zA-Z]/.test(trimmed[0])) {
      return false;
    }

    // 不包含非名字标记词
    const nonNameMarkers = [
      '作品', '合集', '月', '日', '年', '季度', '期', ' vol',
      '打赏', '资源', '小剧场', '预告', '整理', '篇',
      '图包', '套图', '系列', '完整', '修正', '重制',
      'Porn', 'Nudes', 'Generated',
    ];
    for (const marker of nonNameMarkers) {
      if (trimmed.toLowerCase().includes(marker.toLowerCase())) return false;
    }

    // 不包含纯数字（但允许混名中的数字，如 "鱼子酱Fish" 中的英文不算数字）
    // 检查是否包含独立的数字序列
    if (/\d+/.test(trimmed)) {
      // 如果包含数字，检查是否是混名（中文+英文）
      // 混名格式：中文字符 + 英文字母，如 "樱井宁宁ningning"
      const chinesePart = trimmed.match(/^[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/);
      const englishPart = trimmed.match(/[a-zA-Z]+$/);
      if (!chinesePart || !englishPart) {
        // 不是混名格式，且包含数字，则不是人名
        return false;
      }
    }

    // 不包含括号
    if (/[『「【\[「』」】\]]/.test(trimmed)) return false;

    return true;
  }

  /**
   * 自动学习人物名
   *
   * 策略：
   - 精确匹配 Person DB → 增量 galleryCount
   - 拼音模糊匹配 → 添加别名 + 增量 galleryCount
   - 全新名字 → 创建新 Person 记录
   *
   * @param name - 解析到的人物名
   * @param source - 数据来源（默认 auto）
   */
  async learnPerson(name: string, source: string = 'auto'): Promise<void> {
    if (!name) return;

    // 游戏角色不应作为人物学习（它们由 importGameCharacters 管理）
    if (await this.isGameCharacter(name)) return;

    await this.ensureCacheInitialized();

    const exactEntry = this.personCache.get(name.toLowerCase());
    if (exactEntry) {
      try {
        await prisma.person.update({
          where: { name: exactEntry.name },
          data: {
            galleryCount: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        exactEntry.galleryCount++;
      } catch (err) {
        console.warn(`[ProtagonistService] learnPerson 精确匹配更新失败: ${name}`, err);
      }
      return;
    }

    const fuzzyName = this.fuzzyMatchPerson(name, 0.85);
    if (fuzzyName) {
      try {
        const existing = await prisma.person.findUnique({ where: { name: fuzzyName } });
        if (existing) {
          let aliases: string[] = [];
          try {
            aliases = JSON.parse(existing.aliases);
          } catch {
            aliases = [];
          }
          if (!aliases.includes(name)) {
            aliases.push(name);
          }
          await prisma.person.update({
            where: { name: fuzzyName },
            data: {
              aliases: JSON.stringify(aliases),
              galleryCount: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          // 更新缓存
          const cacheEntry = this.personCache.get(fuzzyName.toLowerCase());
          if (cacheEntry) {
            if (!cacheEntry.aliases.includes(name)) {
              cacheEntry.aliases.push(name);
            }
            cacheEntry.galleryCount++;
          }
        }
      } catch (err) {
        console.warn(`[ProtagonistService] learnPerson 拼音模糊匹配更新失败: ${name} → ${fuzzyName}`, err);
      }
      return;
    }

    try {
      const py = this.toStandardPinyin(name);
      await prisma.person.create({
        data: {
          name,
          pinyin: py,
          aliases: '[]',
          source,
          galleryCount: 1,
          confirmed: false,
        },
      });
      // 更新缓存
      const entry: PersonCacheEntry = { name, pinyin: py, aliases: [], galleryCount: 1, source };
      this.personCache.set(name.toLowerCase(), entry);
      if (py) {
        this.pinyinCache.set(py, entry);
      }
    } catch (err) {
      // 可能是并发创建冲突（unique 约束），忽略
      if (!String(err).includes('Unique constraint')) {
        console.warn(`[ProtagonistService] learnPerson 创建失败: ${name}`, err);
      }
    }
  }

  /**
   * 批量导入游戏角色到 Person 表
   *
   * 将 GameCharacterService 中的全部角色导入为 Person 记录，
   * source = 'game_character'，sourceGame = 对应游戏类型。
   *
   * @returns 导入的数量
   */
  async importGameCharacters(): Promise<number> {
    const service = getGameCharacterService();
    const allChars = await service.getAllCharacters();
    let imported = 0;

    for (const char of allChars) {
      try {
        const py = this.toStandardPinyin(char.name);
        const aliasesJson = JSON.stringify(char.aliases || []);
        await prisma.person.upsert({
          where: { name: char.name },
          create: {
            name: char.name,
            pinyin: py,
            aliases: aliasesJson,
            source: 'game_character',
            sourceGame: char.game,
            galleryCount: 0,
            confirmed: true,
          },
          update: {
            pinyin: py,
            aliases: aliasesJson,
            sourceGame: char.game,
          },
        });
        imported++;
      } catch (err) {
        console.warn(`[ProtagonistService] 导入游戏角色失败: ${char.name}`, err);
      }
    }

    // 刷新缓存
    await this.refreshCache();
    console.log(`[ProtagonistService] 成功导入 ${imported} 个游戏角色到 Person 表`);
    return imported;
  }

  /**
   * 基于数据库统计确定标准名字
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
    const allGalleries = await prisma.gallery.findMany({
      where: { protagonist: { not: '' } },
      select: { protagonist: true },
      distinct: ['protagonist'],
    });

    const allNames = allGalleries.map((g) => g.protagonist);
    const similarNames: { name: string; similarity: number }[] = [];

    for (const name of allNames) {
      const sim = this.calculateSimilarity(rawName, name);
      if (sim > 0.6) {
        similarNames.push({ name, similarity: sim });
      }
    }

    similarNames.sort((a, b) => b.similarity - a.similarity);

    const nameCounts: { [key: string]: number } = {};
    for (const { name } of similarNames) {
      nameCounts[name] = await prisma.gallery.count({
        where: { protagonist: name },
      });
    }

    let standardName = rawName;
    let maxCount = 0;
    for (const { name } of similarNames) {
      const count = nameCounts[name];
      if (count > maxCount) {
        maxCount = count;
        standardName = name;
      }
    }

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
   */
  async getProtagonistStats(standardName: string): Promise<ProtagonistStats | null> {
    if (!standardName) return null;

    const galleries = await prisma.gallery.findMany({
      where: { protagonist: standardName },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, coverUrl: true },
    });

    if (galleries.length === 0) return null;

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
   */
  async getAllProtagonists(): Promise<{ name: string; count: number; coverUrl: string }[]> {
    const result = await prisma.gallery.groupBy({
      by: ['protagonist'],
      where: { protagonist: { not: '' } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

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

    /**
   * 在 TAG 列表中识别游戏角色名
   */
  async identifyGameCharacters(tags: string[]): Promise<string[]> {
    const service = getGameCharacterService();
    const matches = await service.identifyInTags(tags);
    return matches.map((m) => m.character.name);
  }

  /**
   * 在 TAG 列表中识别游戏角色（含详细匹配信息）
   */
  async identifyGameCharactersDetailed(tags: string[]): Promise<GameCharacterMatch[]> {
    return await getGameCharacterService().identifyInTags(tags);
  }

  /**
   * 检查指定名字是否为已知游戏角色
   */
  async isGameCharacter(name: string): Promise<boolean> {
    return (await getGameCharacterService().getCharacter(name)) !== null;
  }
}

let protagonistService: ProtagonistService | null = null;

export function getProtagonistService(): ProtagonistService {
  if (!protagonistService) {
    protagonistService = new ProtagonistService();
  }
  return protagonistService;
}
