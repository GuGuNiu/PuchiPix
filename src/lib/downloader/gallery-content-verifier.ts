/**
 * 模块：图库内容校验工具
 *
 * 提供标题模式解析（如 "11P2V"）、英文名生成和内容数量校验功能。
 *
 * 功能：
 * 1. parseTitleCount: 从标题中解析预期图片/视频数量（如 "11P2V" → 11图2视频）
 * 2. generateEnglishZipName: 根据图库元信息生成英文 ZIP 文件名
 * 3. verifyExtractedContent: 对比解压后实际文件数与标题声明数
 *
 * @author PuchiPix Team
 * @date 2026-07-12
 */

import fs from 'fs';
import path from 'path';

// ============================================================
// 标题数量解析
// ============================================================

/**
 * 从标题中解析预期的图片和视频数量
 *
 * 爱妹子等站点标题格式：
 * - "主角名 - 描述 11P2V" → 11 张图片，2 个视频
 * - "主角名 - 描述 50P" → 50 张图片，0 个视频
 * - "主角名 - 描述 11P2V1G" → 11 图 2 视频 1 GIF（G 归入图片）
 * - "主角名 - 描述" → 0, 0（标题未声明数量）
 *
 * @param title - 完整标题（H1 文本）
 * @returns { expectedImages, expectedVideos }
 *
 * @date 2026-07-12
 */
export function parseTitleCount(title: string): { expectedImages: number; expectedVideos: number } {
  if (!title) return { expectedImages: 0, expectedVideos: 0 };

  // 匹配标题尾部的 "11P2V" 或 "50P" 或 "11P2V1G" 格式
  const match = title.match(/(\d+)P\s*(?:(\d+)V)?\s*(?:(\d+)G)?\s*$/i);

  if (!match) return { expectedImages: 0, expectedVideos: 0 };

  const images = parseInt(match[1], 10) || 0;
  const videos = parseInt(match[2] || '0', 10) || 0;
  const gifs = parseInt(match[3] || '0', 10) || 0;

  // GIF 归入图片类
  return {
    expectedImages: images + gifs,
    expectedVideos: videos,
  };
}

// ============================================================
// 英文 ZIP 文件名生成
// ============================================================

/**
 * 中文/日文字符到拼音/罗马音的简易映射
 *
 * 仅覆盖常见的图库主角名字符，无法覆盖的字符将被忽略。
 * 此映射表可在后续扩展中补充。
 *
 * @date 2026-07-12
 */
const CJK_ROMAN_MAP: Record<string, string> = {
  // 常见中文字符
  '可': 'ke', '小': 'xiao', '白': 'bai', '兔': 'tu',
  '美': 'mei', '女': 'nv', '妹': 'mei', '子': 'zi',
  '爱': 'ai', '花': 'hua', '樱': 'ying', '雪': 'xue',
  '月': 'yue', '星': 'xing', '梦': 'meng', '心': 'xin',
  '糖': 'tang', '甜': 'tian', '猫': 'mao', '犬': 'quan',
  '狐': 'hu', '龙': 'long', '凤': 'feng', '鸟': 'niao',
  '蝶': 'die', '鱼': 'yu', '熊': 'xiong', '鹿': 'lu',
  '蓝': 'lan', '红': 'hong', '紫': 'zi', '绿': 'lv',
  '黑': 'hei', '金': 'jin', '银': 'yin', '玉': 'yu',
  '天': 'tian', '海': 'hai', '山': 'shan', '风': 'feng',
  '云': 'yun', '雨': 'yu', '光': 'guang', '影': 'ying',
  '夜': 'ye', '日': 'ri', '春': 'chun', '夏': 'xia',
  '秋': 'qiu', '冬': 'dong', '冰': 'bing', '火': 'huo',
  '水': 'shui', '土': 'tu', '木': 'mu', '石': 'shi',
  '少': 'shao', '年': 'nian', '姐': 'jie', '妹': 'mei',
  '娘': 'niang', '娃': 'wa', '宝': 'bao', '贝': 'bei',
  '仙': 'xian', '灵': 'ling', '妖': 'yao', '魔': 'mo',
  '神': 'shen', '圣': 'sheng', '王': 'wang', '后': 'hou',
  '公': 'gong', '主': 'zhu', '皇': 'huang', '帝': 'di',
  '一': 'yi', '二': 'er', '三': 'san', '四': 'si',
  '五': 'wu', '六': 'liu', '七': 'qi', '八': 'ba',
  '九': 'jiu', '十': 'shi',
};

