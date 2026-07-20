

import { getSiteAccountManager } from '../site-account-manager';
import { loggers } from '@/lib/core/infra/logger';
import { DomainHealthTracker } from '@/lib/core/domain/domain-health-tracker';
import { logT } from '@/lib/i18n/server';
import { gaussianDelay, backoffDelay } from '@/lib/core/stealth/anti-crawler';
import {

  SITE_DOMAINS,
  CookieJar,
  type CheckinResult,
} from './types';
import {
  extractInputValue,
  extractAnchorHref,
  httpRequest,
} from './http-utils';

const logger = loggers.sjsCheckin();
const domainHealthTracker = new DomainHealthTracker();

/** Check-inserviceconfig */
interface CheckinServiceConfig {
  /** Max retrycount */
  maxRetries: number;
  /** BaseDelay(ms) */
  baseDelay: number;
  /** MaxDelay(ms) */
  maxDelay: number;
  /** Request timeout(ms) */
  timeout: number;
  /** IsnoenabledrandomUA */
  enableRandomUA: boolean;
  enableJitter: boolean;
}

/** Defaultconfig */
const DEFAULT_CONFIG: CheckinServiceConfig = {
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 10000,
  timeout: 30000,
  enableRandomUA: true,
  enableJitter: true,
};

type AntiCrawlerType =
  | 'cloudflare_challenge'
  | 'rate_limit'
  | 'ip_block'
  | 'captcha'
  | 'waf_block'
  | 'none';

/** DefenseDetectresult */
interface AntiCrawlerDetection {
  detected: boolean;
  type: AntiCrawlerType;
  detail: string;
  shouldRetry: boolean;
  retryAfter?: number;
}


function detectAntiCrawler(html: string, statusCode: number): AntiCrawlerDetection {
  const lowerHtml = html.toLowerCase();

  if (
    lowerHtml.includes('cf-challenge') ||
    lowerHtml.includes('cloudflare') ||
    lowerHtml.includes('__cf_bm') ||
    lowerHtml.includes('turnstile') ||
    lowerHtml.includes('checking your browser')
  ) {
    return {
      detected: true,
      type: 'cloudflare_challenge',
      detail: '检测到 Cloudflare 人机验证',
      shouldRetry: true,
      retryAfter: 5000,
    };
  }

  if (
    statusCode === 429 ||
    lowerHtml.includes('rate limit') ||
    lowerHtml.includes('too many requests') ||
    lowerHtml.includes('请求过于频繁')
  ) {
    return {
      detected: true,
      type: 'rate_limit',
      detail: '检测到请求频率限制',
      shouldRetry: true,
      retryAfter: 60000,
    };
  }

  if (
    statusCode === 403 ||
    lowerHtml.includes('ip blocked') ||
    lowerHtml.includes('ip被封') ||
    lowerHtml.includes('access denied')
  ) {
    return {
      detected: true,
      type: 'ip_block',
      detail: '检测到 IP 被封禁',
      shouldRetry: false,
    };
  }

  if (
    lowerHtml.includes('captcha') ||
    lowerHtml.includes('验证码') ||
    lowerHtml.includes('recaptcha') ||
    lowerHtml.includes('hcaptcha')
  ) {
    return {
      detected: true,
      type: 'captcha',
      detail: '检测到验证码要求',
      shouldRetry: false,
    };
  }

  if (
    lowerHtml.includes('waf') ||
    lowerHtml.includes('防火墙') ||
    lowerHtml.includes('security check')
  ) {
    return {
      detected: true,
      type: 'waf_block',
      detail: '检测到 WAF 拦截',
      shouldRetry: true,
      retryAfter: 30000,
    };
  }

  return {
    detected: false,
    type: 'none',
    detail: '未检测到反爬防御',
    shouldRetry: false,
  };
}


async function getRequestContext(accountId: number): Promise<
  | {
      cookieJar: CookieJar;
      domain: string;
    }
  | null
> {
  const accountManager = getSiteAccountManager();
  const cookies = await accountManager.getAuthCookies(accountId);
  if (!cookies || cookies.length === 0) return null;

  const domain = domainHealthTracker.getBestDomain(SITE_DOMAINS);
  const cookieJar = new CookieJar();
  cookieJar.loadFromCookies(cookies);

  return { cookieJar, domain };
}


