import type * as cheerio from 'cheerio';
import wafSignaturesData from '../../data/waf-signatures.json';

/** WAF 妫€娴嬬粨鏋?*/
export interface WafDetectionResult {
  /** 鏄惁琚?WAF 鎷︽埅 */
  blocked: boolean;
  /** 鎷︽埅绫诲瀷 */
  reason: WafBlockReason;
  /** 璇︾粏鍘熷洜鎻忚堪 */
  detail: string;
}

/** WAF 鎷︽埅绫诲瀷 */
export type WafBlockReason =
  | 'cloudflare'
  | 'http_403'
  | 'http_429'
  | 'http_503'
  | 'javascript_challenge'
  | 'captcha'
  | 'empty_content'
  | 'waf_page'
  | 'none';

const CLOUDFLARE_SIGNATURES: readonly string[] = wafSignaturesData.cloudflare;
const WAF_SIGNATURES: readonly string[] = wafSignaturesData.waf;
const CAPTCHA_SIGNATURES: readonly string[] = wafSignaturesData.captcha;
const JS_CHALLENGE_SIGNATURES: readonly string[] = wafSignaturesData.javascript_challenge;

/**
 * 妫€娴?HTTP 鍝嶅簲鏄惁琚?WAF 鎷︽埅
 *
 * 缁煎悎妫€鏌?HTTP 鐘舵€佺爜鍜?HTML 鍐呭锛?
 * 璇嗗埆鍚勭 WAF 鎷︽埅鍦烘櫙銆?
 *
 * @param statusCode - HTTP 鍝嶅簲鐘舵€佺爜
 * @param html - HTML 鍐呭锛堝彲閫夛紝鐢ㄤ簬鍐呭妫€娴嬶級
 * @param $ - cheerio 瀹炰緥锛堝彲閫夛紝鐢ㄤ簬 DOM 妫€娴嬶級
 * @returns WAF 妫€娴嬬粨鏋?
 *
 */