/**
 * 将 CJK 字符串转换为罗马音/拼音表示
 *
 * 逐字符查表转换，无法转换的字符跳过。
 * 结果用下划线连接，保证文件名为纯 ASCII。
 *
 * @date 2026-07-12
 */
function cjkToRoman(text: string): string {
  let result = '';
  for (const char of text) {
    if (CJK_ROMAN_MAP[char]) {
      result += CJK_ROMAN_MAP[char];
    } else if (/[a-zA-Z0-9]/.test(char)) {
      result += char;
    } else if (/[\s\-_]/.test(char)) {
      result += '_';
    }
  }
  // 合并连续下划线，去除首尾下划线
  return result.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * 根据图库元信息生成英文 ZIP 文件名
 *
 * 命名规则：{主角罗马音}_{描述罗马音}_{文章ID}.zip
 * 如果主角名为英文则直接使用，否则用 CJK 罗马音映射转换。
 * 保证文件名为纯 ASCII，不含特殊字符。
 *
 * 示例：
 * - 主角 "可可小白兔", 描述 "電車上の女高中生", ID 27571
 *   → "keke_xiaobaitu_27571.zip"
 * - 主角 "Alice", 描述 "Cosplay Set", ID 123
 *   → "alice_cosplay_set_123.zip"
 *
 * @param protagonist - 主角名
 * @param description - 描述
 * @param galleryId - 图库 ID（用于唯一标识）
 * @param ext - 文件扩展名（默认 .zip）
 * @returns 纯 ASCII 英文文件名
 *
 * @date 2026-07-12
 */
export function generateEnglishZipName(
  protagonist: string,
  description: string,
  galleryId: number,
  ext: string = '.zip',
): string {
  const parts: string[] = [];

  if (protagonist) {
    const roman = cjkToRoman(protagonist);
    if (roman) parts.push(roman);
  }

  if (description) {
    // 去除描述尾部的数量标记（如 "21P1V"）
    const cleanDesc = description.replace(/\s*\d+P\d*V?\s*$/i, '').trim();
    if (cleanDesc) {
      const roman = cjkToRoman(cleanDesc);
      if (roman) parts.push(roman);
    }
  }

  // 确保至少有 galleryId 作为文件名
  parts.push(String(galleryId));

  const baseName = parts.join('_').toLowerCase().replace(/_+/g, '_');

  // 确保扩展名以点开头
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;

  return `${baseName}${normalizedExt}`;
}

// ============================================================
// 内容校验
// ============================================================

export interface ContentVerificationResult {
  /** 实际图片文件数 */
  imageCount: number;
  /** 实际视频文件数 */
  videoCount: number;
  /** 实际其他文件数 */
  otherCount: number;
  /** 总文件数 */
  totalCount: number;
  /** 预期图片数（从标题解析） */
  expectedImages: number;
  /** 预期视频数（从标题解析） */
  expectedVideos: number;
  /** 数量是否匹配 */
  matched: boolean;
  /** 是否需要回退爬虫下载 */
  needsFallbackScrape: boolean;
  /** 不匹配原因 */
  reason?: string;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m4v'];

/**
 * 统计解压目录中的文件数量
 *
 * 递归遍历目录，按扩展名分类统计图片和视频文件。
 * 忽略隐藏文件和 macOS 元数据文件（.DS_Store、__MACOSX）。
 *
 * @param extractPath - 解压目录路径
 * @returns { imageCount, videoCount, otherCount, totalCount }
 *
 * @date 2026-07-12
 */
export function countExtractedFiles(extractPath: string): {
  imageCount: number;
  videoCount: number;
  otherCount: number;
  totalCount: number;
} {
  let imageCount = 0;
  let videoCount = 0;
  let otherCount = 0;

  if (!fs.existsSync(extractPath)) {
    return { imageCount: 0, videoCount: 0, otherCount: 0, totalCount: 0 };
  }

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // 跳过 macOS 元数据
      if (entry.name === '.DS_Store' || entry.name === '__MACOSX') continue;
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          imageCount++;
        } else if (VIDEO_EXTENSIONS.includes(ext)) {
          videoCount++;
        } else {
          otherCount++;
        }
      }
    }
  }

  walk(extractPath);

  return {
    imageCount,
    videoCount,
    otherCount,
    totalCount: imageCount + videoCount + otherCount,
  };
}

