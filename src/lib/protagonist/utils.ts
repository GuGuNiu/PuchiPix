import { getPinyinService } from '@/lib/core/pinyin-service';


export function toStandardPinyin(chineseName: string): string {
  if (!chineseName) return '';
  return getPinyinService().getVariants(chineseName).full;
}


export function calculateSimilarity(name1: string, name2: string): number {
  if (!name1 || !name2) return 0;
  if (name1 === name2) return 1;
  return getPinyinService().calculateSimilarity(name1, name2, { algorithm: 'combined' });
}


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


export function cleanTitlePrefix(title: string): string {
  if (!title) return '';
  return title.replace(/^\[[^\]]+\]\s*/i, '').trim();
}

/**
 * Checkisnoto AI Generatecontent
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

  if (/\d/.test(trimmed)) {
    if (/^\d/.test(trimmed)) return false;
    if (!/[a-zA-Z\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(trimmed)) return false;
    if (/\d+P\d*V?$/i.test(trimmed)) return false;
  }

  if (/[『「【\[「』」】\]]/.test(trimmed)) return false;

  return true;
}


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


export function isTagInFirstSegment(title: string, tag: string): boolean {
  const separatorMatch = title.match(/^(.+?)\s*[-—–]\s*/);
  if (!separatorMatch) {
    return title.includes(tag);
  }
  const firstSegment = separatorMatch[1];
  return firstSegment.includes(tag);
}

/** Non-person TAG Set */
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

const COSPLAYER_PREFIXES = [
  'Coser ', 'Coser_', 'Coser-', 'Coser.',
  'coser ', 'Cos ', 'cos ', 'COS ', 'COSER ',
  'coser_', 'coser-',
];


export function stripCosplayerPrefix(text: string): string {
  if (!text) return '';
  const lowerText = text.toLowerCase();
  for (const prefix of COSPLAYER_PREFIXES) {
    if (lowerText.startsWith(prefix.toLowerCase())) {
      return text.substring(prefix.length).trim();
    }
  }
  return text;
}

const CATEGORY_KEYWORDS = new Set([
  'JK制服', 'jk制服', 'Cosplay', 'cosplay', 'COSPLAY',
  '写真', '私房', '视频', '图包', '套图', '合集',
  '作品', '整理', '系列', '精选',
]);


export function isCategoryKeyword(text: string): boolean {
  if (!text) return false;
  return CATEGORY_KEYWORDS.has(text.trim());
}
