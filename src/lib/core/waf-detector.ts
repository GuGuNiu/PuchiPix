import type * as cheerio from 'cheerio';

/** WAF 检测结果 */
export interface WafDetectionResult {
  /** 是否被 WAF 拦截 */
  blocked: boolean;
  /** 拦截类型 */
  reason: WafBlockReason;
  /** 详细原因描述 */
  detail: string;
}

/** WAF 拦截类型 */
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

/** Cloudflare 验证页面特征关键词 */
const CLOUDFLARE_SIGNATURES = [
  'cf-browser-verification',
  'cf-challenge-running',
  'cloudflare',
  'Checking your browser before accessing',
  'Just a moment',
  '_cf_chl_opt',
  'cf-mitigated',
  'ray ID',
  'cf-ray',
];

/** 通用 WAF 拦截页面特征 */
const WAF_SIGNATURES = [
  'access denied',
  '请求被拦截',
  '您的请求被拦截',
  'blocked by security',
  'security check',
  '安全检查',
  ' firewall',
  'rate limit',
  'too many requests',
  '请求过于频繁',
  'Access to this page has been denied',
  'Incapsula incident',
  'Sucuri WebSite Firewall',
  'blocked by protection',
];

/** CAPTCHA 验证页面特征 */
const CAPTCHA_SIGNATURES = [
  'captcha',
  'recaptcha',
  'hcaptcha',
  'geetest',
  'verify you are human',
  '请完成验证',
  '人机验证',
  'g-recaptcha',
  'h-captcha',
];

/** JavaScript challenge 特征 */
const JS_CHALLENGE_SIGNATURES = [
  '请启用 JavaScript',
  'enable javascript',
  'requires javascript',
  'noscript',
  'javascript is disabled',
  'needs javascript',
];

/**
 * 检测 HTTP 响应是否被 WAF 拦截
 *
 * 综合检查 HTTP 状态码和 HTML 内容，
 * 识别各种 WAF 拦截场景。
 *
 * @param statusCode - HTTP 响应状态码
 * @param html - HTML 内容（可选，用于内容检测）
 * @param $ - cheerio 实例（可选，用于 DOM 检测）
 * @returns WAF 检测结果
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
      detail: 'HTTP 403 Forbidden — WAF 直接拒绝',
    };
  }

  if (statusCode === 429) {
    return {
      blocked: true,
      reason: 'http_429',
      detail: 'HTTP 429 Too Many Requests — 触发限速',
    };
  }

  if (statusCode === 503) {
    // 503 可能是 Cloudflare challenge 或服务维护
    const content = html || ($?.html() || '');
    if (content && CLOUDFLARE_SIGNATURES.some((sig) => content.toLowerCase().includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: 'HTTP 503 + Cloudflare 验证页面',
      };
    }
    // 503 但无 Cloudflare 特征，仍可能是临时拦截
    if (content && WAF_SIGNATURES.some((sig) => content.toLowerCase().includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: 'HTTP 503 + WAF 拦截页面',
      };
    }
  }

  const content = html || ($?.html() || '');
  if (!content) {
    return { blocked: false, reason: 'none', detail: '无内容可检测' };
  }

  const lowerContent = content.toLowerCase();

  // Cloudflare 检测
  if (CLOUDFLARE_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    // 但要排除正常的 cf-ray 头出现在正常页面中的情况
    // 只在页面很小（< 10KB）且特征明显时才判定
    if (content.length < 15000) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: `HTML 内容包含 Cloudflare 特征 (size=${content.length})`,
      };
    }
  }

  // CAPTCHA 检测
  if (CAPTCHA_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    // CAPTCHA 关键词在很短的页面中才判定
    if (content.length < 10000) {
      return {
        blocked: true,
        reason: 'captcha',
        detail: 'HTML 包含 CAPTCHA 验证特征',
      };
    }
  }

  // JavaScript challenge 检测
  if (JS_CHALLENGE_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
    if (content.length < 8000) {
      return {
        blocked: true,
        reason: 'javascript_challenge',
        detail: 'HTML 要求启用 JavaScript — 可能是 JS 挑战页面',
      };
    }
  }

  // 通用 WAF 拦截页面检测
  if (content.length < 5000) {
    if (WAF_SIGNATURES.some((sig) => lowerContent.includes(sig.toLowerCase()))) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: 'HTML 内容包含 WAF 拦截特征',
      };
    }
  }

  if ($) {
    // 检查 <title> 是否为拦截页面标题
    const title = $('title').text().trim().toLowerCase();
    if (title.includes('just a moment') || title.includes('attention required') || title.includes('access denied')) {
      return {
        blocked: true,
        reason: 'waf_page',
        detail: `<title>="${title}" — WAF 拦截页面`,
      };
    }

    // 检查是否有 Cloudflare 的 script 标签
    if ($('script[src*="cloudflare"]').length > 0 || $('script[src*="cf-chl"]').length > 0) {
      return {
        blocked: true,
        reason: 'cloudflare',
        detail: 'HTML 包含 Cloudflare challenge script',
      };
    }

    // 检查 body 是否只有很少的元素（拦截页面通常很简单）
    const bodyChildren = $('body').children().length;
    const hasArticle = $('article').length > 0;
    const hasMainContent = $('main, .entry-content, .post-content, #content').length > 0;
    if (bodyChildren <= 3 && !hasArticle && !hasMainContent && content.length < 3000) {
      return {
        blocked: true,
        reason: 'empty_content',
        detail: `页面内容极少 (body children=${bodyChildren}, size=${content.length}) — 可能是拦截页面`,
      };
    }
  }

  return { blocked: false, reason: 'none', detail: '正常' };
}

/**
 * 评估爬取结果的内容质量
 *
 * 判断 HTTP 爬取的结果是否"足够好"，
 * 还是应该降级到 Playwright 重试。
 *
 * @param result - 爬取结果
 * @returns 是否应该降级到 Playwright
 *
 */
