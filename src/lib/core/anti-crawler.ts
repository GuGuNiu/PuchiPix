/**
 * 模块：反爬虫防御工具（v2.0 大幅升级版）
 *
 * 参考开源社区最佳实践（fake-useragent、puppeteer-stealth、playwright-stealth、
 * Cloudflare anti-bot bypass 等），提供全站通用的反爬虫策略：
 *
 * 1. UA 轮换：100 个真实浏览器 UA，覆盖 Chrome/Firefox/Safari/Edge × Windows/macOS/Linux/Android/iOS
 * 2. 浏览器指纹模拟：每个 UA 搭配匹配的 sec-ch-ua、Accept、Accept-Encoding、viewport 等指纹信息
 * 3. Playwright Stealth 注入：navigator.webdriver、chrome runtime、plugins、WebGL 等 12 项反检测
 * 4. 高斯分布延迟：比均匀分布更接近人类行为模式
 * 5. 指数退避：baseDelay × 2^retry，上限 maxDelay，加入随机抖动
 * 6. 通用请求头：Accept-Language、Referer、sec-fetch-* 等标准头
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

import type { Page, Browser, BrowserContext } from 'playwright';

// ============================================================
// 类型定义
// ============================================================

export type BrowserType = 'chrome' | 'firefox' | 'safari' | 'edge';
export type Platform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

export interface BrowserProfile {
  ua: string;
  browser: BrowserType;
  platform: Platform;
  /** Chromium 系浏览器特有的 Client Hints */
  secChUa?: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  accept: string;
  acceptEncoding: string;
  viewport: { width: number; height: number };
  hardwareConcurrency: number;
  deviceMemory: number;
  /** navigator.platform 值 */
  navigatorPlatform: string;
  /** navigator.vendor 值 */
  vendor: string;
  /** 最大触控点数 */
  maxTouchPoints: number;
}

// ============================================================
// 浏览器特性常量
// ============================================================

const CHROME_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const FIREFOX_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const SAFARI_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

const CHROME_ENCODING = 'gzip, deflate, br, zstd';
const FIREFOX_ENCODING = 'gzip, deflate, br';
const SAFARI_ENCODING = 'gzip, deflate, br';

/** Chromium 各版本的 sec-ch-ua brand 令牌（开源社区实测值） */
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

// ============================================================
// Profile 生成器
// ============================================================

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
  let hw = opts?.hw ?? 8;
  let mem = opts?.mem ?? 8;
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

// ============================================================
// 100 个浏览器 Profile
// ============================================================

