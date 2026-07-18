import { getSiteAccountManager } from '../site-account-manager';
import { DomainHealthTracker } from '@/lib/core/domain/domain-health-tracker';
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

/** 鍩熷悕鍋ュ悍搴﹁窡韪櫒 */
const domainHealthTracker = new DomainHealthTracker();

/**
 * HTTP 蹇€熺櫥褰曪紙鏃犻渶 Playwright锛夈€?
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
        message: '鏃犳硶鎻愬彇 formhash锛岄〉闈㈠彲鑳介渶瑕侀獙璇佺爜鎴栧煙鍚嶄笉鍙敤',
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

    if (loginText.includes('娆㈣繋鎮ㄥ洖鏉?)) {
      const cookies = cookieJar.toCookieData(targetDomain);
      console.log(logT('log.sjs.httpLoginSuccess', { count: cookies.length }));
      domainHealthTracker.markHealthy(targetDomain);

      return {
        success: true,
        message: '鐧诲綍鎴愬姛',
        cookies,
        domain: targetDomain,
      };
    }

    domainHealthTracker.markRateLimited(targetDomain);
    const errorMsg = loginText.includes('瀵嗙爜閿欒')
      ? '瀵嗙爜閿欒'
      : loginText.includes('鐢ㄦ埛鍚?)
        ? '鐢ㄦ埛鍚嶄笉瀛樺湪'
        : `鐧诲綍澶辫触: ${loginText.slice(0, 200)}`;

    return { success: false, message: errorMsg };
  } catch (err) {
    domainHealthTracker.markRateLimited(targetDomain);
    return {
      success: false,
      message: `HTTP 鐧诲綍寮傚父: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 浣跨敤宸叉湁 Cookie 杩涜 HTTP 璇锋眰锛堥獙璇佺櫥褰曟€侊級銆?
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
 * 鎵ц姣忔棩绛惧埌銆?
 */
export async function performCheckin(accountId: number): Promise<CheckinResult> {
  const ctx = await getRequestContext(accountId);
  if (!ctx) {
    return { success: false, alreadyCheckedIn: false, message: '鏃犳湁鏁?Cookie锛岃鍏堢櫥褰? };
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
      if (signPageText.includes('浠婃棩宸茬') || signPageText.includes('鎮ㄤ粖澶╁凡缁忕鍒拌繃浜?)) {
        return parseCheckinResult(signPageText, true);
      }
      return {
        success: false,
        alreadyCheckedIn: false,
        message: '鏈壘鍒扮鍒版寜閽紝椤甸潰缁撴瀯鍙兘宸插彉鏇?,
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
      checkInText.includes('浠婃棩宸茬') ||
      checkInText.includes('鎮ㄤ粖澶╁凡缁忕鍒拌繃浜?)
    ) {
      return parseCheckinResult(checkInText, true);
    }

    if (checkInText.includes('绛惧埌鎴愬姛') || checkInText.includes('CDATA')) {
      const { text: afterText } = await httpRequest(signPageUrl, {
        cookieJar,
        referer: `${domain}/`,
      });
      return parseCheckinResult(afterText, false);
    }

    return {
      success: false,
      alreadyCheckedIn: false,
      message: `绛惧埌澶辫触: ${checkInText.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      success: false,
      alreadyCheckedIn: false,
      message: `绛惧埌寮傚父: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 浠庣鍒伴〉闈㈣В鏋愮鍒扮粨鏋滀俊鎭€?
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
    message: alreadyCheckedIn ? '浠婃棩宸茬鍒? : '绛惧埌鎴愬姛',
    rank,
    level: level ? `Lv.${level}` : undefined,
    continuousDays,
    totalDays,
    reward,
    totalPoints,
  };
}

/**
 * 璐拱甯栧瓙浠ヨВ閿侀殣钘忕殑涓嬭浇閾炬帴銆?
 */
export async function buyThread(
  accountId: number,
  tid: string,
): Promise<BuyResult> {
  const ctx = await getRequestContext(accountId);
  if (!ctx) {
    return { success: false, alreadyBought: false, message: '鏃犳湁鏁?Cookie锛岃鍏堢櫥褰? };
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
      if (linksDiv.includes('璐拱鍚庡彲鏌ョ湅')) {
        console.log(logT('log.sjs.postNotPurchased', { title: subject }));
      } else {
        const downloadLinks = parseDownloadLinks(linksDiv);
        return {
          success: true,
          alreadyBought: true,
          message: '甯栧瓙宸茶喘涔?,
          subject,
          downloadLinks,
        };
      }
    } else {
      return {
        success: true,
        alreadyBought: true,
        message: '姝ゅ笘瀛愭棤闇€璐拱',
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
        message: '鏃犳硶瑙ｆ瀽璐拱琛ㄥ崟 CDATA',
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
        message: '璐拱鎴愬姛',
        subject,
        downloadLinks,
      };
    }

    return {
      success: false,
      alreadyBought: false,
      message: '璐拱澶辫触锛氱Н鍒嗕笉瓒虫垨甯栧瓙涓嶅彲璐拱',
      subject,
    };
  } catch (err) {
    return {
      success: false,
      alreadyBought: false,
      message: `璐拱寮傚父: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 浠庤喘涔板悗鐨?jnpar-pansell-links 鍖哄煙瑙ｆ瀽涓嬭浇閾炬帴銆?
 */
function parseDownloadLinks(linksHtml: string): string[] {
  const links: string[] = [];

  const regex = /<span[^>]*class=["'][^"']*jnpar-link-text[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = regex.exec(linksHtml)) !== null) {
    const text = match[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/[\n\r\t]/g, ' ')
      .replace(/銆恷銆?g, '')
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
 * 浠庡笘瀛愰〉闈?HTML 涓彁鍙栧凡璐拱鐨勪笅杞介摼鎺ャ€?
 */
export function extractDownloadLinks(html: string): string[] {
  const linksDiv = extractClassContent(html, 'jnpar-pansell-links');
  if (!linksDiv) return [];

  if (linksDiv.includes('璐拱鍚庡彲鏌ョ湅')) {
    return [];
  }

  return parseDownloadLinks(linksDiv);
}

/**
 * 妫€鏌ュ笘瀛愭槸鍚﹂渶瑕佽喘涔版墠鑳芥煡鐪嬩笅杞介摼鎺ャ€?
 */
export function isThreadPurchasable(html: string): boolean {
  const linksDiv = extractClassContent(html, 'jnpar-pansell-links');
  if (!linksDiv) return false;
  return linksDiv.includes('璐拱鍚庡彲鏌ョ湅');
}

/**
 * 涓烘墍鏈夊彲鐢ㄨ处鎴锋墽琛岀鍒般€?
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
