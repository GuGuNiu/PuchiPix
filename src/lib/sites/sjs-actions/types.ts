import type { CookieData } from '../site-account-manager';

/** 司机社多域名列表 */
export const SITE_DOMAINS = [
  'https://sjs66.com',
  'https://sjs47.com',
  'https://sjs47.net',
  'https://sjslt.cc',
  'https://xsijishe.net',
];

/** Discuz Cookie 前缀 */
export const DISCUZ_COOKIE_PREFIX = 'SgL6_2132_';

/** 浏览器 UA */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

/** 签到结果 */
export interface CheckinResult {
  success: boolean;
  alreadyCheckedIn: boolean;
  message: string;
  rank?: string;
  level?: string;
  continuousDays?: string;
  totalDays?: string;
  reward?: string;
  totalPoints?: string;
}

/** 购买结果 */
export interface BuyResult {
  success: boolean;
  alreadyBought: boolean;
  message: string;
  subject?: string;
  downloadLinks?: string[];
}

/** 登录结果 */
export interface LoginResult {
  success: boolean;
  message: string;
  cookies?: CookieData[];
  domain?: string;
}

/**
 * 轻量级 Cookie Jar。
 *
 * 管理 HTTP 请求的 Cookie 存储、读取和注入。
 * 支持 Set-Cookie 响应头解析和 Cookie 请求头生成。
 */
export class CookieJar {
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
