import {
  randomUA,
  sleep,
  backoffDelay,
  createStealthPage,
  humanClick,
  humanWait,
  humanScroll,
  gaussianDelay,
} from '@/lib/core/anti-crawler';
import { getSharedBrowser } from '@/lib/core/browser-pool';
import { sanitizeFilename, extractFilenameFromUrl } from '@/lib/utils';
import {
  ouoCache,
  OUO_CACHE_TTL,
  MEDIAFIRE_COUNTDOWN_MAX,
  cleanExpiredOuoCache,
} from './constants';

/**
 * 使用 Playwright 解析中转站页面，获取直链
 *
 * 链路：ouo.io → MediaFire → 直链
 */
export async function resolveDirectDownloadUrl(
  intermediateUrl: string,
  depth: number = 0,
): Promise<{ directUrl: string; filename: string; sourceUrl: string }> {
  if (depth > 3) {
    throw new Error('中转站解析深度超限（最多 3 层跳转）');
  }

  if (intermediateUrl.startsWith('chrome-error://') || intermediateUrl === 'about:blank') {
    throw new Error(`无效的中转站 URL: ${intermediateUrl}`);
  }

  const lowerUrl = intermediateUrl.toLowerCase();
  if (lowerUrl.endsWith('.zip') || lowerUrl.endsWith('.rar') || lowerUrl.endsWith('.7z')) {
    return {
      directUrl: intermediateUrl,
      filename: extractFilenameFromUrl(intermediateUrl),
      sourceUrl: intermediateUrl,
    };
  }

  const hostname = new URL(intermediateUrl).hostname.toLowerCase();

  if (hostname.includes('ouo.io') || hostname.includes('ouo.press')) {
    const resolved = await resolveOuoIo(intermediateUrl);
    const next = await resolveDirectDownloadUrl(resolved.directUrl, depth + 1);
    return {
      ...next,
      filename: resolved.filename || next.filename,
    };
  }

  const browser = await getSharedBrowser();
  const { page, context } = await createStealthPage(browser, undefined, intermediateUrl);

  try {
    await page.goto(intermediateUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    if (hostname.includes('mediafire.com')) {
      const result = await resolveMediaFire(page, intermediateUrl);
      return { ...result, sourceUrl: intermediateUrl };
    }

    const result = await resolveGeneric(page, intermediateUrl);
    return { ...result, sourceUrl: intermediateUrl };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * ouo.io 短链接解析
 */
async function resolveOuoIo(
  ouoUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  cleanExpiredOuoCache();

  const cached = ouoCache.get(ouoUrl);
  if (cached && cached.expires > Date.now()) {
    console.log(`[ZipDL] ouo.io: 使用缓存结果 → ${cached.directUrl.substring(0, 60)}`);
    return { directUrl: cached.directUrl, filename: cached.filename };
  }

  const browser = await getSharedBrowser();
  const { page, context } = await createStealthPage(browser, undefined, ouoUrl);

  try {
    console.log(`[ZipDL] ouo.io: 导航到 ${ouoUrl}`);
    await page.goto(ouoUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const currentUrl = page.url();
    if (currentUrl.includes('/shorten') || currentUrl.includes('/go/shorten')) {
      throw new Error('ouo.io IP 限速：被重定向到 /shorten 页面，请等待 5-10 分钟后重试');
    }

    await humanWait();
    await humanScroll(page, 1 + Math.floor(Math.random() * 2));

    console.log(`[ZipDL] ouo.io 第一步: 等待按钮激活...`);
    await page
      .waitForFunction(
        () => {
          const btn = document.querySelector('#btn-main');
          if (!btn) return false;
          return !btn.classList.contains('disabled');
        },
        { timeout: 12000 },
      )
      .catch(() => {});

    await sleep(gaussianDelay(500, 200));

    console.log(`[ZipDL] ouo.io 第一步: 点击 "I'm a human"`);
    const navPromise = page
      .waitForNavigation({ timeout: 15000 })
      .catch(() => null);
    await humanClick(page, '#btn-main');
    await navPromise;

    const afterFirstClickUrl = page.url();
    if (afterFirstClickUrl.includes('/shorten')) {
      throw new Error('ouo.io IP 限速：第一步点击后被重定向到 /shorten');
    }

    await humanWait();

    console.log(`[ZipDL] ouo.io 第二步: 等待 "Get Link" 按钮激活 (URL: ${afterFirstClickUrl})`);
    await page
      .waitForFunction(
        () => {
          const btn = document.querySelector('#btn-main, .btn-main, button[type="submit"]');
          if (!btn) return false;
          return !btn.classList.contains('disabled');
        },
        { timeout: 12000 },
      )
      .catch(() => {});

    await humanScroll(page, 1);
    await sleep(gaussianDelay(800, 300));

    console.log(`[ZipDL] ouo.io 第二步: 点击 "Get Link"`);
    let capturedTargetUrl: string | null = null;
    const responseHandler = (response: import('playwright').Response): void => {
      const url = response.url();
      const headers = response.headers();
      const location = headers['location'];
      if (location && !location.includes('ouo.io') && !location.includes('ouo.press')) {
        console.log(`[ZipDL] ouo.io: 从响应头捕获重定向目标: ${location}`);
        capturedTargetUrl = location;
        return;
      }
      if (!url.includes('ouo.io') && !url.includes('ouo.press') && !url.includes('chrome-error')) {
        console.log(`[ZipDL] ouo.io: 从响应捕获目标 URL: ${url}`);
        capturedTargetUrl = url;
      }
    };
    page.on('response', responseHandler);

    const nav2 = page
      .waitForNavigation({ timeout: 15000 })
      .catch(() => null);
    await humanClick(page, '#btn-main, .btn-main, button[type="submit"]');
    await nav2;

    page.off('response', responseHandler);

    const finalUrl = page.url();
    console.log(`[ZipDL] ouo.io: 跳转结果 URL = ${finalUrl}`);

    if ((finalUrl.startsWith('chrome-error://') || finalUrl === 'about:blank') && capturedTargetUrl) {
      console.log(`[ZipDL] ouo.io: 页面加载失败，从响应中捕获目标 URL: ${capturedTargetUrl}`);
      const result = {
        directUrl: capturedTargetUrl,
        filename: extractFilenameFromUrl(capturedTargetUrl),
      };
      ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
      return result;
    }

    if (finalUrl.startsWith('chrome-error://')) {
      throw new Error('ouo.io 跳转失败：目标页面加载错误且未捕获到目标 URL');
    }

    if (!finalUrl.includes('ouo.io') && !finalUrl.includes('ouo.press')) {
      const result = {
        directUrl: finalUrl,
        filename: extractFilenameFromUrl(finalUrl),
      };
      ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
      return result;
    }

    console.log(`[ZipDL] ouo.io: 仍在 ouo 域名，尝试第三步...`);
    await sleep(gaussianDelay(3000, 500));
    const btn3 = await page.evaluate(() => {
      const btn = document.querySelector('#btn-main, .btn-main, button');
      if (!btn) return null;
      const text = (btn.textContent || '').trim().toLowerCase();
      if (text.includes('get link') || text.includes('continue') || text.includes('proceed')) {
        return true;
      }
      return null;
    });

    if (btn3) {
      console.log(`[ZipDL] ouo.io 第三步: 点击按钮`);
      const nav3 = page
        .waitForNavigation({ timeout: 15000 })
        .catch(() => null);
      await humanClick(page, '#btn-main, .btn-main, button');
      await nav3;

      const url3 = page.url();
      console.log(`[ZipDL] ouo.io 第三步: 跳转结果 URL = ${url3}`);
      if (!url3.includes('ouo.io') && !url3.includes('ouo.press')) {
        const result = {
          directUrl: url3,
          filename: extractFilenameFromUrl(url3),
        };
        ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
        return result;
      }
    }

    throw new Error(`ouo.io 解析失败：两步点击后仍在 ouo.io（${finalUrl}）`);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * MediaFire 解析
 */
async function resolveMediaFire(
  page: import('playwright').Page,
  originalUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  console.log(`[ZipDL] MediaFire: 等待下载按钮...`);

  await humanWait();
  await humanScroll(page, 2);

  const downloadButton = await page
    .waitForSelector('#downloadButton, .download-btn, a[href*="download"]', {
      timeout: 10000,
    })
    .catch(() => null);

  let filename = extractFilenameFromUrl(originalUrl);

  const pageFilename = await page
    .evaluate(() => {
      const dlBtn = document.querySelector('#downloadButton, .download-btn');
      if (dlBtn) {
        const text = dlBtn.textContent?.trim() || '';
        const match = text.match(/[\w.\-]+\.(zip|rar|7z)/i);
        if (match) return match[0];
      }
      const title = document.querySelector('.filename, .dl-title, h1')?.textContent?.trim();
      if (title) {
        const match = title.match(/[\w.\-]+\.(zip|rar|7z)/i);
        if (match) return match[0];
        return `${title.trim()}.zip`;
      }
      return null;
    })
    .catch(() => null);

  if (pageFilename) {
    filename = sanitizeFilename(pageFilename);
  }

  if (downloadButton) {
    const href = await downloadButton.getAttribute('href').catch(() => null);
    if (href && href.startsWith('http')) {
      console.log(`[ZipDL] MediaFire: 按钮直接含直链 → ${href.substring(0, 80)}`);
      return { directUrl: href, filename };
    }
  }

  if (downloadButton) {
    console.log(`[ZipDL] MediaFire: 点击下载按钮，等待倒计时...`);
    const btnSelector = await page.evaluate(() => {
      const btn = document.querySelector('#downloadButton, .download-btn');
      if (btn?.id) return `#${btn.id}`;
      if (btn?.className) return `.${btn.className.split(' ')[0]}`;
      return '#downloadButton';
    }).catch(() => '#downloadButton');
    await humanClick(page, btnSelector);
  }

  for (let i = 0; i < MEDIAFIRE_COUNTDOWN_MAX; i++) {
    await sleep(1000);

    const directUrl = await page
      .evaluate(() => {
        const link =
          document.querySelector('a.DLExtraWait-link') ||
          document.querySelector('#download_link a') ||
          document.querySelector('.DLExtraWait a') ||
          document.querySelector('a[href*="download"][href*="mediafire.com"]');

        if (link) {
          const href = link.getAttribute('href') || (link as HTMLAnchorElement).href;
          if (href && href.startsWith('http') && href.includes('download')) {
            return href;
          }
        }

        const popupLink = document.querySelector('.popup a[href*="download"]');
        if (popupLink) {
          const href = popupLink.getAttribute('href');
          if (href && href.startsWith('http')) return href;
        }

        return null;
      })
      .catch(() => null);

    if (directUrl) {
      console.log(`[ZipDL] MediaFire: 直链提取成功 → ${directUrl.substring(0, 80)}`);
      return { directUrl, filename };
    }
  }

  throw new Error('MediaFire 解析超时：未找到直链');
}

/**
 * 通用中转站解析
 */
async function resolveGeneric(
  page: import('playwright').Page,
  originalUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  const filename = extractFilenameFromUrl(originalUrl);

  const directUrl = await page
    .evaluate(() => {
      const zipExtensions = ['.zip', '.rar', '.7z'];
      const links = Array.from(document.querySelectorAll('a[href]'));

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const fullHref = link instanceof HTMLAnchorElement ? link.href : href;
        const lower = fullHref.toLowerCase();

        if (zipExtensions.some((ext) => lower.endsWith(ext))) {
          return fullHref;
        }
      }

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const fullHref = link instanceof HTMLAnchorElement ? link.href : href;
        const lower = fullHref.toLowerCase();

        if (
          (lower.includes('download') || lower.includes('dl=')) &&
          !lower.includes('login') &&
          !lower.includes('signup')
        ) {
          return fullHref;
        }
      }

      const metaRefresh = document.querySelector('meta[http-equiv="refresh"]');
      if (metaRefresh) {
        const content = metaRefresh.getAttribute('content') || '';
        const match = content.match(/url=(.+)/i);
        if (match) {
          const url = match[1].trim();
          if (url.startsWith('http')) return url;
          return new URL(url, window.location.href).href;
        }
      }

      return null;
    })
    .catch(() => null);

  if (directUrl) {
    return { directUrl, filename };
  }

  throw new Error('通用解析失败：页面中未找到下载链接');
}
