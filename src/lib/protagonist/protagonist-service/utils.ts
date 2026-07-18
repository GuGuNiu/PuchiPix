import { getPinyinService } from '@/lib/core/pinyin-service';

/**
 * 将中文名字转为标准拼音（无声调，小写，无空格）
 *
 * 委托至 core/pinyin-service 统一服务，复用其缓存和 PinyinPro 适配器。
 */
export function toStandardPinyin(chineseName: string): string {
  if (!chineseName) return '';
  return getPinyinService().getVariants(chineseName).full;
}

/**
 * 计算两个名字的综合相似度
 *
 * 委托至 core/pinyin-service 的 Combined 算法
 * （Levenshtein × 0.4 + JaroWinkler × 0.3 + Bigram(Dice) × 0.3），
 * 与 character-db 模块的相似度计算保持一致。
 */
export function calculateSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0;
  if (name1 === name2) return 1;
  return getPinyinService().calculateSimilarity(name1, name2, { algorithm: 'combined' });
}

/**
 * 解析混名，分离中文部分和拼音/英文部分
 */
export function parseMixedName(name: string): { chinese: string; pinyin: string; isMixed: boolean } {
  if (!name) return { chinese: '', pinyin: '', isMixed: false };

  const chineseMatch = name.match(/^[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/);
  const chinese = chineseMatch ? chineseMatch[0] : '';

  const pinyin = name.substring(chinese.length).trim();

  return {
    chinese,
    pinyin,
    isMixed: pinyin.length > 0,
  };
}

/**
 * 清洗标题前缀（去除 [cosplay]、[私房] 等分类前缀）
 */
export function cleanTitlePrefix(title: string): string {
  if (!title) return '';
  return title.replace(/^\[[^\]]+\]\s*/i, '').trim();
}

/**
 * 判断是否为 AI 生成内容
 */
export function isAIGenerated(title: string): boolean {
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
 * 启发式判断字符串是否看起来像人名
 *
 * 规则：
 * - 长度 2-20 字符
 * - 以中文/日文/英文字母开头
 * - 不包含明显的非名字标记词
 * - 不包含数字（混名除外）
 * - 不包含括号
 */
export function looksLikePersonName(text: string): boolean {
  if (!text) return false;

  const trimmed = text.trim();

  if (trimmed.length < 2 || trimmed.length > 20) return false;

  if (!/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffa-zA-Z]/.test(trimmed[0])) {
    return false;
  }

  const nonNameMarkers = [
    '作品', '合集', '月', '日', '年', '季度', '期', ' vol',
    '打赏', '资源', '小剧场', '预告', '整理', '篇',
    '图包', '套图', '系列', '完整', '修正', '重制',
    'Porn', 'Nudes', 'Generated',
  ];
  for (const marker of nonNameMarkers) {
    if (trimmed.toLowerCase().includes(marker.toLowerCase())) return false;
  }

  if (/\d+/.test(trimmed)) {
    const chinesePart = trimmed.match(/^[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/);
    const englishPart = trimmed.match(/[a-zA-Z]+$/);
    if (!chinesePart || !englishPart) {
      return false;
    }
  }

  if (/[『「【\[「』」】\]]/.test(trimmed)) return false;

  return true;
}

/**
 * 宽松判断字符串是否可能是人名
 *
 * 比 looksLikePersonName 更宽松，
 * 用于 Cosplayer 提取场景，只要不像明显的非人名即可。
 */
export function isLikelyPersonName(text: string): boolean {
  if (!text) return false;

  const trimmed = text.trim();

  if (trimmed.length < 2 || trimmed.length > 25) return false;

  const nonNamePrefixes = [
    '作品', '合集', '月', '日', '年', '季度', '期', ' vol',
    '打赏', '资源', '小剧场', '预告', '整理', '篇',
    '图包', '套图', '系列', '完整', '修正', '重制', 'AI ', 'AI',
  ];
  for (const prefix of nonNamePrefixes) {
    if (trimmed.startsWith(prefix)) return false;
  }

  const nonNameKeywords = [
    'Porn', 'Nudes', 'Generated', '写真合集', '福利姬',
  ];
  for (const keyword of nonNameKeywords) {
    if (trimmed.toLowerCase().includes(keyword.toLowerCase())) return false;
  }

  if (!/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ffa-zA-Z]/.test(trimmed[0])) {
    return false;
  }

  return true;
}

/**
 * 检查 TAG 是否出现在标题第一段（分隔符前）
 */
export function isTagInFirstSegment(title: string, tag: string): boolean {
  const separatorMatch = title.match(/^(.+?)\s*[-—–]\s*/);
  if (!separatorMatch) {
    return title.includes(tag);
  }
  const firstSegment = separatorMatch[1];
  return firstSegment.includes(tag);
}

/** 非人物 TAG 集合 */
export const NON_PERSON_TAGS = new Set([
  '标签', 'cosplay', '大尺度', '美腿', '美胸', '真人写真', '视频',
  '巨乳', '丝袜', '蕾丝', '高跟鞋', '婚纱', '兔女郎', '私房写真',
  '黑丝', '全裸', '露穴', '口交', '交合', '室内', '床拍', '古风',
  '古装', '校服', '白丝', '黑发', '红裙', '湖畔', '浴室', '湿身',
  '内衣', '美RU', '御姐', '私拍', '福利', '极品', '女神', '少女',
  '粉嫩', '美穴', '鲍鱼', '美鲍', '小仙女', '福利姬', 'R18',
  '模特写真', '内购无水印', '秀人网', 'AI美女', 'AI Generated',
  '吞噬星空', '剑来', '凡人修仙传', '电锯人', '葬送的芙莉莲',
  '火影忍者', '漩涡鸣人',
]);
