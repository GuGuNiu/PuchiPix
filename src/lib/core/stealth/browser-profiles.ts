
import type { Page, Browser, BrowserContext } from 'playwright';
import profilesData from '../../data/browser-profiles.json';

export { sleep, randomDelay } from '@/lib/utils/delay';

export type BrowserType = 'chrome' | 'firefox' | 'safari' | 'edge';
export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

export interface BrowserProfile {
  ua: string;
  browser: BrowserType;
  platform: Platform;
  secChUa?: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  accept: string;
  acceptEncoding: string;
  viewport: { width: number; height: number };
  hardwareConcurrency: number;
  deviceMemory: number;
  navigatorPlatform: string;
  vendor: string;
  maxTouchPoints: number;
}

const CHROME_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const FIREFOX_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const SAFARI_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const CHROME_ENCODING = 'gzip, deflate, br, zstd';
const FIREFOX_ENCODING = 'gzip, deflate, br';
const SAFARI_ENCODING = 'gzip, deflate, br';

const CHROME_BRANDS = profilesData.brands.chrome as Record<number, string>;
const EDGE_BRANDS = profilesData.brands.edge as Record<number, string>;

const NAV_PLATFORM: Record<Platform, string> = {
  windows: 'Win32',
  macos: 'MacIntel',
  linux: 'Linux x86_64',
  android: 'Linux armv8l',
  ios: 'iPhone',
};

const VENDOR: Record<BrowserType, string> = {
  chrome: 'Google Inc.',
  edge: 'Google Inc.',
  firefox: '',
  safari: 'Apple Computer, Inc.',
};

interface ProfileEntry {
  browser: BrowserType;
  platform: Platform;
  major: number;
  full: string;
  vp?: [number, number];
  hw?: number;
  mem?: number;
  device?: string;
  androidVer?: number;
  edgePatch?: string;
}

interface ProfileOpts {
  device?: string;
  androidVer?: number;
  vp?: [number, number];
  hw?: number;
  mem?: number;
  edgePatch?: string;
}

function genProfile(
  browser: BrowserType,
  platform: Platform,
  major: number,
  full: string,
  opts?: ProfileOpts,
): BrowserProfile {
  let ua = '';
  let secChUa: string | undefined;
  let accept = '';
  let acceptEncoding = '';
  let viewport = opts?.vp ?? [1920, 1080];
  const hw = opts?.hw ?? 8;
  const mem = opts?.mem ?? 8;
  let maxTouch = 0;
  const isMobile = platform === 'android' || platform === 'ios';

  switch (browser) {
    case 'chrome':
      accept = CHROME_ACCEPT;
      acceptEncoding = CHROME_ENCODING;
      secChUa = CHROME_BRANDS[major];
      if (platform === 'android') {
        const dev = opts?.device ?? 'Pixel 8';
        const av = opts?.androidVer ?? 14;
        ua = `Mozilla/5.0 (Linux; Android ${av}; ${dev}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Mobile Safari/537.36`;
        viewport = opts?.vp ?? [412, 915];
        maxTouch = 5;
      } else if (platform === 'windows') {
        ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`;
      } else if (platform === 'macos') {
        ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`;
      } else if (platform === 'linux') {
        ua = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`;
      }
      break;

    case 'firefox':
      accept = FIREFOX_ACCEPT;
      acceptEncoding = FIREFOX_ENCODING;
      if (platform === 'windows') {
        ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
      } else if (platform === 'macos') {
        ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
      } else if (platform === 'linux') {
        ua = `Mozilla/5.0 (X11; Linux x86_64; rv:${major}.0) Gecko/20100101 Firefox/${major}.0`;
      }
      break;

    case 'safari':
      accept = SAFARI_ACCEPT;
      acceptEncoding = SAFARI_ENCODING;
      if (platform === 'macos') {
        ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${full} Safari/605.1.15`;
      } else if (platform === 'ios') {
        const iosVer = full.replace(/\./g, '_');
        ua = `Mozilla/5.0 (iPhone; CPU iPhone OS ${iosVer} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${full} Mobile/15E148 Safari/604.1`;
        viewport = opts?.vp ?? [390, 844];
        maxTouch = 5;
      }
      break;

    case 'edge':
      accept = CHROME_ACCEPT;
      acceptEncoding = CHROME_ENCODING;
      secChUa = EDGE_BRANDS[major];
      const edgeFull = `${major}.0.${opts?.edgePatch ?? '2592.81'}`;
      if (platform === 'windows') {
        ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36 Edg/${edgeFull}`;
      } else if (platform === 'macos') {
        ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36 Edg/${edgeFull}`;
      }
      break;
  }

  return {
    ua,
    browser,
    platform,
    secChUa,
    secChUaMobile: isMobile ? '?1' : '?0',
    secChUaPlatform: `"${platform.charAt(0).toUpperCase() + platform.slice(1)}"`,
    accept,
    acceptEncoding,
    viewport: { width: viewport[0], height: viewport[1] },
    hardwareConcurrency: hw,
    deviceMemory: mem,
    navigatorPlatform: NAV_PLATFORM[platform],
    vendor: VENDOR[browser],
    maxTouchPoints: maxTouch,
  };
}

const profileEntries = profilesData.profiles as ProfileEntry[];

export const BROWSER_PROFILES: BrowserProfile[] = profileEntries.map((entry) => {
  const { browser, platform, major, full, ...opts } = entry;
  return genProfile(browser, platform, major, full, opts);
});

export const USER_AGENTS: string[] = BROWSER_PROFILES.map((p) => p.ua);

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function randomProfile(): BrowserProfile {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}
