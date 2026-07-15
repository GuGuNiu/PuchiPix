import { createHash } from 'crypto';
import { getSiteAccountManager, type CookieData } from './site-account-manager';
import { DomainHealthTracker } from '@/lib/core/domain-health-tracker';

/** 司机社多域名列表 */
const SITE_DOMAINS = [
  'https://sjs66.com',
  'https://sjs47.com',
  'https://sjs47.net',
  'https://sjslt.cc',
  'https://xsijishe.net',
];

/** Discuz Cookie 前缀 */
const DISCUZ_COOKIE_PREFIX = 'SgL6_2132_';

/** 浏览器 UA */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

/** 域名健康度跟踪器 */
const domainHealthTracker = new DomainHealthTracker();

/** 签到结果 */
export interface CheckinResult {
  success: boolean;
  alreadyCheckedIn: boolean;
  message: string;
  /** 签到排名 */
  rank?: string;
  /** 签到等级 */
  level?: string;
  /** 连续签到天数 */
  continuousDays?: string;
  /** 签到总天数 */
  totalDays?: string;
  /** 签到奖励 */
  reward?: string;
  /** 总积分 */
  totalPoints?: string;
}

/** 购买结果 */
export interface BuyResult {
  success: boolean;
  alreadyBought: boolean;
  message: string;
  /** 帖子标题 */
  subject?: string;
  /** 解锁的下载链接信息 */
  downloadLinks?: string[];
}

/** 登录结果 */
export interface LoginResult {
  success: boolean;
  message: string;
  /** 获取到的 Cookie 列表 */
  cookies?: CookieData[];
  /** 使用的域名 */
  domain?: string;
}


/**
 * 轻量级 Cookie Jar。
 *
 * 管理 HTTP 请求的 Cookie 存储、读取和注入。
 * 支持 Set-Cookie 响应头解析和 Cookie 请求头生成。
 */
class CookieJar {
  private cookies: Map<string, string> = new Map();

  /** 从 Cookie 数组加载 */
  loadFromCookies(cookies: CookieData[]): void {
    for (const c of cookies) {
      this.cookies.set(c.name, c.value);
    }
  }

  /** 解析 Set-Cookie 响应头并存储 */
  parseSetCookie(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const match = header.match(/^([^=]+)=([^;]*)/);
      if (match) {
        this.cookies.set(match[1].trim(), match[2].trim());
      }
    }
  }

  /** 生成 Cookie 请求头 */
  toHeader(): string {
    if (this.cookies.size === 0) return '';
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /** 转换为 CookieData 数组（用于持久化） */
  toCookieData(domain: string): CookieData[] {
    const hostname = new URL(domain).hostname;
    return Array.from(this.cookies.entries()).map(([name, value]) => ({
      name,
      value,
      domain: `.${hostname}`,
      path: '/',
      httpOnly: false,
      secure: domain.startsWith('https'),
      sameSite: 'Lax' as const,
    }));
  }

  /** 是否包含认证 Cookie */
  hasAuthCookie(): boolean {
    return this.cookies.has(`${DISCUZ_COOKIE_PREFIX}auth`);
  }

  /** 清空 */
  clear(): void {
    this.cookies.clear();
  }
}


/**
 * 生成随机字母字符串（用于 loginhash 参数）。
 *
 * 对应 Rust 项目中的 get_random_string 函数。
 */
function getRandomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < len; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * MD5 哈希。
 *
 * Discuz AJAX 登录需要将密码 MD5 哈希后提交。
 */
function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/**
 * 从 HTML 中提取 input[name] 的 value 属性。
 */
function extractInputValue(html: string, name: string): string {
  const regex = new RegExp(
    `<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`,
    'i',
  );
  const match = html.match(regex);
  if (match) return match[1];

  // 反向：value 在 name 之前
  const regex2 = new RegExp(
    `<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`,
    'i',
  );
  const match2 = html.match(regex2);
  return match2 ? match2[1] : '';
}

/**
 * 从 HTML 中提取 a#id 的 href 属性。
 */
function extractAnchorHref(html: string, id: string): string | null {
  const regex = new RegExp(`<a[^>]*id=["']${id}["'][^>]*href=["']([^"']*)["']`, 'i');
  const match = html.match(regex);
  if (match) return match[1];

  // 反向
  const regex2 = new RegExp(`<a[^>]*href=["']([^"']*)["'][^>]*id=["']${id}["']`, 'i');
  const match2 = html.match(regex2);
  return match2 ? match2[1] : null;
}

/**
 * 从 HTML 中提取 #id 元素的 innerHTML（简单实现）。
 */
function extractElementText(html: string, selector: string): string {
  // 支持 span[id='xxx'] 格式
  const idMatch = selector.match(/id=['"]([^'"]+)['"]/);
  if (idMatch) {
    const id = idMatch[1];
    const tag = selector.match(/^(\w+)/)?.[1] || '\\w+';
    const regex = new RegExp(`<${tag}[^>]*id=["']${id}["'][^>]*>(.*?)</${tag}>`, 'is');
    const match = html.match(regex);
    return match ? match[1].trim() : '';
  }
  return '';
}

/**
 * 从 HTML 中提取 class 匹配的元素内容。
 */
function extractClassContent(html: string, className: string): string | null {
  const regex = new RegExp(
    `<div[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)</div>`,
    'i',
  );
  const match = html.match(regex);
  return match ? match[1] : null;
}


/**
 * 发送 HTTP 请求并自动管理 Cookie。
 */
