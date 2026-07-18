import {
  randomUA,
  sleep,
  backoffDelay,
  createStealthPage,
  humanClick,
  humanWait,
  humanScroll,
  gaussianDelay,
} from '@/lib/core/stealth/anti-crawler';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { sanitizeFilename, extractFilenameFromUrl } from '@/lib/utils';
import {
  ouoCache,
  OUO_CACHE_TTL,
  MEDIAFIRE_COUNTDOWN_MAX,
  cleanExpiredOuoCache,
} from './constants';

/**
 * 浣跨敤 Playwright 瑙ｆ瀽涓浆绔欓〉闈紝鑾峰彇鐩撮摼
 *
 * 閾捐矾锛歰uo.io 鈫?MediaFire 鈫?鐩撮摼
 */
export async function resolveDirectDownloadUrl(
  intermediateUrl: string,
  depth: number = 0,
): Promise<{ directUrl: string; filename: string; sourceUrl: string }> {
  if (depth > 3) {
    throw new Error('涓浆绔欒В鏋愭繁搴﹁秴闄愶紙鏈€澶?3 灞傝烦杞級');
  }

  if (intermediateUrl.startsWith('chrome-error://') || intermediateUrl === 'about:blank') {
    throw new Error(`鏃犳晥鐨勪腑杞珯 URL: ${intermediateUrl}`);
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
 * ouo.io 鐭摼鎺ヨВ鏋?
 */
async function resolveOuoIo(
  ouoUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  cleanExpiredOuoCache();

  const cached = ouoCache.get(ouoUrl);
  if (cached && cached.expires > Date.now()) {
    console.log(`[ZipDL] ouo.io: 浣跨敤缂撳瓨缁撴灉 鈫?${cached.directUrl.substring(0, 60)}`);
    return { directUrl: cached.directUrl, filename: cached.filename };
  }

  const browser = await getSharedBrowser();
  const { page, context } = await createStealthPage(browser, undefined, ouoUrl);

  try {
    console.log(`[ZipDL] ouo.io: 瀵艰埅鍒?${ouoUrl}`);
    await page.goto(ouoUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const currentUrl = page.url();
    if (currentUrl.includes('/shorten') || currentUrl.includes('/go/shorten')) {
      throw new Error('ouo.io IP 闄愰€燂細琚噸瀹氬悜鍒?/shorten 椤甸潰锛岃绛夊緟 5-10 鍒嗛挓鍚庨噸璇?);
    }

    await humanWait();
    await humanScroll(page, 1 + Math.floor(Math.random() * 2));

    console.log(`[ZipDL] ouo.io 绗竴姝? 绛夊緟鎸夐挳婵€娲?..`);
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

    console.log(`[ZipDL] ouo.io 绗竴姝? 鐐瑰嚮 "I'm a human"`);
    const navPromise = page
      .waitForNavigation({ timeout: 15000 })
      .catch(() => null);
    await humanClick(page, '#btn-main');
    await navPromise;

    const afterFirstClickUrl = page.url();
    if (afterFirstClickUrl.includes('/shorten')) {
      throw new Error('ouo.io IP 闄愰€燂細绗竴姝ョ偣鍑诲悗琚噸瀹氬悜鍒?/shorten');
    }

    await humanWait();

    console.log(`[ZipDL] ouo.io 绗簩姝? 绛夊緟 "Get Link" 鎸夐挳婵€娲?(URL: ${afterFirstClickUrl})`);
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

    console.log(`[ZipDL] ouo.io 绗簩姝? 鐐瑰嚮 "Get Link"`);
    let capturedTargetUrl: string | null = null;
    const responseHandler = (response: import('playwright').Response): void => {
      const url = response.url();
      const headers = response.headers();
      const location = headers['location'];
      if (location && !location.includes('ouo.io') && !location.includes('ouo.press')) {
        console.log(`[ZipDL] ouo.io: 浠庡搷搴斿ご鎹曡幏閲嶅畾鍚戠洰鏍? ${location}`);
        capturedTargetUrl = location;
        return;
      }
      if (!url.includes('ouo.io') && !url.includes('ouo.press') && !url.includes('chrome-error')) {
        console.log(`[ZipDL] ouo.io: 浠庡搷搴旀崟鑾风洰鏍?URL: ${url}`);
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
    console.log(`[ZipDL] ouo.io: 璺宠浆缁撴灉 URL = ${finalUrl}`);

    if ((finalUrl.startsWith('chrome-error://') || finalUrl === 'about:blank') && capturedTargetUrl) {
      console.log(`[ZipDL] ouo.io: 椤甸潰鍔犺浇澶辫触锛屼粠鍝嶅簲涓崟鑾风洰鏍?URL: ${capturedTargetUrl}`);
      const result = {
        directUrl: capturedTargetUrl,
        filename: extractFilenameFromUrl(capturedTargetUrl),
      };
      ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
      return result;
    }

    if (finalUrl.startsWith('chrome-error://')) {
      throw new Error('ouo.io 璺宠浆澶辫触锛氱洰鏍囬〉闈㈠姞杞介敊璇笖鏈崟鑾峰埌鐩爣 URL');
    }

    if (!finalUrl.includes('ouo.io') && !finalUrl.includes('ouo.press')) {
      const result = {
        directUrl: finalUrl,
        filename: extractFilenameFromUrl(finalUrl),
      };
      ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
      return result;
    }

    console.log(`[ZipDL] ouo.io: 浠嶅湪 ouo 鍩熷悕锛屽皾璇曠涓夋...`);
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
      console.log(`[ZipDL] ouo.io 绗笁姝? 鐐瑰嚮鎸夐挳`);
      const nav3 = page
        .waitForNavigation({ timeout: 15000 })
        .catch(() => null);
      await humanClick(page, '#btn-main, .btn-main, button');
      await nav3;

      const url3 = page.url();
      console.log(`[ZipDL] ouo.io 绗笁姝? 璺宠浆缁撴灉 URL = ${url3}`);
      if (!url3.includes('ouo.io') && !url3.includes('ouo.press')) {
        const result = {
          directUrl: url3,
          filename: extractFilenameFromUrl(url3),
        };
        ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
        return result;
      }
    }

    throw new Error(`ouo.io 瑙ｆ瀽澶辫触锛氫袱姝ョ偣鍑诲悗浠嶅湪 ouo.io锛?{finalUrl}锛塦);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * MediaFire 瑙ｆ瀽
 */
async function resolveMediaFire(
  page: import('playwright').Page,
  originalUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  console.log(`[ZipDL] MediaFire: 绛夊緟涓嬭浇鎸夐挳...`);

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
      console.log(`[ZipDL] MediaFire: 鎸夐挳鐩存帴鍚洿閾?鈫?${href.substring(0, 80)}`);
      return { directUrl: href, filename };
    }
  }

  if (downloadButton) {
    console.log(`[ZipDL] MediaFire: 鐐瑰嚮涓嬭浇鎸夐挳锛岀瓑寰呭€掕鏃?..`);
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
        const link = (document.querySelector('a.DLExtraWait-link') ||
          document.querySelector('#download_link a') ||
          document.querySelector('.DLExtraWait a') ||
          document.querySelector('a[href*="download"][href*="mediafire.com"]')) as HTMLAnchorElement | null;

        if (link) {
          const href = link.getAttribute('href') || link.href;
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
      console.log(`[ZipDL] MediaFire: 鐩撮摼鎻愬彇鎴愬姛 鈫?${directUrl.substring(0, 80)}`);
      return { directUrl, filename };
    }
  }

  throw new Error('MediaFire 瑙ｆ瀽瓒呮椂锛氭湭鎵惧埌鐩撮摼');
}

/**
 * 閫氱敤涓浆绔欒В鏋?
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

  throw new Error('閫氱敤瑙ｆ瀽澶辫触锛氶〉闈腑鏈壘鍒颁笅杞介摼鎺?);
}