export const BROWSER_PROFILES: BrowserProfile[] = [
  // === Chrome on Windows (10) ===
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

  // === Chrome on macOS (15) ===
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

  // === Chrome on Linux (10) ===
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

  // === Chrome on Android (15) ===
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

  // === Firefox on Windows (12) ===
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

  // === Firefox on macOS (8) ===
  genProfile('firefox', 'macos', 127, '127.0'),
  genProfile('firefox', 'macos', 127, '127.0', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('firefox', 'macos', 126, '126.0', { vp: [1440, 900] }),
  genProfile('firefox', 'macos', 126, '126.0', { vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('firefox', 'macos', 125, '125.0'),
  genProfile('firefox', 'macos', 124, '124.0', { vp: [1280, 800] }),
  genProfile('firefox', 'macos', 123, '123.0', { vp: [1440, 900] }),
  genProfile('firefox', 'macos', 122, '122.0'),

  // === Firefox on Linux (7) ===
  genProfile('firefox', 'linux', 127, '127.0'),
  genProfile('firefox', 'linux', 126, '126.0', { vp: [2560, 1440], hw: 8, mem: 16 }),
  genProfile('firefox', 'linux', 125, '125.0'),
  genProfile('firefox', 'linux', 124, '124.0', { vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('firefox', 'linux', 123, '123.0'),
  genProfile('firefox', 'linux', 122, '122.0', { vp: [1440, 900] }),
  genProfile('firefox', 'linux', 121, '121.0', { vp: [1920, 1080], hw: 4, mem: 4 }),

  // === Safari on macOS (8) ===
  genProfile('safari', 'macos', 0, '17.5'),
  genProfile('safari', 'macos', 0, '17.5', { vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('safari', 'macos', 0, '17.4', { vp: [1440, 900] }),
  genProfile('safari', 'macos', 0, '17.4', { vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('safari', 'macos', 0, '17.3'),
  genProfile('safari', 'macos', 0, '17.2', { vp: [1280, 800] }),
  genProfile('safari', 'macos', 0, '17.1', { vp: [1440, 900] }),
  genProfile('safari', 'macos', 0, '17.0'),

  // === Safari on iOS (7) ===
  genProfile('safari', 'ios', 0, '17.5', { vp: [430, 932] }),
  genProfile('safari', 'ios', 0, '17.5', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.4', { vp: [393, 852] }),
  genProfile('safari', 'ios', 0, '17.4', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.3', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.2', { vp: [390, 844] }),
  genProfile('safari', 'ios', 0, '17.0', { vp: [375, 667] }),

  // === Edge on Windows (8) ===
  genProfile('edge', 'windows', 126, '126.0.6478.126', { edgePatch: '2592.81' }),
  genProfile('edge', 'windows', 126, '126.0.6478.57', { edgePatch: '2592.68', vp: [2560, 1440], hw: 12, mem: 16 }),
  genProfile('edge', 'windows', 125, '125.0.6422.142', { edgePatch: '2535.92', vp: [1366, 768], hw: 4, mem: 4 }),
  genProfile('edge', 'windows', 125, '125.0.6422.60', { edgePatch: '2535.51' }),
  genProfile('edge', 'windows', 124, '124.0.6367.201', { edgePatch: '2478.80', vp: [1536, 864] }),
  genProfile('edge', 'windows', 124, '124.0.6367.91', { edgePatch: '2478.51' }),
  genProfile('edge', 'windows', 123, '123.0.6312.124', { edgePatch: '2420.81', vp: [2560, 1440], hw: 8, mem: 16 }),
  genProfile('edge', 'windows', 122, '122.0.6261.128', { edgePatch: '2365.92', vp: [1440, 900] }),

  // === Edge on macOS (5) ===
  genProfile('edge', 'macos', 126, '126.0.6478.126', { edgePatch: '2592.81' }),
  genProfile('edge', 'macos', 125, '125.0.6422.142', { edgePatch: '2535.92', vp: [1440, 900] }),
  genProfile('edge', 'macos', 124, '124.0.6367.201', { edgePatch: '2478.80' }),
  genProfile('edge', 'macos', 123, '123.0.6312.124', { edgePatch: '2420.81', vp: [1680, 1050], hw: 10, mem: 16 }),
  genProfile('edge', 'macos', 122, '122.0.6261.128', { edgePatch: '2365.92', vp: [1280, 800] }),
];

// ============================================================
// 向后兼容：从 Profile 列表派生纯 UA 字符串数组
// ============================================================

export const USER_AGENTS: string[] = BROWSER_PROFILES.map((p) => p.ua);

// ============================================================
// 随机选择器
// ============================================================

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function randomProfile(): BrowserProfile {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}

// ============================================================
// 延迟与抖动
// ============================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 在 [min, max] 范围内生成均匀随机延迟（毫秒）
 */
export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 高斯分布随机延迟（比均匀分布更接近人类行为）
 *
 * 使用 Box-Muller 变换生成标准正态分布随机数，
 * 再线性映射到目标均值和标准差。
 *
 * @param mean - 均值（毫秒）
 * @param stddev - 标准差（毫秒）
 * @returns 延迟毫秒数（不小于 0）
 *
 * @date 2026-07-11
 */
export function gaussianDelay(mean: number, stddev: number): number {
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mean + z * stddev));
}

/**
 * 指数退避延迟（加入 ±20% 随机抖动，避免请求间隔呈完美几何级数）
 *
 * @param retryCount - 当前重试次数（从 0 开始）
 * @param baseDelay - 基础延迟（毫秒）
 * @param maxDelay - 最大延迟上限（毫秒）
 *
 * @date 2026-07-11
 */
export function backoffDelay(
  retryCount: number,
  baseDelay: number = 2000,
  maxDelay: number = 16000,
): number {
  const raw = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  const jitter = raw * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(raw + jitter));
}

// ============================================================
// HTTP 请求头构建
// ============================================================

export const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

/**
 * 构建完整的反爬虫 HTTP 请求头（用于原生 HTTP 请求，如 https.get）
 *
 * 根据浏览器 Profile 生成匹配的请求头集合，包括：
 * - User-Agent
 * - Accept / Accept-Encoding / Accept-Language
 * - sec-ch-ua 系列头（Chromium 系浏览器）
 * - sec-fetch-* 系列头
 * - Referer（可选）
 *
 * @param profile - 浏览器 Profile，不传则随机选择
 * @param referer - Referer 地址
 *
 * @date 2026-07-11
 */
export function buildStealthHeaders(
  profile?: BrowserProfile,
  referer?: string,
): Record<string, string> {
  const p = profile ?? randomProfile();
  const headers: Record<string, string> = {
    'User-Agent': p.ua,
    'Accept': p.accept,
    'Accept-Encoding': p.acceptEncoding,
    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
    'Connection': 'keep-alive',
  };

  if (p.secChUa) {
    headers['sec-ch-ua'] = p.secChUa;
    headers['sec-ch-ua-mobile'] = p.secChUaMobile;
    headers['sec-ch-ua-platform'] = p.secChUaPlatform;
  }

  if (p.browser === 'chrome' || p.browser === 'edge') {
    headers['sec-fetch-dest'] = 'document';
    headers['sec-fetch-mode'] = 'navigate';
    headers['sec-fetch-site'] = 'none';
    headers['sec-fetch-user'] = '?1';
    headers['upgrade-insecure-requests'] = '1';
  } else if (p.browser === 'firefox') {
    headers['sec-fetch-dest'] = 'document';
    headers['sec-fetch-mode'] = 'navigate';
    headers['sec-fetch-site'] = 'none';
    headers['sec-fetch-user'] = '?1';
    headers['upgrade-insecure-requests'] = '1';
  } else if (p.browser === 'safari') {
    headers['upgrade-insecure-requests'] = '1';
  }

  if (referer) {
    headers['Referer'] = referer;
  }

  return headers;
}

/**
 * 构建 Playwright 页面所需的额外 HTTP 头
 *
 * 仅包含需要覆盖浏览器默认值的头，不包含 Accept-Encoding 和 sec-fetch-*
 * （这些由浏览器自动生成，强行覆盖反而可能导致指纹不一致）
 *
 * @date 2026-07-11
 */
export function buildPageHeaders(
  profile?: BrowserProfile,
  referer?: string,
): Record<string, string> {
  const p = profile ?? randomProfile();
  const headers: Record<string, string> = {
    'User-Agent': p.ua,
    'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
  };

  if (p.secChUa) {
    headers['sec-ch-ua'] = p.secChUa;
    headers['sec-ch-ua-mobile'] = p.secChUaMobile;
    headers['sec-ch-ua-platform'] = p.secChUaPlatform;
  }

  if (referer) {
    headers['Referer'] = referer;
  }

  return headers;
}

/**
 * 构建带反爬虫策略的 HTTP 请求头（向后兼容接口）
 *
 * @param referer - Referer 地址
 * @deprecated 建议使用 buildStealthHeaders() 以获得更完整的指纹模拟
 */
export function buildAntiCrawlerHeaders(referer?: string): Record<string, string> {
  return buildStealthHeaders(randomProfile(), referer);
}

// ============================================================
// Playwright Stealth 注入
// ============================================================

/**
 * 生成反自动化检测的注入脚本列表
 *
 * 参考 puppeteer-extra-stealth 和 playwright-stealth 插件，
 * 覆盖 12 项常见的自动化检测向量：
 *
 * 1. navigator.webdriver → false
 * 2. window.chrome 运行时对象（Chromium 系）
 * 3. navigator.plugins 模拟（Chromium 系）
 * 4. navigator.languages 匹配 Accept-Language
 * 5. navigator.platform 匹配 UA 平台
 * 6. navigator.hardwareConcurrency 匹配 Profile
 * 7. navigator.deviceMemory 匹配 Profile（Chromium 系）
 * 8. navigator.vendor 匹配浏览器类型
 * 9. navigator.maxTouchPoints 匹配设备类型
 * 10. WebGL 渲染器指纹覆盖
 * 11. navigator.permissions.query 模拟
 * 12. window.outerWidth/outerHeight 修复
 *
 * @param profile - 浏览器 Profile
 * @returns 注入脚本字符串数组
 *
 * @date 2026-07-11
 */
export function getStealthScripts(profile?: BrowserProfile): string[] {
  const p = profile ?? randomProfile();
  const scripts: string[] = [];
  const isChromium = p.browser === 'chrome' || p.browser === 'edge';

  // 1. navigator.webdriver → false
  scripts.push(`
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  `);

  // 2. window.chrome 运行时对象
  if (isChromium) {
    scripts.push(`
      if (!window.chrome) {
        window.chrome = {
          app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
          runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }, connect: () => {}, sendMessage: () => {} },
          csi: () => ({ onloadT: Date.now(), startE: Date.now(), pageT: 0, tran: 15 }),
          loadTimes: () => ({ commitLoadTime: Date.now() / 1000, connectionInfo: 'http/1.1', finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000, firstPaintAfterLoadTime: 0, firstPaintTime: Date.now() / 1000, navigationType: 'Other', npnNegotiatedProtocol: 'unknown', requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: false, wasNpnNegotiated: false }),
        };
      }
    `);
  }

  // 3. navigator.plugins 模拟
  if (isChromium) {
    scripts.push(`
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const plugins = [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
          ];
          plugins.namedItem = (name) => plugins.find((p) => p.name === name) || null;
          plugins.refresh = () => {};
          plugins.item = (index) => plugins[index] || null;
          return plugins;
        },
        configurable: true,
      });
    `);
  }

  // 4. navigator.languages
  scripts.push(`
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });
  `);

  // 5. navigator.platform
  scripts.push(`
    Object.defineProperty(navigator, 'platform', {
      get: () => ${JSON.stringify(p.navigatorPlatform)},
      configurable: true,
    });
  `);

  // 6. navigator.hardwareConcurrency
  scripts.push(`
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => ${p.hardwareConcurrency},
      configurable: true,
    });
  `);

  // 7. navigator.deviceMemory（仅 Chromium 系）
  if (isChromium) {
    scripts.push(`
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => ${p.deviceMemory},
        configurable: true,
      });
    `);
  }

  // 8. navigator.vendor
  scripts.push(`
    Object.defineProperty(navigator, 'vendor', {
      get: () => ${JSON.stringify(p.vendor)},
      configurable: true,
    });
  `);

  // 9. navigator.maxTouchPoints
  scripts.push(`
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => ${p.maxTouchPoints},
      configurable: true,
    });
  `);

  // 10. WebGL 渲染器指纹覆盖
  scripts.push(`
    const getParameterProto = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Google Inc. (Intel)';
      if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameterProto.call(this, parameter);
    };
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const getParameter2Proto = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Google Inc. (Intel)';
        if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
        return getParameter2Proto.call(this, parameter);
      };
    }
  `);

  // 11. navigator.permissions.query
  scripts.push(`
    if (window.navigator.permissions && window.navigator.permissions.query) {
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = function(parameters) {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery(parameters);
      };
    }
  `);

  // 12. window.outerWidth/outerHeight 修复（headless 模式下为 0）
  scripts.push(`
    if (window.outerHeight === 0) {
      Object.defineProperty(window, 'outerHeight', {
        get: () => ${p.viewport.height + 88},
        configurable: true,
      });
    }
    if (window.outerWidth === 0) {
      Object.defineProperty(window, 'outerWidth', {
        get: () => ${p.viewport.width},
        configurable: true,
      });
    }
  `);

  return scripts;
}

/**
 * 为 Playwright Page 应用全套反检测策略
 *
 * 在页面导航前调用，包含：
 * 1. 设置 viewport 匹配 Profile
 * 2. 设置 extraHTTPHeaders 匹配浏览器指纹
 * 3. 注入 12 项 stealth init scripts
 * 4. 通过 CDP 会话移除自动化标志
 *
 * @param page - Playwright Page 实例
 * @param profile - 浏览器 Profile，不传则随机选择
 * @param referer - Referer 地址
 * @returns 使用的 BrowserProfile
 *
 * @date 2026-07-11
 * @lastModified 2026-07-12
 */
export async function applyStealthToPage(
  page: Page,
  profile?: BrowserProfile,
  referer?: string,
): Promise<BrowserProfile> {
  const p = profile ?? randomProfile();

  await page.setViewportSize(p.viewport);
  await page.setExtraHTTPHeaders(buildPageHeaders(p, referer));

  for (const script of getStealthScripts(p)) {
    await page.addInitScript(script);
  }

  // 通过 CDP 移除 webdriver 标志，补充 init script 的不足
  try {
    const client = await page.context().newCDPSession(page);
    await client.send('Page.setWebLifecycleState', { state: 'active' });
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: p.viewport.width,
      height: p.viewport.height,
      deviceScaleFactor: 1,
      mobile: p.platform === 'android' || p.platform === 'ios',
    });
  } catch {
    // CDP 会话创建失败不致命，init scripts 已覆盖主要检测向量
  }

  return p;
}

/**
 * 创建带全套反检测策略的 Playwright Page
 *
 * 推荐用法（替代 browser.newPage()）：
 *   const { page, context } = await createStealthPage(browser, undefined, referer);
 *   try { ... } finally { await context.close(); }
 *
 * 在 BrowserContext 级别设置 userAgent 和 viewport，
 * 确保 navigator.userAgent 和 HTTP User-Agent 头一致。
 *
 * @param browser - Playwright Browser 实例
 * @param profile - 浏览器 Profile，不传则随机选择
 * @param referer - Referer 地址
 * @returns { page, context, profile } 三元组
 *
 * @date 2026-07-11
 */
export async function createStealthPage(
  browser: Browser,
  profile?: BrowserProfile,
  referer?: string,
): Promise<{ page: Page; context: BrowserContext; profile: BrowserProfile }> {
  const p = profile ?? randomProfile();

  const context = await browser.newContext({
    userAgent: p.ua,
    viewport: p.viewport,
    extraHTTPHeaders: buildPageHeaders(p, referer),
    locale: 'zh-CN',
  });

  const page = await context.newPage();

  for (const script of getStealthScripts(p)) {
    await page.addInitScript(script);
  }

  return { page, context, profile: p };
}

// ============================================================
// 通用常量
// ============================================================

/** 翻页间隔范围（毫秒） */
export const PAGE_DELAY_MIN = 800;
export const PAGE_DELAY_MAX = 1500;

/** 批量任务间隔范围（毫秒），用于标题间/图库间防爬 */
export const BATCH_DELAY_MIN = 3000;
export const BATCH_DELAY_MAX = 5000;

/** 单个关键词/URL 最大重试次数 */
export const MAX_RETRIES = 3;

/** 图库最大翻页数（安全上限，防止无限翻页） */
export const MAX_GALLERY_PAGES = 30;

// ============================================================
// 大批量任务智能调度常量
// ============================================================

/** 短周期：每批处理数量上限（达到后短休息） */
export const BATCH_SHORT_CYCLE = 5;
/** 短周期休息时间范围（毫秒，10~30 秒随机抖动） */
export const BATCH_SHORT_REST_MIN = 10_000;
export const BATCH_SHORT_REST_MAX = 30_000;

/** 长周期：累计处理数量上限（达到后长休息） */
export const BATCH_LONG_CYCLE = 15;
/** 长周期休息时间范围（毫秒，20~40 分钟随机抖动） */
export const BATCH_LONG_REST_MIN = 20 * 60_000;
export const BATCH_LONG_REST_MAX = 40 * 60_000;

/** 大批量任务间基础间隔范围（毫秒，5~15 秒随机抖动） */
export const BATCH_TASK_DELAY_MIN = 5_000;
export const BATCH_TASK_DELAY_MAX = 15_000;

// ============================================================
// 人类行为模拟（v2.0 新增）
// ============================================================

/**
 * 模拟人类鼠标移动到目标元素
 *
 * 真实用户不会直接点击元素，而是先将鼠标移动到附近，再精确移动到目标。
 * 使用多段贝塞尔曲线近似人类鼠标轨迹。
 *
 * @param page - Playwright Page 实例
 * @param selector - 目标元素选择器
 *
 * @date 2026-07-12
 */
export async function humanMouseMove(
  page: Page,
  selector: string,
): Promise<void> {
  try {
    const element = await page.$(selector);
    if (!element) return;

    const box = await element.boundingBox();
    if (!box) return;

    // 从随机起点移动到目标中心附近（带随机偏移）
    const startX = Math.random() * (box.x + box.width + 200);
    const startY = Math.random() * (box.y + box.height + 200);
    const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
    const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

    // 分 3-5 段移动，每段间隔 50-150ms（近似人类鼠标速度）
    const steps = 3 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // 线性插值 + 随机抖动
      const x = startX + (targetX - startX) * t + (Math.random() - 0.5) * 20;
      const y = startY + (targetY - startY) * t + (Math.random() - 0.5) * 20;
      await page.mouse.move(x, y);
      await sleep(gaussianDelay(80, 30));
    }
  } catch {
    // 鼠标移动失败不致命
  }
}

/**
 * 模拟人类点击行为
 *
 * 真实用户点击行为模式：
 * 1. 鼠标先移动到元素附近
 * 2. 短暂停顿（50-200ms）
 * 3. 按下鼠标按钮
 * 4. 短暂停顿（20-80ms，按下到释放的间隔）
 * 5. 释放鼠标按钮
 *
 * @param page - Playwright Page 实例
 * @param selector - 目标元素选择器
 *
 * @date 2026-07-12
 */
export async function humanClick(
  page: Page,
  selector: string,
): Promise<void> {
  await humanMouseMove(page, selector);
  await sleep(gaussianDelay(120, 50));

  // 使用 mouse.down/up 模拟真实点击时序
  const element = await page.$(selector);
  if (element) {
    const box = await element.boundingBox();
    if (box) {
      const x = box.x + box.width * (0.3 + Math.random() * 0.4);
      const y = box.y + box.height * (0.3 + Math.random() * 0.4);
      await page.mouse.move(x, y);
      await sleep(gaussianDelay(50, 20));
      await page.mouse.down();
      await sleep(gaussianDelay(40, 20));
      await page.mouse.up();
    }
  } else {
    await page.click(selector).catch(() => {});
  }
}

/**
 * 模拟人类等待行为
 *
 * 真实用户在页面加载后会有一段不固定的观察时间，
 * 使用高斯分布生成 1-3 秒的随机等待。
 *
 * @date 2026-07-12
 */
export async function humanWait(): Promise<void> {
  await sleep(gaussianDelay(2000, 800));
}

/**
 * 模拟人类页面滚动
 *
 * 真实用户会缓慢滚动页面查看内容，而非一次性跳到底部。
 *
 * @param page - Playwright Page 实例
 * @param scrolls - 滚动次数
 *
 * @date 2026-07-12
 */
export async function humanScroll(
  page: Page,
  scrolls: number = 2,
): Promise<void> {
  for (let i = 0; i < scrolls; i++) {
    const deltaY = 100 + Math.floor(Math.random() * 300);
    await page.mouse.wheel(0, deltaY);
    await sleep(gaussianDelay(500, 200));
  }
}
