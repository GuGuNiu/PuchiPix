
import type { Page, Browser, BrowserContext } from 'playwright';
import { type BrowserProfile, randomProfile } from './browser-profiles';

export const DEFAULT_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';

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

/** 反自动化注入脚本，覆盖常见 detection vector */
export function getStealthScripts(profile?: BrowserProfile): string[] {
  const p = profile ?? randomProfile();
  const scripts: string[] = [];
  const isChromium = p.browser === 'chrome' || p.browser === 'edge';

  scripts.push(`
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true,
    });
  `);

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

  scripts.push(`
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true,
    });
  `);

  scripts.push(`
    Object.defineProperty(navigator, 'platform', {
      get: () => ${JSON.stringify(p.navigatorPlatform)},
      configurable: true,
    });
  `);

  scripts.push(`
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => ${p.hardwareConcurrency},
      configurable: true,
    });
  `);

  if (isChromium) {
    scripts.push(`
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => ${p.deviceMemory},
        configurable: true,
      });
    `);
  }

  scripts.push(`
    Object.defineProperty(navigator, 'vendor', {
      get: () => ${JSON.stringify(p.vendor)},
      configurable: true,
    });
  `);

  scripts.push(`
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => ${p.maxTouchPoints},
      configurable: true,
    });
  `);

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
  }

  return p;
}

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
