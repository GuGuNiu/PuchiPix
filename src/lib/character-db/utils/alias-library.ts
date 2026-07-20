/**
 * Alias Library Manager
 *
 * Manages character aliases, nicknames, and common misspellings.
 * Supports dynamic addition and updates.
 */

import type { CharacterEntry } from '../types';

export interface AliasRule {
  id: string;
  targetId: string;
  aliases: string[];
  type: 'nickname' | 'typo' | 'variant' | 'abbreviation' | 'translation';
  source?: string;
  weight: number;
}

export interface AliasLibraryConfig {
  loadBuiltIn: boolean;
  enableCustom: boolean;
  customPath?: string;
}

/**
 * Built-in alias rules - common misspellings and nicknames.
 */
const BUILT_IN_ALIASES: AliasRule[] = [
  // Genshin Impact
  { id: 'genshin-raiden-1', targetId: 'genshin-raiden', aliases: ['雷电', '雷神', '雷电影', '巴尔', '雷大炮'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-raiden-2', targetId: 'genshin-raiden', aliases: ['leidianjiangjun', 'ldjj', 'raiden'], type: 'typo', weight: 0.85 },
  { id: 'genshin-hutao-1', targetId: 'genshin-hutao', aliases: ['胡桃', '堂主', '胡堂主', '桃桃'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-hutao-2', targetId: 'genshin-hutao', aliases: ['hutao', 'ht', '胡桃'], type: 'typo', weight: 0.85 },
  { id: 'genshin-zhongli-1', targetId: 'genshin-zhongli', aliases: ['钟离', '岩神', '帝君', '岩王爷', '摩拉克斯'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-zhongli-2', targetId: 'genshin-zhongli', aliases: ['zhongli', 'zl', '钟离'], type: 'typo', weight: 0.85 },
  { id: 'genshin-nahida-1', targetId: 'genshin-nahida', aliases: ['纳西妲', '草神', '小草神', '小吉祥草王', '布耶尔'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-nahida-2', targetId: 'genshin-nahida', aliases: ['naxida', 'nxd', '纳西妲'], type: 'typo', weight: 0.85 },
  { id: 'genshin-yae-1', targetId: 'genshin-yae', aliases: ['八重', '神子', '狐狸', '屑狐狸', '宫司大人'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-yae-2', targetId: 'genshin-yae', aliases: ['yae', 'bazhong', '八重神子'], type: 'typo', weight: 0.85 },
  { id: 'genshin-kokomi-1', targetId: 'genshin-kokomi', aliases: ['心海', '珊瑚宫', '军师', '观赏鱼'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-kokomi-2', targetId: 'genshin-kokomi', aliases: ['kokomi', 'xinhai', '心海'], type: 'typo', weight: 0.85 },
  { id: 'genshin-ganyu-1', targetId: 'genshin-ganyu', aliases: ['甘雨', '椰羊', '王小美', '秘书'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-ganyu-2', targetId: 'genshin-ganyu', aliases: ['ganyu', 'gy', 'ganyu'], type: 'typo', weight: 0.85 },
  { id: 'genshin-ayaka-1', targetId: 'genshin-ayaka', aliases: ['绫华', '神里', '白鹭公主', '龟龟'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-ayaka-2', targetId: 'genshin-ayaka', aliases: ['ayaka', 'linghua', '绫华'], type: 'typo', weight: 0.85 },
  { id: 'genshin-yoimiya-1', targetId: 'genshin-yoimiya', aliases: ['宵宫', '烟花', '长野原', '夏祭女王'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-yoimiya-2', targetId: 'genshin-yoimiya', aliases: ['yoimiya', 'xiaogong', '宵宫'], type: 'typo', weight: 0.85 },
  { id: 'genshin-furina-1', targetId: 'genshin-furina', aliases: ['芙宁娜', '水神', '芙芙', '芙卡洛斯'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-furina-2', targetId: 'genshin-furina', aliases: ['furina', 'funingna', '芙宁娜'], type: 'typo', weight: 0.85 },
  { id: 'genshin-mavuika-1', targetId: 'genshin-mavuika', aliases: ['玛薇卡', '火神', '火神大人'], type: 'nickname', weight: 0.95 },
  { id: 'genshin-mavuika-2', targetId: 'genshin-mavuika', aliases: ['mavuika', 'maweika', '玛薇卡'], type: 'typo', weight: 0.85 },

  // Honkai: Star Rail
  { id: 'starrail-kafka-1', targetId: 'starrail-kafka', aliases: ['卡芙卡', '卡妈', '妈妈'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-kafka-2', targetId: 'starrail-kafka', aliases: ['kafka', 'kafuka', '卡芙卡'], type: 'typo', weight: 0.85 },
  { id: 'starrail-silverwolf-1', targetId: 'starrail-silverwolf', aliases: ['银狼', '骇客', '狼宝'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-silverwolf-2', targetId: 'starrail-silverwolf', aliases: ['silverwolf', 'yinlang', '银狼'], type: 'typo', weight: 0.85 },
  { id: 'starrail-bronya-1', targetId: 'starrail-bronya', aliases: ['布洛妮娅', '大守护者', '鸭鸭'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-bronya-2', targetId: 'starrail-bronya', aliases: ['bronya', 'buluoniya', '布洛妮娅'], type: 'typo', weight: 0.85 },
  { id: 'starrail-seele-1', targetId: 'starrail-seele', aliases: ['希儿', '蝴蝶', '量子少女'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-seele-2', targetId: 'starrail-seele', aliases: ['seele', 'xier', '希儿'], type: 'typo', weight: 0.85 },
  { id: 'starrail-jingliu-1', targetId: 'starrail-jingliu', aliases: ['镜流', '剑首', '疯女人'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-jingliu-2', targetId: 'starrail-jingliu', aliases: ['jingliu', 'jingliu', '镜流'], type: 'typo', weight: 0.85 },
  { id: 'starrail-robin-1', targetId: 'starrail-robin', aliases: ['知更鸟', '鸟妹', '大明星'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-robin-2', targetId: 'starrail-robin', aliases: ['robin', 'zhigengniao', '知更鸟'], type: 'typo', weight: 0.85 },
  { id: 'starrail-sparkle-1', targetId: 'starrail-sparkle', aliases: ['花火', '乐子人', '假面愚者'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-sparkle-2', targetId: 'starrail-sparkle', aliases: ['sparkle', 'huahuo', '花火'], type: 'typo', weight: 0.85 },
  { id: 'starrail-acheron-1', targetId: 'starrail-acheron', aliases: ['黄泉', '虚无令使', '芽衣'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-acheron-2', targetId: 'starrail-acheron', aliases: ['acheron', 'huangquan', '黄泉'], type: 'typo', weight: 0.85 },
  { id: 'starrail-castorice-1', targetId: 'starrail-castorice', aliases: ['遐蝶', '死龙', '冥河的女儿'], type: 'nickname', weight: 0.95 },
  { id: 'starrail-castorice-2', targetId: 'starrail-castorice', aliases: ['castorice', 'xiadie', '遐蝶'], type: 'typo', weight: 0.85 },

  // Wuthering Waves
  { id: 'wuthering-jinhsi-1', targetId: 'wuthering-jinhsi', aliases: ['今汐', '今州令尹', '汐汐'], type: 'nickname', weight: 0.95 },
  { id: 'wuthering-jinhsi-2', targetId: 'wuthering-jinhsi', aliases: ['jinhsi', 'jinxi', '今汐'], type: 'typo', weight: 0.85 },
  { id: 'wuthering-changli-1', targetId: 'wuthering-changli', aliases: ['长离', '师傅', '今汐师傅'], type: 'nickname', weight: 0.95 },
  { id: 'wuthering-changli-2', targetId: 'wuthering-changli', aliases: ['changli', 'changling', '长离'], type: 'typo', weight: 0.85 },
  { id: 'wuthering-camellya-1', targetId: 'wuthering-camellya', aliases: ['椿', '黑海岸', '椿宝'], type: 'nickname', weight: 0.95 },
  { id: 'wuthering-camellya-2', targetId: 'wuthering-camellya', aliases: ['camellya', 'chun', '椿'], type: 'typo', weight: 0.85 },
  { id: 'wuthering-shorekeeper-1', targetId: 'wuthering-shorekeeper', aliases: ['守岸人', '守岸', '蝴蝶'], type: 'nickname', weight: 0.95 },
  { id: 'wuthering-shorekeeper-2', targetId: 'wuthering-shorekeeper', aliases: ['shorekeeper', 'shouanren', '守岸人'], type: 'typo', weight: 0.85 },
  { id: 'wuthering-yinlin-1', targetId: 'wuthering-yinlin', aliases: ['吟霖', '审判者', '吟霖姐'], type: 'nickname', weight: 0.95 },
  { id: 'wuthering-yinlin-2', targetId: 'wuthering-yinlin', aliases: ['yinlin', 'yinlin', '吟霖'], type: 'typo', weight: 0.85 },

  // Azur Lane
  { id: 'azurlane-enterprise-1', targetId: 'azurlane-enterprise', aliases: ['企业', '大E', '灰色幽灵'], type: 'nickname', weight: 0.95 },
  { id: 'azurlane-enterprise-2', targetId: 'azurlane-enterprise', aliases: ['enterprise', 'qiye', '企业'], type: 'typo', weight: 0.85 },
  { id: 'azurlane-belfast-1', targetId: 'azurlane-belfast', aliases: ['贝尔法斯特', '女仆长', '贝法'], type: 'nickname', weight: 0.95 },
  { id: 'azurlane-belfast-2', targetId: 'azurlane-belfast', aliases: ['belfast', 'beierfasite', '贝尔法斯特'], type: 'typo', weight: 0.85 },
  { id: 'azurlane-illustrious-1', targetId: 'azurlane-illustrious', aliases: ['光辉', '太太', '光辉妈妈'], type: 'nickname', weight: 0.95 },
  { id: 'azurlane-illustrious-2', targetId: 'azurlane-illustrious', aliases: ['illustrious', 'guanghui', '光辉'], type: 'typo', weight: 0.85 },
  { id: 'azurlane-shinano-1', targetId: 'azurlane-shinano', aliases: ['信浓', '大白狐狸', '信浓大人'], type: 'nickname', weight: 0.95 },
  { id: 'azurlane-shinano-2', targetId: 'azurlane-shinano', aliases: ['shinano', 'xinnong', '信浓'], type: 'typo', weight: 0.85 },
  { id: 'azurlane-musashi-1', targetId: 'azurlane-musashi', aliases: ['武藏', '大和级', '武藏大人'], type: 'nickname', weight: 0.95 },
  { id: 'azurlane-musashi-2', targetId: 'azurlane-musashi', aliases: ['musashi', 'wuzang', '武藏'], type: 'typo', weight: 0.85 },
];

export class AliasLibrary {
  private rules: Map<string, AliasRule> = new Map();
  private targetIndex: Map<string, Set<string>> = new Map();
  private config: AliasLibraryConfig;

  constructor(config: Partial<AliasLibraryConfig> = {}) {
    this.config = {
      loadBuiltIn: true,
      enableCustom: true,
      ...config,
    };

    if (this.config.loadBuiltIn) {
      this.loadBuiltInRules();
    }
  }

  private loadBuiltInRules(): void {
    for (const rule of BUILT_IN_ALIASES) {
      this.addRule(rule);
    }
    console.log(`[AliasLibrary] 加载内置别名库: ${BUILT_IN_ALIASES.length} 条规则`);
  }

  addRule(rule: AliasRule): void {
    this.rules.set(rule.id, rule);

    if (!this.targetIndex.has(rule.targetId)) {
      this.targetIndex.set(rule.targetId, new Set());
    }
    this.targetIndex.get(rule.targetId)!.add(rule.id);
  }

  removeRule(ruleId: string): boolean {
    const rule = this.rules.get(ruleId);
    if (!rule) return false;

    this.rules.delete(ruleId);
    this.targetIndex.get(rule.targetId)?.delete(ruleId);
    return true;
  }

  findMatches(text: string): Array<{ rule: AliasRule; matchedAlias: string; score: number }> {
    const lowerText = text.toLowerCase();
    const matches: Array<{ rule: AliasRule; matchedAlias: string; score: number }> = [];

    for (const rule of this.rules.values()) {
      for (const alias of rule.aliases) {
        const lowerAlias = alias.toLowerCase();

        if (lowerText === lowerAlias) {
          matches.push({
            rule,
            matchedAlias: alias,
            score: rule.weight,
          });
          continue;
        }

        if (lowerText.includes(lowerAlias) || lowerAlias.includes(lowerText)) {
          const lengthRatio = Math.min(lowerText.length, lowerAlias.length) / Math.max(lowerText.length, lowerAlias.length);
          matches.push({
            rule,
            matchedAlias: alias,
            score: rule.weight * lengthRatio * 0.8,
          });
        }
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  getAliasesForTarget(targetId: string): string[] {
    const ruleIds = this.targetIndex.get(targetId);
    if (!ruleIds) return [];

    const aliases: string[] = [];
    for (const ruleId of ruleIds) {
      const rule = this.rules.get(ruleId);
      if (rule) {
        aliases.push(...rule.aliases);
      }
    }

    return [...new Set(aliases)];
  }

  loadFromData(aliases: Record<string, string[]>): void {
    let count = 0;
    for (const [targetId, aliasList] of Object.entries(aliases)) {
      for (const alias of aliasList) {
        this.addRule({
          id: `custom-${targetId}-${alias}`,
          targetId,
          aliases: [alias],
          type: 'nickname',
          weight: 0.9,
        });
        count++;
      }
    }
    console.log(`[AliasLibrary] 从数据加载别名: ${count} 条`);
  }

  exportRules(): AliasRule[] {
    return Array.from(this.rules.values());
  }

  getRuleCount(): number {
    return this.rules.size;
  }
}

let aliasLibrary: AliasLibrary | null = null;

export function getAliasLibrary(config?: Partial<AliasLibraryConfig>): AliasLibrary {
  if (!aliasLibrary) {
    aliasLibrary = new AliasLibrary(config);
  }
  return aliasLibrary;
}
