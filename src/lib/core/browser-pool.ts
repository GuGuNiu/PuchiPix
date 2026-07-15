import { chromium, type Browser } from 'playwright';
import { getOrCreateGlobal } from './global-singleton';

const BROWSER_KEY = '__sharedBrowserInstance__';

/**
 * Chrome 反检测启动参数
 *
 * 这些参数在 headless 和非 headless 模式下都能有效降低自动化检测概率。
 * 参考 puppeteer-extra-stealth 和 undetected-chrome 的实现。
 */
const STEALTH_ARGS: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-infobars',
  '--disable-extensions',
  '--disable-component-extensions-with-background-pages',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-ipc-flooding-protection',
  '--password-store=basic',
  '--use-mock-keychain',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
];

/**
 * 获取共享浏览器实例
 *
 * 如果浏览器未启动或已断线，自动启动新实例。
 * 调用方只需创建 newPage()，无需关心浏览器生命周期。
 *
 * headless 模式由环境变量 STEALTH_HEADLESS 控制：
 * - "false" 或 "0"：使用非 headless 模式（最强反检测，需要桌面环境）
 * - 默认：true（headless 模式，Playwright 1.60+ 已使用新版 headless）
 */
export async function getSharedBrowser(): Promise<Browser> {
  const g = globalThis as Record<string, unknown>;
  let browser = g[BROWSER_KEY] as Browser | null;

  if (!browser || !browser.isConnected()) {
    const headlessEnv = process.env.STEALTH_HEADLESS;
    const headless: boolean =
      headlessEnv === 'false' || headlessEnv === '0' ? false : true;

    browser = await chromium.launch({
      headless,
      channel: 'chrome',
      args: STEALTH_ARGS,
    });
    g[BROWSER_KEY] = browser;
  }

  return browser;
}

/**
 * 关闭共享浏览器实例（用于应用优雅退出）
 */
export async function closeSharedBrowser(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const browser = g[BROWSER_KEY] as Browser | null;
  if (browser) {
    await browser.close().catch(() => {});
    g[BROWSER_KEY] = null;
  }
}