export async function performCheckinWithRetry(
  accountId: number,
  config: Partial<CheckinServiceConfig> = {},
): Promise<CheckinResult & { attempts: number; antiCrawlerDetections: AntiCrawlerDetection[] }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const antiCrawlerDetections: AntiCrawlerDetection[] = [];

  for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
    try {
      // Exponential backoffDelay
      if (attempt > 0) {
        const delay = backoffDelay(attempt - 1, cfg.baseDelay, cfg.maxDelay);
        logger.infoT('log.sjs.checkinRetry', { attempt: attempt + 1, delay });
        await new Promise((r) => setTimeout(r, delay));
      }

      const result = await performCheckinEnhanced(accountId, cfg);

      return {
        ...result,
        attempts: attempt + 1,
        antiCrawlerDetections,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      const detection = detectAntiCrawler(errorMsg, 0);
      if (detection.detected) {
        antiCrawlerDetections.push(detection);
        logger.warnT('log.sjs.antiCrawlerDetected', {
          type: detection.type,
          detail: detection.detail,
        });

        if (!detection.shouldRetry || attempt === cfg.maxRetries - 1) {
          return {
            success: false,
            alreadyCheckedIn: false,
            message: `被反爬防御拦截: ${detection.detail}`,
            attempts: attempt + 1,
            antiCrawlerDetections,
          };
        }

        if (detection.retryAfter) {
          await new Promise((r) => setTimeout(r, detection.retryAfter));
        }

        continue;
      }

      // OtherError，ContinueRetry
      if (attempt === cfg.maxRetries - 1) {
        return {
          success: false,
          alreadyCheckedIn: false,
          message: `签到失败: ${errorMsg}`,
          attempts: attempt + 1,
          antiCrawlerDetections,
        };
      }
    }
  }

  return {
    success: false,
    alreadyCheckedIn: false,
    message: '达到最大重试次数',
    attempts: cfg.maxRetries,
    antiCrawlerDetections,
  };
}


async function performCheckinEnhanced(
  accountId: number,
  config: CheckinServiceConfig,
): Promise<CheckinResult> {
  const ctx = await getRequestContext(accountId);
  if (!ctx) {
    return {
      success: false,
      alreadyCheckedIn: false,
      message: '未找到有效的登录凭证，请先登录',
    };
  }

  const { cookieJar, domain } = ctx;
  const signPageUrl = `${domain}/k_misign-sign.html`;

  if (config.enableJitter) {
    const jitter = gaussianDelay(500, 200);
    await new Promise((r) => setTimeout(r, jitter));
  }

  const { text: signPageText, setCookieHeaders: cookies1 } = await httpRequest(
    signPageUrl,
    { cookieJar, referer: `${domain}/` },
  );
  cookieJar.parseSetCookie(cookies1);

  const detection = detectAntiCrawler(signPageText, 200);
  if (detection.detected) {
    domainHealthTracker.markRateLimited(domain);
    throw new Error(detection.detail);
  }

  const signHref = extractAnchorHref(signPageText, 'JD_sign');

  if (
    !signHref ||
    signPageText.includes('您今天已经签到') ||
    signPageText.includes('今日已签到') ||
    signPageText.includes('已签到')
  ) {
    if (
      signPageText.includes('您今天已经签到') ||
      signPageText.includes('今日已签到') ||
      signPageText.includes('已签到')
    ) {
      return parseCheckinResult(signPageText, true);
    }

    // Mayisnot loginState
    if (signHref && signHref.includes('logging')) {
      return {
        success: false,
        alreadyCheckedIn: false,
        message: '登录已过期，请重新登录',
      };
    }

    return {
      success: false,
      alreadyCheckedIn: false,
      message: '未找到签到链接，请检查登录状态',
    };
  }

  logger.infoT('log.sjs.signLink', { href: signHref });

  // Build completecheck-inURL
  const checkInUrl = signHref.startsWith('http')
    ? signHref
    : signHref.startsWith('/')
      ? `${domain}${signHref}`
      : `${domain}/${signHref}`;

  const { text: checkInText, setCookieHeaders: cookies2 } = await httpRequest(
    checkInUrl,
    { cookieJar, referer: signPageUrl },
  );
  cookieJar.parseSetCookie(cookies2);

  if (
    checkInText.includes('签到成功') ||
    checkInText.includes('您今天已经签到') ||
    checkInText.includes('今日已签到') ||
    checkInText.includes('已签到')
  ) {
    const { text: afterText } = await httpRequest(signPageUrl, {
      cookieJar,
      referer: `${domain}/`,
    });

    domainHealthTracker.markHealthy(domain);
    return parseCheckinResult(afterText, true);
  }

  if (checkInText.includes('CDATA')) {
    const { text: afterText } = await httpRequest(signPageUrl, {
      cookieJar,
      referer: `${domain}/`,
    });

    if (
      afterText.includes('签到成功') ||
      afterText.includes('您今天已经签到') ||
      afterText.includes('今日已签到')
    ) {
      domainHealthTracker.markHealthy(domain);
      return parseCheckinResult(afterText, true);
    }
  }

  domainHealthTracker.markRateLimited(domain);
  return {
    success: false,
    alreadyCheckedIn: false,
    message: `签到失败: ${checkInText.slice(0, 200)}`,
  };
}