export function shouldFallbackToPlaywright(result: {
  title: string;
  imageCount: number;
  videoCount: number;
  pageCount: number;
}): { fallback: boolean; reason: string } {
  // 完全没有图片和视频
  if (result.imageCount === 0 && result.videoCount === 0) {
    return {
      fallback: true,
      reason: `内容为空 (images=0, videos=0) — 可能被 WAF 拦截或页面结构变化`,
    };
  }

  // 标题为空或看起来像错误页面
  if (!result.title || result.title === '404' || result.title.includes('Not Found') || result.title.includes('Error')) {
    return {
      fallback: true,
      reason: `标题异常: "${result.title}"`,
    };
  }

  // 多页图库但图片数过少（少于页数 × 3，说明大部分页面解析失败）
  if (result.pageCount > 1 && result.imageCount < result.pageCount * 3) {
    return {
      fallback: true,
      reason: `图片数 ${result.imageCount} 对于 ${result.pageCount} 页图库过少 — 可能部分页面被拦截`,
    };
  }

  // 从标题中解析预期图片数（如 "73P" "73P+1V" "73张" 等）
  const expectedCount = parseExpectedImageCount(result.title);
  if (expectedCount > 0 && result.imageCount > 0) {
    const ratio = result.imageCount / expectedCount;
    // 实际图片数不足预期的 70%，可能丢失了部分页面
    if (ratio < 0.7) {
      return {
        fallback: true,
        reason: `图片数 ${result.imageCount} 远少于标题标注的 ${expectedCount}P (${Math.round(ratio * 100)}%) — 降级到 Playwright 补全`,
      };
    }
  }

  return { fallback: false, reason: '内容质量正常' };
}

/**
 * 从标题中解析预期图片数量
 *
 * 支持格式：
 * - "73P" / "73P+1V" / "73P+2V"
 * - "73张" / "73图"
 * - "73 photos" / "73 images"
 *
 * @param title - 图库标题
 * @returns 预期图片数（0 表示无法解析）
 *
 */
function parseExpectedImageCount(title: string): number {
  // 匹配 "数字P" 格式（如 73P, 100P）
  const pMatch = title.match(/(\d+)\s*[Pp](?![a-zA-Z])/);
  if (pMatch) return parseInt(pMatch[1]);

  // 匹配 "数字张" 或 "数字图" 格式
  const zhangMatch = title.match(/(\d+)\s*[张张]/);
  if (zhangMatch) return parseInt(zhangMatch[1]);

  // 匹配 "数字 photos" 或 "数字 images" 格式
  const enMatch = title.match(/(\d+)\s*(?:photos|images|pics)/i);
  if (enMatch) return parseInt(enMatch[1]);

  return 0;
}