/**
 * 校验解压后的内容数量是否与标题声明一致
 *
 * 对比规则：
 * - 如果标题声明了预期数量（expectedImages > 0），则实际图片数应 >= 预期
 * - 如果标题声明了预期视频数（expectedVideos > 0），则实际视频数应 >= 预期
 * - 允许实际数量略多于预期（可能包含封面图、预览图等附加内容）
 * - 如果实际数量明显少于预期（差值 > 2），标记需要回退爬虫下载
 *
 * @param extractPath - 解压目录路径
 * @param expectedImages - 标题声明的预期图片数
 * @param expectedVideos - 标题声明的预期视频数
 * @returns 校验结果
 *
 * @date 2026-07-12
 */
export function verifyExtractedContent(
  extractPath: string,
  expectedImages: number,
  expectedVideos: number,
): ContentVerificationResult {
  const counts = countExtractedFiles(extractPath);

  // 如果标题未声明数量，跳过校验
  if (expectedImages === 0 && expectedVideos === 0) {
    return {
      ...counts,
      expectedImages,
      expectedVideos,
      matched: true,
      needsFallbackScrape: false,
    };
  }

  const imageDiff = expectedImages - counts.imageCount;
  const videoDiff = expectedVideos - counts.videoCount;

  // 允许实际数量比预期多（附加内容），但不应少于预期超过 2 个
  const imageMatched = expectedImages === 0 || imageDiff <= 2;
  const videoMatched = expectedVideos === 0 || videoDiff <= 2;

  const matched = imageMatched && videoMatched;
  const needsFallbackScrape = !matched;

  let reason: string | undefined;
  if (!matched) {
    const parts: string[] = [];
    if (!imageMatched) {
      parts.push(`图片不足: 预期 ${expectedImages}，实际 ${counts.imageCount}（差 ${imageDiff}）`);
    }
    if (!videoMatched) {
      parts.push(`视频不足: 预期 ${expectedVideos}，实际 ${counts.videoCount}（差 ${videoDiff}）`);
    }
    reason = parts.join('；');
  }

  return {
    ...counts,
    expectedImages,
    expectedVideos,
    matched,
    needsFallbackScrape,
    reason,
  };
}

/**
 * 检测下载 URL 的来源类型
 *
 * 根据 URL 域名判断下载来源：
 * - ouo.io / ouo.press → ouo 中转站
 * - mediafire.com → MediaFire 直链
 * - 以 .zip/.rar/.7z 结尾 → 直链
 * - 其他 → unknown
 *
 * @date 2026-07-12
 */
export function detectDownloadSource(url: string): 'ouo' | 'mediafire' | 'direct' | 'unknown' {
  if (!url) return 'unknown';

  const lower = url.toLowerCase();
  const hostname = (() => {
    try {
    return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  if (hostname.includes('ouo.io') || hostname.includes('ouo.press')) {
    return 'ouo';
  }

  if (hostname.includes('mediafire.com')) {
    return 'mediafire';
  }

  if (/\.(zip|rar|7z)(\?|$)/i.test(lower)) {
    return 'direct';
  }

  return 'unknown';
}
