import type { CookieData } from '../site-account-manager';

export const SITE_DOMAINS = [
  'https://xsijishe.ink',
  'https://sjs96.com',
  'https://sjs66.com',
  'https://sjs47.com',
  'https://sjs47.net',
  'https://sjslt.cc',
  'https://xsijishe.net',
];

export const DISCUZ_COOKIE_PREFIX = 'SgL6_2132_';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36';

/** Check-inresult */
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
  todayCount?: string;
}

export interface BuyResult {
  success: boolean;
  alreadyBought: boolean;
  message: string;
  subject?: string;
  downloadLinks?: string[];
}

/** Loginresult */
export interface LoginResult {
  success: boolean;
  message: string;
  cookies?: CookieData[];
  domain?: string;
}


export class CookieJar {
  private cookies: Map<string, string> = new Map();

  /** From cookie ArrayLoad */
  loadFromCookies(cookies: CookieData[]): void {
    for (const c of cookies) {
      this.cookies.set(c.name, c.value);
    }
  }

  parseSetCookie(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const match = header.match(/^([^=]+)=([^;]*)/);
      if (match) {
        this.cookies.set(match[1].trim(), match[2].trim());
      }
    }
  }

  /** Generate cookie Request headers */
  toHeader(): string {
    if (this.cookies.size === 0) return '';
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

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

  hasAuthCookie(): boolean {
    return this.cookies.has(`${DISCUZ_COOKIE_PREFIX}auth`);
  }

  /** Empty */
  clear(): void {
    this.cookies.clear();
  }
}
