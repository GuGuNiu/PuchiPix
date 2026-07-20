import fs from 'fs';
import path from 'path';
import { getPinyinService } from '@/lib/core/pinyin-service';

/**
 *
 *
 * @returns { expectedImages, expectedVideos }
 *
 */
export function parseTitleCount(title: string): { expectedImages: number; expectedVideos: number } {
  if (!title) return { expectedImages: 0, expectedVideos: 0 };

  const match = title.match(/(\d+)P\s*(?:(\d+)V)?\s*(?:(\d+)G)?\s*$/i);

  if (!match) return { expectedImages: 0, expectedVideos: 0 };

  const images = parseInt(match[1], 10) || 0;
  const videos = parseInt(match[2] || '0', 10) || 0;
  const gifs = parseInt(match[3] || '0', 10) || 0;

  return {
    expectedImages: images + gifs,
    expectedVideos: videos,
  };
}


const CJK_ROMAN_MAP: Record<string, string> = {
  '可': 'ke', '小': 'xiao', '白': 'bai', '兔': 'tu',
  '美': 'mei', '女': 'nv', '妹': 'mei', '子': 'zi',
  '爱': 'ai', '花': 'hua', '樱': 'ying', '雪': 'xue',
  '月': 'yue', '星': 'xing', '梦': 'meng', '心': 'xin',
  '猫': 'mao', '犬': 'quan',
  '狐': 'hu', '龙': 'long', '凤': 'feng', '鸟': 'niao',
  '蝶': 'die', '鱼': 'yu', '熊': 'xiong', '鹿': 'lu',
  '蓝': 'lan', '红': 'hong', '紫': 'zi', '绿': 'lv',
  '黑': 'hei', '金': 'jin', '银': 'yin', '玉': 'yu',
  '天': 'tian', '海': 'hai', '山': 'shan', '风': 'feng',
  '云': 'yun', '雨': 'yu', '光': 'guang', '影': 'ying',
  '夜': 'ye', '日': 'ri', '春': 'chun', '夏': 'xia',
  '秋': 'qiu', '冬': 'dong', '冰': 'bing', '火': 'huo',
  '水': 'shui', '土': 'tu', '木': 'mu', '石': 'shi',
  '少': 'shao', '年': 'nian', '姐': 'jie',
  '娘': 'niang', '娃': 'wa', '宝': 'bao', '贝': 'bei',
  '仙': 'xian', '灵': 'ling', '妖': 'yao', '魔': 'mo',
  '神': 'shen', '圣': 'sheng', '王': 'wang', '后': 'hou',
  '公': 'gong', '主': 'zhu', '皇': 'huang', '帝': 'di',
  '一': 'yi', '二': 'er', '三': 'san', '四': 'si',
  '五': 'wu', '六': 'liu', '七': 'qi', '八': 'ba',
  '九': 'jiu', '十': 'shi',
};


function cjkToRoman(text: string): string {
  if (!text) return '';

  const py = getPinyinService().convert(text, { type: 'array' });
  const pyStr = Array.isArray(py) ? py.join('') : py;
  const result = pyStr.replace(/\s+/g, '_');
  if (result && /[a-zA-Z]/.test(result)) {
    return result.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  }

  let fallback = '';
  for (const char of text) {
    if (CJK_ROMAN_MAP[char]) {
      fallback += CJK_ROMAN_MAP[char];
    } else if (/[a-zA-Z0-9]/.test(char)) {
      fallback += char;
    } else if (/[\s\-_]/.test(char)) {
      fallback += '_';
    }
  }
  return fallback.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 *
 *
 *   → "keke_xiaobaitu_27571.zip"
 *   → "alice_cosplay_set_123.zip"
 *
 *
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
    const cleanDesc = description.replace(/\s*\d+P\d*V?\s*$/i, '').trim();
    if (cleanDesc) {
      const roman = cjkToRoman(cleanDesc);
      if (roman) parts.push(roman);
    }
  }

  parts.push(String(galleryId));

  const baseName = parts.join('_').toLowerCase().replace(/_+/g, '_');

  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;

  return `${baseName}${normalizedExt}`;
}

export interface ContentVerificationResult {
  imageCount: number;
  videoCount: number;
  otherCount: number;
  totalCount: number;
  expectedImages: number;
  expectedVideos: number;
  /** AmountisnoMatch */
  matched: boolean;
  needsFallbackScrape: boolean;
  reason?: string;
}

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m4v'];

/**
 *
 *
 * @param extractPath - DecompressdirectoryPath
 * @returns { imageCount, videoCount, otherCount, totalCount }
 *
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

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
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
 *
 *
 * @param extractPath - DecompressdirectoryPath
 * @returns Verification result
 *
 */
export function verifyExtractedContent(
  extractPath: string,
  expectedImages: number,
  expectedVideos: number,
): ContentVerificationResult {
  const counts = countExtractedFiles(extractPath);

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

  const imageMatched = expectedImages === 0 || imageDiff <= 2;
  const videoMatched = expectedVideos === 0 || videoDiff <= 2;

  const matched = imageMatched && videoMatched;
  const needsFallbackScrape = !matched;

  let reason: string | undefined;
  if (!matched) {
    const parts: string[] = [];
    if (!imageMatched) {
      parts.push(`图片不足: 预期 ${expectedImages}实际 ${counts.imageCount}差 ${imageDiff}`);
    }
    if (!videoMatched) {
      parts.push(`视频不足: 预期 ${expectedVideos}实际 ${counts.videoCount}差 ${videoDiff}`);
    }
    reason = parts.join('');
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
 *
 * - other → unknown
 *
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
