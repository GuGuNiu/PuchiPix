import { getSiteAccountManager } from '../site-account-manager';
import { DomainHealthTracker } from '@/lib/core/domain-health-tracker';
import { logT } from '@/lib/i18n/server';
import {
  SITE_DOMAINS,
  CookieJar,
  type CheckinResult,
  type BuyResult,
  type LoginResult,
} from './types';
export type { CheckinResult, BuyResult, LoginResult } from './types';
import {
  getRandomString,
  md5,
  extractInputValue,
  extractAnchorHref,
  extractElementText,
  extractClassContent,
  httpRequest,
} from './http-utils';

/** 域名健康度跟踪器 */
const domainHealthTracker = new DomainHealthTracker();

/**
 * HTTP 快速登录（无需 Playwright）。
 */
export async function httpLogin(
  username: string,
  password: string,
  domain?: string,
): Promise<LoginResult> {
  const targetDomain = domain || domainHealthTracker.getBestDomain(SITE_DOMAINS);
  const cookieJar = new CookieJar();

  try {
    const referer = `${targetDomain}/home.php?mod=space`;
    const { text: homeText, setCookieHeaders: homeCookies } = await httpRequest(
      referer,
      { cookieJar, referer: `${targetDomain}/` },
    );
    cookieJar.parseSetCookie(homeCookies);

    const formhash = extractInputValue(homeText, 'formhash');
    if (!formhash) {
      return {
        success: false,
        message: '无法提取 formhash，页面可能需要验证码或域名不可用',
      };
    }

    console.log(logT('log.sjs.gotFormhash', { value: formhash }));

    const loginUrl = `${targetDomain}/member.php?mod=logging&action=login&loginsubmit=yes&handlekey=login&loginhash=L${getRandomString(4)}&inajax=1`;
    const passwordMd5 = md5(password);

    const body = new URLSearchParams({
      formhash,
      referer: `${targetDomain}/home.php?mod=space`,
      username,
      password: passwordMd5,
      questionid: '0',
      answer: '',
    });

    const { text: loginText, setCookieHeaders: loginCookies } = await httpRequest(
      loginUrl,
      {
        method: 'POST',
        body,
        cookieJar,
        referer: `${targetDomain}/home.php?mod=space`,
      },
    );
    cookieJar.parseSetCookie(loginCookies);

    if (loginText.includes('欢迎您回来')) {
      const cookies = cookieJar.toCookieData(targetDomain);
      console.log(logT('log.sjs.httpLoginSuccess', { count: cookies.length }));
      domainHealthTracker.markHealthy(targetDomain);

      return {
        success: true,
        message: '登录成功',
        cookies,
        domain: targetDomain,
      };
    }

    domainHealthTracker.markRateLimited(targetDomain);
    const errorMsg = loginText.includes('密码错误')
      ? '密码错误'
      : loginText.includes('用户名')
        ? '用户名不存在'
        : `登录失败: ${loginText.slice(0, 200)}`;

    return { success: false, message: errorMsg };
  } catch (err) {
    domainHealthTracker.markRateLimited(targetDomain);
    return {
      success: false,
      message: `HTTP 登录异常: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 使用已有 Cookie 进行 HTTP 请求（验证登录态）。
 */
async function getRequestContext(
  accountId: number,
): Promise<{ cookieJar: CookieJar; domain: string } | null> {
  const accountManager = getSiteAccountManager();
  const cookies = await accountManager.getAuthCookies(accountId);
  if (!cookies || cookies.length === 0) return null;

  const domain = domainHealthTracker.getBestDomain(SITE_DOMAINS);
  const cookieJar = new CookieJar();
  cookieJar.loadFromCookies(cookies);

  return { cookieJar, domain };
}

/**
 * 执行每日签到。
 */
export async function performCheckin(accountId: number): Promise<CheckinResult> {
  const ctx = await getRequestContext(accountId);
  if (!ctx) {
    return { success: false, alreadyCheckedIn: false, message: '无有效 Cookie，请先登录' };
  }

  const { cookieJar, domain } = ctx;
  const signPageUrl = `${domain}/k_misign-sign.html`;

  try {
    const { text: signPageText, setCookieHeaders: cookies1 } = await httpRequest(
      signPageUrl,
      { cookieJar, referer: `${domain}/` },
    );
    cookieJar.parseSetCookie(cookies1);

    const signHref = extractAnchorHref(signPageText, 'JD_sign');

    if (!signHref) {
      if (signPageText.includes('今日已签') || signPageText.includes('您今天已经签到过了')) {
        return parseCheckinResult(signPageText, true);
      }
      return {
        success: false,
        alreadyCheckedIn: false,
        message: '未找到签到按钮，页面结构可能已变更',
      };
    }

    console.log(logT('log.sjs.signLink', { href: signHref }));

    const checkInUrl = signHref.startsWith('http')
      ? signHref
      : `${domain}/${signHref}`;

    const { text: checkInText, setCookieHeaders: cookies2 } = await httpRequest(
      checkInUrl,
      { cookieJar, referer: signPageUrl },
    );
    cookieJar.parseSetCookie(cookies2);

    if (
      checkInText.includes('今日已签') ||
      checkInText.includes('您今天已经签到过了')
    ) {
      return parseCheckinResult(checkInText, true);
    }

    if (checkInText.includes('签到成功') || checkInText.includes('CDATA')) {
      const { text: afterText } = await httpRequest(signPageUrl, {
        cookieJar,
        referer: `${domain}/`,
      });
      return parseCheckinResult(afterText, false);
    }

    return {
      success: false,
      alreadyCheckedIn: false,
      message: `签到失败: ${checkInText.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      success: false,
      alreadyCheckedIn: false,
      message: `签到异常: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 从签到页面解析签到结果信息。
 */
function parseCheckinResult(html: string, alreadyCheckedIn: boolean): CheckinResult {
  const rank = extractInputValue(html, 'qiandaobtnnum') || undefined;
  const level = extractInputValue(html, 'lxlevel') || undefined;
  const continuousDays = extractInputValue(html, 'lxdays') || undefined;
  const totalDays = extractInputValue(html, 'lxtdays') || undefined;
  const reward = extractInputValue(html, 'lxreward') || undefined;

  const pointsRegex = /<li[^>]*class=["'][^"']*nexmemberinfostwos[^"']*["'][^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i;
  const pointsMatch = html.match(pointsRegex);
  const totalPoints = pointsMatch ? pointsMatch[1].trim() : undefined;

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
  };
}

/**
 * 购买帖子以解锁隐藏的下载链接。
 */
export async function buyThread(
  accountId: number,
  tid: string,
): Promise<BuyResult> {
  const ctx = await getRequestContext(accountId);
  if (!ctx) {
    return { success: false, alreadyBought: false, message: '无有效 Cookie，请先登录' };
  }

  const { cookieJar, domain } = ctx;
  const threadUrl = `${domain}/thread-${tid}-1-1.html`;

  try {
    const { text: threadText } = await httpRequest(threadUrl, {
      cookieJar,
      referer: `${domain}/`,
    });

    const subject = extractElementText(threadText, "span[id='thread_subject']") || 'Unknown';

    const linksDiv = extractClassContent(threadText, 'jnpar-pansell-links');
    if (linksDiv) {
      if (linksDiv.includes('购买后可查看')) {
        console.log(logT('log.sjs.postNotPurchased', { title: subject }));
      } else {
        const downloadLinks = parseDownloadLinks(linksDiv);
        return {
          success: true,
          alreadyBought: true,
          message: '帖子已购买',
          subject,
          downloadLinks,
        };
      }
    } else {
      return {
        success: true,
        alreadyBought: true,
        message: '此帖子无需购买',
        subject,
      };
    }

    const buyPageUrl = `${domain}/jnpar_pansell-pay.html?tid=${tid}&pid=&infloat=yes&handlekey=jnpar_pay_win1&inajax=1&ajaxtarget=fwin_content_jnpar_pay_win1`;

    const { text: buyPageText } = await httpRequest(buyPageUrl, {
      cookieJar,
      referer: threadUrl,
    });

    const cdataMatch = buyPageText.match(/<!--\[CDATA\[([\s\S]*?)\]\]&gt;/);
    if (!cdataMatch) {
      return {
        success: false,
        alreadyBought: false,
        message: '无法解析购买表单 CDATA',
        subject,
      };
    }

    const formData = cdataMatch[1];
    const buyFormhash = extractInputValue(formData, 'formhash');
    const handlekey = extractInputValue(formData, 'handlekey');
    const buyTid = extractInputValue(formData, 'tid');
    const pid = extractInputValue(formData, 'pid');

    console.log(logT('log.sjs.buyFormParams', { formhash: buyFormhash, tid: buyTid }));

    const buyUrl = `${domain}/plugin.php?id=jnpar_pansell:pay`;
    const buyBody = new URLSearchParams({
      formhash: buyFormhash,
      handlekey: handlekey || 'jnpar_pay_win1',
      tid: buyTid || tid,
      pid: pid || '',
      submit: 'true',
    });

    const { text: buyResultText, url: finalUrl } = await httpRequest(buyUrl, {
      method: 'POST',
      body: buyBody,
      cookieJar,
      referer: threadUrl,
    });

    if (finalUrl === threadUrl || finalUrl.includes(`thread-${tid}`)) {
      const linksDivAfter = extractClassContent(buyResultText, 'jnpar-pansell-links');
      const downloadLinks = linksDivAfter
        ? parseDownloadLinks(linksDivAfter)
        : [];

      return {
        success: true,
        alreadyBought: false,
        message: '购买成功',
        subject,
        downloadLinks,
      };
    }

    return {
      success: false,
      alreadyBought: false,
      message: '购买失败：积分不足或帖子不可购买',
      subject,
    };
  } catch (err) {
    return {
      success: false,
      alreadyBought: false,
      message: `购买异常: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 从购买后的 jnpar-pansell-links 区域解析下载链接。
 */
function parseDownloadLinks(linksHtml: string): string[] {
  const links: string[] = [];

  const regex = /<span[^>]*class=["'][^"']*jnpar-link-text[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = regex.exec(linksHtml)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\n\r\t]/g, ' ')
      .replace(/【|】/g, '')
      .trim();
    if (text) {
      links.push(text);
    }
  }

  const hrefRegex = /<a[^>]*href=["']([^"']*)["'][^>]*>/gi;
  let hrefMatch;
  while ((hrefMatch = hrefRegex.exec(linksHtml)) !== null) {
    const href = hrefMatch[1];
    if (
      href &&
      (href.includes('pan.') ||
        href.includes('quark') ||
        href.includes('baidu') ||
        href.includes('aliyun') ||
        href.includes('115.com') ||
        href.includes('lanzou'))
    ) {
      links.push(href);
    }
  }

  return [...new Set(links)];
}

/**
 * 从帖子页面 HTML 中提取已购买的下载链接。
 */
export function extractDownloadLinksFromPage(html: string): string[] {
  const linksDiv = extractClassContent(html, 'jnpar-pansell-links');
  if (!linksDiv) return [];

  if (linksDiv.includes('购买后可查看')) {
    return [];
  }

  return parseDownloadLinks(linksDiv);
}

/**
 * 检查帖子是否需要购买才能查看下载链接。
 */
export function isThreadPurchasable(html: string): boolean {
  const linksDiv = extractClassContent(html, 'jnpar-pansell-links');
  if (!linksDiv) return false;
  return linksDiv.includes('购买后可查看');
}

/**
 * 为所有可用账户执行签到。
 */
export async function checkinAllAccounts(): Promise<
  Array<{ accountId: number; username: string; result: CheckinResult }>
> {
  const accountManager = getSiteAccountManager();
  const accounts = await accountManager.getAccountsBySiteId('sjs');

  const results: Array<{ accountId: number; username: string; result: CheckinResult }> = [];

  for (const account of accounts) {
    if (account.status !== 'active') continue;

    console.log(logT('log.sjs.startSign', { username: account.username }));
    const result = await performCheckin(account.id);

    await accountManager.markUsed(account.id).catch(() => {});

    results.push({
      accountId: account.id,
      username: account.username,
      result,
    });

    if (results.length < accounts.length) {
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
    }
  }

  return results;
}