async function httpRequest(
  url: string,
  options: {
    method?: 'GET' | 'POST';
    body?: URLSearchParams | string;
    cookieJar: CookieJar;
    referer?: string;
  },
): Promise<{ text: string; status: number; url: string; setCookieHeaders: string[] }> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
  };

  const cookieHeader = options.cookieJar.toHeader();
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  if (options.referer) {
    headers['Referer'] = options.referer;
  }

  if (options.method === 'POST' && options.body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.method === 'POST' ? options.body : undefined,
    redirect: 'manual', // 手动处理重定向以正确捕获 Cookie
  });

  // 收集 Set-Cookie 头
  const setCookieHeaders: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      setCookieHeaders.push(value);
    }
  });

  const location = res.headers.get('location');
  let finalUrl = url;
  let text = '';

  if (res.status >= 300 && res.status < 400 && location) {
    // 跟随重定向（最多 5 次）
    let redirectUrl = location;
    if (redirectUrl.startsWith('/')) {
      const parsed = new URL(url);
      redirectUrl = `${parsed.origin}${redirectUrl}`;
    }
    // 递归请求重定向 URL
    const redirectRes = await httpRequest(redirectUrl, {
      method: 'GET',
      cookieJar: options.cookieJar,
      referer: url,
    });
    text = redirectRes.text;
    finalUrl = redirectRes.url;
    redirectRes.setCookieHeaders.forEach((h) => setCookieHeaders.push(h));
  } else {
    text = await res.text();
    finalUrl = res.url || url;
  }

  return { text, status: res.status, url: finalUrl, setCookieHeaders };
}


/**
 * HTTP 快速登录（无需 Playwright）。
 *
 * 流程（借鉴 Rust 项目）：
 * - GET home.php?mod=space → 提取 formhash
 * - POST member.php?mod=logging&action=login → 密码 MD5 后提交
 * - 验证响应包含 "欢迎您回来"
 * - 返回 Cookie 供持久化
 *
 * @param username - 用户名
 * @param password - 明文密码
 * @param domain - 目标域名（默认自动选择）
 * @returns 登录结果
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

    console.log(`[SJS-Actions] 获取 formhash: ${formhash}`);

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
      console.log(`[SJS-Actions] HTTP 登录成功（${cookies.length} 个 Cookie）`);
      domainHealthTracker.markHealthy(targetDomain);

      return {
        success: true,
        message: '登录成功',
        cookies,
        domain: targetDomain,
      };
    }

    // 登录失败
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
 *
 * @param accountId - 账户 ID
 * @returns CookieJar + 域名，或 null（无有效 Cookie）
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
 *
 * 流程（借鉴 Rust 项目）：
 * - GET k_misign-sign.html → 提取 a#JD_sign 的 href
 * - GET 签到 URL → 执行签到
 * - GET k_misign-sign.html → 解析签到结果
 *
 * @param accountId - 账户 ID
 * @returns 签到结果
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
      // 可能已经签到过了
      if (signPageText.includes('今日已签') || signPageText.includes('您今天已经签到过了')) {
        return parseCheckinResult(signPageText, true);
      }
      return {
        success: false,
        alreadyCheckedIn: false,
        message: '未找到签到按钮，页面结构可能已变更',
      };
    }

    console.log(`[SJS-Actions] 签到链接: ${signHref}`);

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

  // 提取总积分（li.nexmemberinfostwos > p）
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
 *
 * 流程（借鉴 Rust 项目）：
 * - GET thread-{tid}-1-1.html → 检查是否已购买
 * - 如果未购买，GET jnpar_pansell-pay.html → 提取购买表单参数
 * - POST plugin.php?id=jnpar_pansell:pay → 执行购买
 * - 购买成功后重新获取帖子页面，解析下载链接
 *
 * @param accountId - 账户 ID
 * @param tid - 帖子 ID
 * @returns 购买结果（含解锁的下载链接）
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
        // 未购买，继续购买流程
        console.log(`[SJS-Actions] 帖子 "${subject}" 未购买，开始购买流程...`);
      } else {
        // 已购买，直接解析下载链接
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
      // 没有购买区域，可能是免费帖子
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

    console.log(`[SJS-Actions] 购买表单参数: formhash=${buyFormhash}, tid=${buyTid}`);

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
      // 购买成功，解析下载链接
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
 *
 * 对应 Rust 项目中的 parse_bought 函数。
 * 帖子购买后，隐藏内容以 span.jnpar-link-text 的形式展示，
 * 包含网盘链接（夸克网盘、百度网盘等）和提取码。
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

  // 也提取原始 HTML 中的网盘链接（a 标签的 href）
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
 *
 * 用于 scrapeGallery 流程中，检测帖子是否已购买并提取下载链接。
 * 不执行购买操作，仅解析。
 *
 * @param html - 帖子页面 HTML
 * @returns 下载链接数组（如未购买则返回空数组）
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
 *
 * @param html - 帖子页面 HTML
 * @returns true = 需要购买，false = 免费或已购买
 */
export function isThreadPurchasable(html: string): boolean {
  const linksDiv = extractClassContent(html, 'jnpar-pansell-links');
  if (!linksDiv) return false;
  return linksDiv.includes('购买后可查看');
}


/**
 * 为所有可用账户执行签到。
 *
 * @returns 每个账户的签到结果
 */
export async function checkinAllAccounts(): Promise<
  Array<{ accountId: number; username: string; result: CheckinResult }>
> {
  const accountManager = getSiteAccountManager();
  const accounts = await accountManager.getAccountsBySiteId('sjs');

  const results: Array<{ accountId: number; username: string; result: CheckinResult }> = [];

  for (const account of accounts) {
    if (account.status !== 'active') continue;

    console.log(`[SJS-Actions] 开始签到: ${account.username}`);
    const result = await performCheckin(account.id);

    await accountManager.markUsed(account.id).catch(() => {});

    results.push({
      accountId: account.id,
      username: account.username,
      result,
    });

    // 账户间间隔
    if (results.length < accounts.length) {
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
    }
  }

  return results;
}