export function detectWaf(
  statusCode: number,
  html?: string,
  $?: cheerio.CheerioAPI,
): WafDetectionResult {
  if (statusCode === 403) {
    return {
      blocked: true,
      reason: 'http_403',
      detail: 'HTTP 403 Forbidden 鈥?WAF 鐩存帴鎷掔粷',
    };
  }

  if (statusCode === 429) {
    return {
      blocked: true,
      reason: 'http_429',
      detail: 'HTTP 429 Too Many Requests 鈥?瑙﹀彂闄愰€?,
    };
  }

  if (statusCode === 503) {
    // 503 鍙兘鏄?Cloudflare challenge 鎴栨湇鍔＄淮鎶?
    const content = html || ($?.html() || '');
    if (content && CLOUDFLARE_SIGNATURES.some((sig) => content.toLowerCase().includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: 'HTTP 503 + Cloudflare 楠岃瘉椤甸潰',
      };
    }
    // 503 浣嗘棤 Cloudflare 鐗瑰緛锛屼粛鍙兘鏄复鏃舵嫤鎴?
    if (content && WAF_SIGNATURES.some((sig) => content.toLowerCase().includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: 'HTTP 503 + WAF 鎷︽埅椤甸潰',
      };
    }
  }

  const content = html || ($?.html() || '');
  if (!content) {
    return { blocked: false, reason: 'none', detail: '鏃犲唴瀹瑰彲妫€娴? };
  }

  const lowerContent = content.toLowerCase();

  // Cloudflare 妫€娴?
  if (CLOUDFLARE_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    // 浣嗚鎺掗櫎姝ｅ父鐨?cf-ray 澶村嚭鐜板湪姝ｅ父椤甸潰涓殑鎯呭喌
    // 鍙湪椤甸潰寰堝皬锛? 10KB锛変笖鐗瑰緛鏄庢樉鏃舵墠鍒ゅ畾
    if (content.length < 15000) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: `HTML 鍐呭鍖呭惈 Cloudflare 鐗瑰緛 (size=${content.length})`,
      };
    }
  }

  // CAPTCHA 妫€娴?
  if (CAPTCHA_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    // CAPTCHA 鍏抽敭璇嶅湪寰堢煭鐨勯〉闈腑鎵嶅垽瀹?
    if (content.length < 10000) {
      return {
        blocked: true,
        reason: 'captcha',
        detail: 'HTML 鍖呭惈 CAPTCHA 楠岃瘉鐗瑰緛',
      };
    }
  }

  // JavaScript challenge 妫€娴?
  if (JS_CHALLENGE_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    if (content.length < 8000) {
      return {
        blocked: true,
        reason: 'javascript_challenge',
        detail: 'HTML 瑕佹眰鍚敤 JavaScript 鈥?鍙兘鏄?JS 鎸戞垬椤甸潰',
      };
    }
  }

  // 閫氱敤 WAF 鎷︽埅椤甸潰妫€娴?
  if (content.length < 5000) {
    if (WAF_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: 'HTML 鍐呭鍖呭惈 WAF 鎷︽埅鐗瑰緛',
      };
    }
  }

  if ($) {
    const title = $('title').text().trim().toLowerCase();
    if (title.includes('just a moment') || title.includes('attention required') || title.includes('access denied')) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: `<title>="${title}" 鈥?WAF 鎷︽埅椤甸潰`,
      };
    }

    if ($('script[src*="cloudflare"]').length > 0 || $('script[src*="cf-chl"]').length > 0) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: 'HTML 鍖呭惈 Cloudflare challenge script',
      };
    }

    const bodyChildren = $('body').children().length;
    const hasArticle = $('article').length > 0;
    const hasMainContent = $('main, .entry-content, .post-content, #content').length > 0;
    if (bodyChildren <= 3 && !hasArticle && !hasMainContent && content.length < 3000) {
      return {
        blocked: true,
        reason: 'empty_content',
        detail: `椤甸潰鍐呭鏋佸皯 (body children=${bodyChildren}, size=${content.length}) 鈥?鍙兘鏄嫤鎴〉闈,
      };
    }
  }

  return { blocked: false, reason: 'none', detail: '姝ｅ父' };
}

/**
 * 璇勪及鐖彇缁撴灉鐨勫唴瀹硅川閲?
 *
 * 鍒ゆ柇 HTTP 鐖彇鐨勭粨鏋滄槸鍚?瓒冲濂?锛?
 * 杩樻槸搴旇闄嶇骇鍒?Playwright 閲嶈瘯銆?
 *
 * @param result - 鐖彇缁撴灉
 * @returns 鏄惁搴旇闄嶇骇鍒?Playwright
 *
 */
export function shouldFallbackToPlaywright(result: {
  title: string;
  imageCount: number;
  videoCount: number;
  pageCount: number;
}): { fallback: boolean; reason: string } {
  // 瀹屽叏娌℃湁鍥剧墖鍜岃棰?
  if (result.imageCount === 0 && result.videoCount === 0) {
    return {
      fallback: true,
      reason: `鍐呭涓虹┖ (images=0, videos=0) 鈥?鍙兘琚?WAF 鎷︽埅鎴栭〉闈㈢粨鏋勫彉鍖朻,
    };
  }

  // 鏍囬涓虹┖鎴栫湅璧锋潵鍍忛敊璇〉闈?
  if (!result.title || result.title === '404' || result.title.includes('Not Found') || result.title.includes('Error')) {
    return {
      fallback: true,
      reason: `鏍囬寮傚父: "${result.title}"`,
    };
  }

  // 澶氶〉鍥惧簱浣嗗浘鐗囨暟杩囧皯锛堝皯浜庨〉鏁?脳 3锛岃鏄庡ぇ閮ㄥ垎椤甸潰瑙ｆ瀽澶辫触锛?
  if (result.pageCount > 1 && result.imageCount < result.pageCount * 3) {
    return {
      fallback: true,
      reason: `鍥剧墖鏁?${result.imageCount} 瀵逛簬 ${result.pageCount} 椤靛浘搴撹繃灏?鈥?鍙兘閮ㄥ垎椤甸潰琚嫤鎴猔,
    };
  }

  // 浠庢爣棰樹腑瑙ｆ瀽棰勬湡鍥剧墖鏁帮紙濡?"73P" "73P+1V" "73寮? 绛夛級
  const expectedCount = parseExpectedImageCount(result.title);
  if (expectedCount > 0 && result.imageCount > 0) {
    const ratio = result.imageCount / expectedCount;
    // 瀹為檯鍥剧墖鏁颁笉瓒抽鏈熺殑 70%锛屽彲鑳戒涪澶变簡閮ㄥ垎椤甸潰
    if (ratio < 0.7) {
      return {
        fallback: true,
        reason: `鍥剧墖鏁?${result.imageCount} 杩滃皯浜庢爣棰樻爣娉ㄧ殑 ${expectedCount}P (${Math.round(ratio * 100)}%) 鈥?闄嶇骇鍒?Playwright 琛ュ叏`,
      };
    }
  }

  return { fallback: false, reason: '鍐呭璐ㄩ噺姝ｅ父' };
}

/**
 * 浠庢爣棰樹腑瑙ｆ瀽棰勬湡鍥剧墖鏁伴噺
 *
 * 鏀寔鏍煎紡锛?
 * - "73P" / "73P+1V" / "73P+2V"
 * - "73寮? / "73鍥?
 * - "73 photos" / "73 images"
 *
 * @param title - 鍥惧簱鏍囬
 * @returns 棰勬湡鍥剧墖鏁帮紙0 琛ㄧず鏃犳硶瑙ｆ瀽锛?
 *
 */
function parseExpectedImageCount(title: string): number {
  // 鍖归厤 "鏁板瓧P" 鏍煎紡锛堝 73P, 100P锛?
  const pMatch = title.match(/(\d+)\s*[Pp](?![a-zA-Z])/);
  if (pMatch) return parseInt(pMatch[1]);

  // 鍖归厤 "鏁板瓧寮? 鎴?"鏁板瓧鍥? 鏍煎紡
  const zhangMatch = title.match(/(\d+)\s*[寮犲紶]/);
  if (zhangMatch) return parseInt(zhangMatch[1]);

  // 鍖归厤 "鏁板瓧 photos" 鎴?"鏁板瓧 images" 鏍煎紡
  const enMatch = title.match(/(\d+)\s*(?:photos|images|pics)/i);
  if (enMatch) return parseInt(enMatch[1]);

  return 0;
}
