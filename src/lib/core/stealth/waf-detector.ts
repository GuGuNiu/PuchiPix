import type * as cheerio from 'cheerio';
import wafSignaturesData from '../../data/waf-signatures.json';

export interface WafDetectionResult {

  blocked: boolean;

  reason: WafBlockReason;

  detail: string;
}

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

export function detectWaf(
  statusCode: number,
  html?: string,
  $?: cheerio.CheerioAPI,
): WafDetectionResult {
  if (statusCode === 403) {
    return {
      blocked: true,
      reason: 'http_403',
      detail: 'HTTP 403 Forbidden (WAF block)',
    };
  }

  if (statusCode === 429) {
    return {
      blocked: true,
      reason: 'http_429',
      detail: 'HTTP 429 Too Many Requests (rate limited)',
    };
  }

  if (statusCode === 503) {
    const content = html || ($?.html() || '');
    if (content && CLOUDFLARE_SIGNATURES.some((sig) => content.toLowerCase().includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: 'HTTP 503 + Cloudflare challenge detected',
      };
    }
    if (content && WAF_SIGNATURES.some((sig) => content.toLowerCase().includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: 'HTTP 503 + WAF signature detected',
      };
    }
  }

  const content = html || ($?.html() || '');
  if (!content) {
    return { blocked: false, reason: 'none', detail: 'No content to analyze' };
  }

  const lowerContent = content.toLowerCase();

  if (CLOUDFLARE_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {

    if (content.length < 15000) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: `HTML contains Cloudflare signature (size=${content.length})`,
      };
    }
  }

  if (CAPTCHA_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    if (content.length < 10000) {
      return {
        blocked: true,
        reason: 'captcha',
        detail: 'HTML contains CAPTCHA signature',
      };
    }
  }

  if (JS_CHALLENGE_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    if (content.length < 8000) {
      return {
        blocked: true,
        reason: 'javascript_challenge',
        detail: 'HTML contains JavaScript challenge',
      };
    }
  }

  if (content.length < 5000) {
    if (WAF_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: 'HTML contains WAF signature',
      };
    }
  }

  if ($) {
    const title = $('title').text().trim().toLowerCase();
    if (title.includes('just a moment') || title.includes('attention required') || title.includes('access denied')) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: `<title>="${title}" indicates WAF block`,
      };
    }

    if ($('script[src*="cloudflare"]').length > 0 || $('script[src*="cf-chl"]').length > 0) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: 'HTML contains Cloudflare challenge script',
      };
    }

    const bodyChildren = $('body').children().length;
    const hasArticle = $('article').length > 0;
    const hasMainContent = $('main, .entry-content, .post-content, #content').length > 0;
    if (bodyChildren <= 3 && !hasArticle && !hasMainContent && content.length < 3000) {
      return {
        blocked: true,
        reason: 'empty_content',
        detail: `Empty content (body children=${bodyChildren}, size=${content.length})`,
      };
    }
  }

  return { blocked: false, reason: 'none', detail: '' };
}

export function shouldFallbackToPlaywright(result: {
  title: string;
  imageCount: number;
  videoCount: number;
  pageCount: number;
}): { fallback: boolean; reason: string } {

  if (result.imageCount === 0 && result.videoCount === 0) {
    return {
      fallback: true,
      reason: `No images or videos found (images=0, videos=0), possible WAF block`,
    };
  }

  if (!result.title || result.title === '404' || result.title.includes('Not Found') || result.title.includes('Error')) {
    return {
      fallback: true,
      reason: `Invalid title: "${result.title}"`,
    };
  }

  if (result.pageCount > 1 && result.imageCount < result.pageCount * 3) {
    return {
      fallback: true,
      reason: `Low image count: ${result.imageCount} images across ${result.pageCount} pages`,
    };
  }

  const expectedCount = parseExpectedImageCount(result.title);
  if (expectedCount > 0 && result.imageCount > 0) {
    const ratio = result.imageCount / expectedCount;

    if (ratio < 0.7) {
      return {
        fallback: true,
        reason: `Image count mismatch: ${result.imageCount} vs expected ${expectedCount}P (${Math.round(ratio * 100)}%), fallback to Playwright`,
      };
    }
  }

  return { fallback: false, reason: '' };
}

/**
 * Parse expected image count from title.
 *
 * Supported formats:
 * - "73P" / "73P+1V" / "73P+2V"
 * - "73 photos" / "73 images"
 *
 * @param title - The gallery title to parse
 * @returns Expected image count, or 0 if not parseable
 */
function parseExpectedImageCount(title: string): number {
  // Match "P" suffix like 73P, 100P
  const pMatch = title.match(/(\d+)\s*[Pp](?![a-zA-Z])/);
  if (pMatch) return parseInt(pMatch[1]);

  const zhangMatch = title.match(/(\d+)\s*[张張]/);
  if (zhangMatch) return parseInt(zhangMatch[1]);

  // Match "photos" or "images"
  const enMatch = title.match(/(\d+)\s*(?:photos|images|pics)/i);
  if (enMatch) return parseInt(enMatch[1]);

  return 0;
}