/**
 * Parsecheck-inresult
 */
function parseCheckinResult(html: string, alreadyCheckedIn: boolean): CheckinResult {
  // ExtracthideFieldValue
  const rank = extractInputValue(html, 'qiandaobtnnum') || undefined;
  const level = extractInputValue(html, 'lxlevel') || undefined;
  const continuousDays = extractInputValue(html, 'lxdays') || undefined;
  const totalDays = extractInputValue(html, 'lxtdays') || undefined;
  const reward = extractInputValue(html, 'lxreward') || undefined;

  const pointsRegex = /(\d+)\s*车票/;
  const pointsMatch = html.match(pointsRegex);
  const totalPoints = pointsMatch ? pointsMatch[1] : undefined;

  const todayCountRegex = /今日已签到[\s\S]*?(\d+)[\s\S]*?人/;
  const todayCountMatch = html.match(todayCountRegex);
  const todayCount = todayCountMatch ? todayCountMatch[1] : undefined;

  return {
    success: true,
    alreadyCheckedIn,
    message: alreadyCheckedIn ? '今日已签到' : '签到成功',
    rank,
    level: level ? `Lv.${level}` : undefined,
    continuousDays,
    totalDays,
    reward,
    totalPoints,
    todayCount,
  };
}


export async function checkinAllAccountsEnhanced(
  config: Partial<CheckinServiceConfig> = {},
): Promise<
  Array<{
    accountId: number;
    username: string;
    result: CheckinResult & { attempts: number; antiCrawlerDetections: AntiCrawlerDetection[] };
  }>
> {
  const accountManager = getSiteAccountManager();
  const accounts = await accountManager.getAccountsBySiteId('sjs');

  const results: Array<{
    accountId: number;
    username: string;
    result: CheckinResult & { attempts: number; antiCrawlerDetections: AntiCrawlerDetection[] };
  }> = [];

  for (const account of accounts) {
    if (account.status !== 'active') {
      results.push({
        accountId: account.id,
        username: account.username,
        result: {
          success: false,
          alreadyCheckedIn: false,
          message: `账户状态为 ${account.status}，跳过签到`,
          attempts: 0,
          antiCrawlerDetections: [],
        },
      });
      continue;
    }

    logger.infoT('log.sjs.startSign', { username: account.username });

    const result = await performCheckinWithRetry(account.id, config);

    await accountManager.markUsed(account.id).catch(() => {});

    results.push({
      accountId: account.id,
      username: account.username,
      result,
    });

    if (results.length < accounts.length) {
      const delay = gaussianDelay(3000, 1000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return results;
}


export function getAntiCrawlerReport(): {
  rateLimitedDomains: Array<{ domain: string; remainingMs: number }>;
  totalCooldownMs: number;
} {
  const rateLimitedDomains = domainHealthTracker.getRateLimitedDomains();
  const totalCooldownMs = rateLimitedDomains.reduce((sum, d) => sum + d.remainingMs, 0);

  return {
    rateLimitedDomains,
    totalCooldownMs,
  };
}

export type { CheckinServiceConfig, AntiCrawlerDetection, AntiCrawlerType };
