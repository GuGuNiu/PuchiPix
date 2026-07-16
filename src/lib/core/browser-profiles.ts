
import type { Page, Browser, BrowserContext } from 'playwright';

// 从基础层导入通用延迟工具并重新导出，保持向后兼容
export { sleep, randomDelay } from '@/lib/utils/delay';
import { sleep, randomDelay } from '@/lib/utils/delay';

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

const CHROME_BRANDS: Record<number, string> = {
  120: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  121: '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
  122: '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  123: '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
  124: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  125: '"Not.A/Brand";v="24", "Google Chrome";v="125", "Chromium";v="125"',
  126: '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
};

const EDGE_BRANDS: Record<number, string> = {
  120: '"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"',
  121: '"Not A(Brand";v="99", "Microsoft Edge";v="121", "Chromium";v="121"',
  122: '"Chromium";v="122", "Not(A:Brand";v="24", "Microsoft Edge";v="122"',
  123: '"Microsoft Edge";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
  124: '"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"',
  125: '"Not.A/Brand";v="24", "Microsoft Edge";v="125", "Chromium";v="125"',
  126: '"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"',
};

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

export const BROWSER_PROFILES: BrowserProfile[] = [
  genProfile('chrome', 'windows', 126, '126.0.6478.126'),
  genProfile('chrome', 'windows', 126, '126.0.6478.57', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('chrome', 'windows', 125, '125.0.6422.142', { vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('chrome', 'windows', 125, '125.0.6422.60', { vp: [1536, 864] }),
  genProfile('chrome', 'windows', 124, '124.0.6367.201'),
  genProfile('chrome', 'windows', 124, '124.0.6367.91', { vp: [1440, 900] }),
  genProfile('chrome', 'windows', 123, '123.0.6312.124', { vp: [1600, 900], hw: 6 }),
  genProfile('chrome', 'windows', 122, '122.0.6261.128'),
  genProfile('chrome', 'windows', 121, '121.0.6167.184', { vp: [2560, 1440], hw: 8, mem: 16 }),
  genProfile('chrome', 'windows', 120, '120.0.6099.225', { vp: [1366, 768], hw: 4, mem: 4 }),

  genProfile('chrome', 'macos', 126, '126.0.6478.126'),
  genProfile('chrome', 'macos', 126, '126.0.6478.57', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('chrome', 'macos', 125, '125.0.6422.142', { vp: [1440, 900] }),
  genProfile('chrome', 'macos', 125, '125.0.6422.60', { vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('chrome', 'macos', 124, '124.0.6367.201'),
  genProfile('chrome', 'macos', 124, '124.0.6367.91', { vp: [2560, 1600], hw: 12, mem: 16 }),
  genProfile('chrome', 'macos', 123, '123.0.6312.124', { vp: [1440, 900] }),
  genProfile('chrome', 'macos', 122, '122.0.6261.128'),
  genProfile('chrome', 'macos', 121, '121.0.6167.184', { vp: [1280, 800] }),
  genProfile('chrome', 'macos', 120, '120.0.6099.225', { vp: [1440, 900], hw: 4 }),
  genProfile('chrome', 'macos', 126, '126.0.6478.126', { vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('chrome', 'macos', 125, '125.0.6422.142', { vp: [2560, 1600], hw: 12, mem: 16 }),
  genProfile('chrome', 'macos', 124, '124.0.6367.201', { vp: [1280, 800] }),
  genProfile('chrome', 'macos', 123, '123.0.6312.124'),
  genProfile('chrome', 'macos', 122, '122.0.6261.128', { vp: [1440, 900] }),

  genProfile('chrome', 'linux', 126, '126.0.6478.126'),
  genProfile('chrome', 'linux', 125, '125.0.6422.142', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('chrome', 'linux', 124, '124.0.6367.201'),
  genProfile('chrome', 'linux', 123, '123.0.6312.124', { vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('chrome', 'linux', 122, '122.0.6261.128'),
  genProfile('chrome', 'linux', 121, '121.0.6167.184', { vp: [1440, 900] }),
  genProfile('chrome', 'linux', 120, '120.0.6099.225'),
  genProfile('chrome', 'linux', 126, '126.0.6478.57', { vp: [1600, 900], hw: 6 }),
  genProfile('chrome', 'linux', 125, '125.0.6422.60', { vp: [2560, 1440], hw: 8, mem: 16 }),
  genProfile('chrome', 'linux', 124, '124.0.6367.91', { vp: [1920, 1080], hw: 4, mem: 4 }),

  genProfile('chrome', 'android', 126, '126.0.6478.126', { device: 'Pixel 8', androidVer: 14 }),
  genProfile('chrome', 'android', 126, '126.0.6478.57', { device: 'Pixel 7', androidVer: 13 }),
  genProfile('chrome', 'android', 125, '125.0.6422.142', { device: 'SM-S928B', androidVer: 14 }),
  genProfile('chrome', 'android', 125, '125.0.6422.60', { device: 'SM-S918B', androidVer: 14 }),
  genProfile('chrome', 'android', 124, '124.0.6367.201', { device: 'CPH2581', androidVer: 14 }),
  genProfile('chrome', 'android', 124, '124.0.6367.91', { device: 'CPH2449', androidVer: 14 }),
  genProfile('chrome', 'android', 123, '123.0.6312.124', { device: '23116PN5BC', androidVer: 14 }),
  genProfile('chrome', 'android', 122, '122.0.6261.128', { device: 'SM-S906B', androidVer: 13 }),
  genProfile('chrome', 'android', 121, '121.0.6167.184', { device: 'Pixel 6', androidVer: 13 }),
  genProfile('chrome', 'android', 120, '120.0.6099.225', { device: '2210132C', androidVer: 13 }),
  genProfile('chrome', 'android', 126, '126.0.6478.126', { device: 'SM-X910', androidVer: 14, vp: [800, 1280] }),
  genProfile('chrome', 'android', 125, '125.0.6422.142', { device: 'ALA-AN70', androidVer: 12 }),
  genProfile('chrome', 'android', 124, '124.0.6367.201', { device: 'PHB110', androidVer: 14 }),
  genProfile('chrome', 'android', 123, '123.0.6312.124', { device: 'V2304A', androidVer: 14 }),
  genProfile('chrome', 'android', 122, '122.0.6261.128', { device: 'PGT-AN10', androidVer: 14 }),

  genProfile('firefox', 'windows', 127, '127.0'),
  genProfile('firefox', 'windows', 127, '127.0', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('firefox', 'windows', 126, '126.0', { vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('firefox', 'windows', 126, '126.0'),
  genProfile('firefox', 'windows', 125, '125.0', { vp: [1536, 864] }),
  genProfile('firefox', 'windows', 125, '125.0'),
  genProfile('firefox', 'windows', 124, '124.0', { vp: [2560, 1440], hw: 8, mem: 16 }),
  genProfile('firefox', 'windows', 124, '124.0', { vp: [1440, 900] }),
  genProfile('firefox', 'windows', 123, '123.0'),
  genProfile('firefox', 'windows', 122, '122.0', { vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('firefox', 'windows', 121, '121.0'),
  genProfile('firefox', 'windows', 121, '121.0', { vp: [1600, 900], hw: 6 }),

  genProfile('firefox', 'macos', 127, '127.0'),
  genProfile('firefox', 'macos', 127, '127.0', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('firefox', 'macos', 126, '126.0', { vp: [1440, 900] }),
  genProfile('firefox', 'macos', 126, '126.0', { vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('firefox', 'macos', 125, '125.0'),
  genProfile('firefox', 'macos', 124, '124.0', { vp: [1280, 800] }),
  genProfile('firefox', 'macos', 123, '123.0', { vp: [1440, 900] }),
  genProfile('firefox', 'macos', 122, '122.0'),

  genProfile('firefox', 'linux', 127, '127.0'),
  genProfile('firefox', 'linux', 126, '126.0', { vp: [2560, 1440], hw: 8, mem: 16 }),
  genProfile('firefox', 'linux', 125, '125.0'),
  genProfile('firefox', 'linux', 124, '124.0', { vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('firefox', 'linux', 123, '123.0'),
  genProfile('firefox', 'linux', 122, '122.0', { vp: [1440, 900] }),
  genProfile('firefox', 'linux', 121, '121.0', { vp: [1920, 1080], hw: 4, mem: 4 }),

  genProfile('safari', 'macos', 0, '17.5'),
  genProfile('safari', 'macos', 0, '17.5', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('safari', 'macos', 0, '17.4', { vp: [1440, 900] }),
  genProfile('safari', 'macos', 0, '17.4', { vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('safari', 'macos', 0, '17.3'),
  genProfile('safari', 'macos', 0, '17.2', { vp: [1280, 800] }),
  genProfile('safari', 'macos', 0, '17.1', { vp: [1440, 900] }),
  genProfile('safari', 'macos', 0, '17.0'),

  genProfile('safari', 'ios', 0, '17.5', { vp: [430, 932] }),
  genProfile('safari', 'ios', 0, '17.5', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.4', { vp: [393, 852] }),
  genProfile('safari', 'ios', 0, '17.4', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.3', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.2', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.0', { vp: [375, 667] }),

  genProfile('edge', 'windows', 126, '126.0.6478.126', { edgePatch: '2592.81' }),
  genProfile('edge', 'windows', 126, '126.0.6478.57', { edgePatch: '2592.68', vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('edge', 'windows', 125, '125.0.6422.142', { edgePatch: '2535.92', vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('edge', 'windows', 125, '125.0.6422.60', { edgePatch: '2535.51' }),
  genProfile('edge', 'windows', 124, '124.0.6367.201', { edgePatch: '2478.80', vp: [1536, 864] }),
  genProfile('edge', 'windows', 124, '124.0.6367.91', { edgePatch: '2478.51' }),
  genProfile('edge', 'windows', 123, '123.0.6312.124', { edgePatch: '2420.81', vp: [2560, 1440], hw: 8, mem: 16 }),
  genProfile('edge', 'windows', 122, '122.0.6261.128', { edgePatch: '2365.92', vp: [1440, 900] }),

  genProfile('edge', 'macos', 126, '126.0.6478.126', { edgePatch: '2592.81' }),
  genProfile('edge', 'macos', 125, '125.0.6422.142', { edgePatch: '2535.92', vp: [1440, 900] }),
  genProfile('edge', 'macos', 124, '124.0.6367.201', { edgePatch: '2478.80' }),
  genProfile('edge', 'macos', 123, '123.0.6312.124', { edgePatch: '2420.81', vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('edge', 'macos', 122, '122.0.6261.128', { edgePatch: '2365.92', vp: [1280, 800] }),
];

export const USER_AGENTS: string[] = BROWSER_PROFILES.map((p) => p.ua);

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function randomProfile(): BrowserProfile {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}
