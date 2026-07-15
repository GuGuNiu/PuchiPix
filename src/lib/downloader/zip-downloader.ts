import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import AdmZip from 'adm-zip';
import { createExtractorFromData } from 'node-unrar-js';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { ttlLock } from '@/lib/core/ttl-lock';
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
import { parallelDownload } from '@/lib/downloader/parallel-downloader';
import {
  generateEnglishZipName,
  detectDownloadSource,
  verifyExtractedContent,
  parseTitleCount,
} from '@/lib/downloader/gallery-content-verifier';

const DEFAULT_ZIP_PATH = './data/gallery_zips';
const MAX_RETRIES = 3;
const DOWNLOAD_TIMEOUT = 300000;
const MEDIAFIRE_COUNTDOWN_MAX = 30;
const PARALLEL_CHUNK_COUNT = 8;

/** ouo.io 解析结果缓存（ouoUrl → directUrl），避免重试时重复访问触发 IP 限速 */
const ouoCache = new Map<string, { directUrl: string; filename: string; expires: number }>();
const OUO_CACHE_TTL = 10 * 60 * 1000;
const OUO_CACHE_MAX_SIZE = 50;

/** 清理 ouoCache 中的过期条目，防止 Map 无限增长 */
function cleanExpiredOuoCache(): void {
  const now = Date.now();
  for (const [key, val] of ouoCache) {
    if (val.expires <= now) {
      ouoCache.delete(key);
    }
  }
  if (ouoCache.size > OUO_CACHE_MAX_SIZE) {
    const entries = [...ouoCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
    const toRemove = entries.slice(0, ouoCache.size - OUO_CACHE_MAX_SIZE);
    for (const [key] of toRemove) {
      ouoCache.delete(key);
    }
  }
}

function getZipRoot(): string {
  return process.env.GALLERY_ZIP_PATH || DEFAULT_ZIP_PATH;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 下载封面图片到指定路径
 *
 * 简化版图片下载器，携带 Referer 绕过防盗链
 *
 */
const MAX_REDIRECTS_COVER = 5;

function downloadCoverImage(url: string, filePath: string, referer: string, redirects: number = 0): Promise<boolean> {
  return new Promise((resolve) => {
    if (redirects > MAX_REDIRECTS_COVER) {
      console.error(`[ZipDL] 封面下载重定向次数超限: ${url}`);
      resolve(false);
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      resolve(true);
      return;
    }

    let imageReferer = referer;
    try {
      const parsed = new URL(url);
      imageReferer = `${parsed.protocol}//${parsed.host}/`;
    } catch {}

    const protocol = url.startsWith('https://') ? https : http;
    const request = protocol.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': imageReferer,
          'sec-fetch-dest': 'image',
          'sec-fetch-mode': 'no-cors',
          'sec-fetch-site': 'same-origin',
        },
        timeout: 30000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          downloadCoverImage(absoluteRedirect, filePath, referer, redirects + 1).then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          console.error(`[ZipDL] 封面下载 HTTP ${response.statusCode}: ${url}`);
          resolve(false);
          return;
        }

        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve(true);
        });

        fileStream.on('error', (err) => {
          console.error(`[ZipDL] 封面文件写入失败 ${filePath}:`, err.message);
          fs.unlink(filePath, () => {});
          resolve(false);
        });
      },
    );

    request.on('error', (err) => {
      console.error(`[ZipDL] 封面下载失败 ${url}:`, err.message);
      resolve(false);
    });

    request.on('timeout', () => {
      request.destroy();
      console.error(`[ZipDL] 封面下载超时: ${url}`);
      resolve(false);
    });
  });
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/*?:"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
}

/**
 * 从 URL 中提取文件名
 */
function extractFilenameFromUrl(url: string): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const pathname = new URL(cleanUrl).pathname;
    const segments = pathname.split('/');
    const last = segments[segments.length - 1];
    if (last && last.length > 0) {
      return decodeURIComponent(last);
    }
  } catch {
  }
  return `gallery_zip_${Date.now()}.zip`;
}

/**
 * 从 Content-Disposition 头中提取文件名
 */
function extractFilenameFromHeaders(headers: http.IncomingHttpHeaders): string | null {
  const cd = headers['content-disposition'];
  if (!cd) return null;
  const match = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return null;
}

/**
 * 使用 Playwright 解析中转站页面，获取直链
 *
 * 链路：ouo.io → MediaFire → 直链
 *
 * 策略：
 - ouo.io：广告短链接，等待倒计时后点击按钮获取真实 URL，然后递归解析
 - MediaFire：等待 #downloadButton 可见 → 点击 → 等待直链出现
 - 通用：查找页面中所有指向 .zip/.rar/.7z 的链接
 - 如果页面本身就是直链（URL 以 .zip 结尾），直接返回
 *
 */
async function resolveDirectDownloadUrl(
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
 *
 * ouo.io 页面结构：
 - 页面含 #form-captcha 表单，POST 到 /go/{id}
 - Cloudflare Turnstile 不可见验证码自动填充 cf-turnstile-response
 - AdsCore 脚本填充 v-token（signature）
 - setTimeout 2.5s 后 #btn-main 按钮激活（className 移除 disabled）
 - 点击 "I'm a human" 按钮提交表单 → 跳转到目标 URL
 - 部分链路有两步：第一跳后到达第二个 ouo.io 页面，再次点击
 - 备用路径：页面中的 /fbc/{id} 链接可直接跳过验证码
 *
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
 *
 * MediaFire 下载流程：
 - 页面加载后出现 #downloadButton 或 .download-btn
 - 点击后显示倒计时（通常 10-15 秒）
 - 倒计时结束后出现直链 <a> 元素
 - 直链域名通常为 download###.mediafire.com
 *
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
 *
 * 在页面中查找所有可能的下载链接：
 * - <a> 标签的 href 指向 .zip/.rar/.7z
 * - <a> 标签的 href 包含 "download" 关键词
 * - meta refresh 跳转
 *
 */
async function resolveGeneric(
  page: import('playwright').Page,
  originalUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  const filename = extractFilenameFromUrl(originalUrl);

  const directUrl = await page
    .evaluate(() => {
      // 查找指向压缩文件的链接
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

      // 查找包含 "download" 的链接
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

/**
 * 下载文件到指定路径
 *
 * 支持重定向跟踪和进度回调。
 * 如果目标文件已存在且大小 > 0，视为已下载（断点续传简化版）。
 *
 */
const MAX_REDIRECTS_DOWNLOAD = 5;

function downloadFile(
  url: string,
  filePath: string,
  headers: Record<string, string> = {},
  onProgress?: (downloaded: number, total: number) => void,
  redirects: number = 0,
): Promise<{ success: boolean; fileSize: number; savedPath: string }> {
  return new Promise((resolve) => {
    if (redirects > MAX_REDIRECTS_DOWNLOAD) {
      console.error(`[ZipDL] 下载重定向次数超限: ${url}`);
      resolve({ success: false, fileSize: 0, savedPath: '' });
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      resolve({ success: true, fileSize: fs.statSync(filePath).size, savedPath: filePath });
      return;
    }

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    let downloaded = 0;
    let total = 0;
    let actualPath = filePath;
    let resolved = false;

    const finish = (result: { success: boolean; fileSize: number; savedPath: string }): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          ...headers,
        },
        timeout: DOWNLOAD_TIMEOUT,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          fs.unlink(filePath, () => {});
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          downloadFile(absoluteRedirect, filePath, headers, onProgress, redirects + 1).then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          fs.unlink(filePath, () => {});
          console.error(`[ZipDL] HTTP ${response.statusCode}: ${url}`);
          finish({ success: false, fileSize: 0, savedPath: '' });
          return;
        }

        total = parseInt(response.headers['content-length'] || '0', 10);
        console.log(`[ZipDL] 下载开始: ${actualPath} (Content-Length: ${total} bytes)`);

        const cdFilename = extractFilenameFromHeaders(response.headers);
        if (cdFilename) {
          const dir = path.dirname(filePath);
          const newPath = path.join(dir, sanitizeFilename(cdFilename));
          if (newPath !== filePath) {
            actualPath = newPath;
          }
        }

        const writeStream = fs.createWriteStream(actualPath);
        let lastProgressLog = 0;

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          writeStream.write(chunk);
          if (onProgress) onProgress(downloaded, total);
          if (total > 0 && downloaded - lastProgressLog >= 5 * 1024 * 1024) {
            const pct = Math.round((downloaded / total) * 100);
            console.log(`[ZipDL] 下载进度: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`);
            lastProgressLog = downloaded;
          }
        });

        response.on('end', () => {
          writeStream.end();
        });

        writeStream.on('finish', () => {
          console.log(`[ZipDL] 下载完成: ${actualPath} (${downloaded} bytes)`);
          finish({ success: true, fileSize: downloaded, savedPath: actualPath });
        });

        writeStream.on('error', (err) => {
          console.error(`[ZipDL] 文件写入失败 ${actualPath}:`, err.message);
          fs.unlink(actualPath, () => {});
          finish({ success: false, fileSize: 0, savedPath: '' });
        });
      },
    );

    request.on('error', (err) => {
      console.error(`[ZipDL] 下载失败 ${url}:`, err.message);
      fs.unlink(actualPath, () => {});
      finish({ success: false, fileSize: 0, savedPath: '' });
    });

    request.on('timeout', () => {
      request.destroy();
      console.error(`[ZipDL] 下载超时: ${url}`);
      fs.unlink(actualPath, () => {});
      finish({ success: false, fileSize: 0, savedPath: '' });
    });
  });
}

/**
 * 解压压缩文件到指定目录
 *
 * 根据文件扩展名自动选择解压器：
 * - .zip → adm-zip
 * - .rar → node-unrar-js (WASM)
 * - .7z → 暂不支持
 *
 * 支持密码保护，解压后返回文件列表。
 *
 */
async function extractArchive(
  archivePath: string,
  extractPath: string,
  password?: string,
): Promise<{ success: boolean; fileCount: number; files: string[] }> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === '.rar') {
    return extractRar(archivePath, extractPath, password);
  }

  // 默认使用 ZIP 解压器（也处理 .zip 文件）
  return extractZipFile(archivePath, extractPath, password);
}

/**
 * 使用 node-unrar-js 解压 RAR 文件
 *
 * ESM 模块仅导出 createExtractorFromData（内存模式），
 * 需手动读取文件到 Uint8Array 并写出解压结果。
 *
 */
/**
 * 检查解压路径是否安全（防止路径遍历攻击）
 *
 * 恶意压缩包可能包含 ../../ 等路径，解压时写到预期目录之外。
 *
 */
function isSafeExtractPath(destPath: string, extractBase: string): boolean {
  const resolvedDest = path.resolve(destPath);
  const resolvedBase = path.resolve(extractBase);
  return resolvedDest === resolvedBase || resolvedDest.startsWith(resolvedBase + path.sep);
}

/**
 * 解压 RAR 内的单个文件到目标路径，带路径遍历防护
 *
 * @returns true 如果文件被成功写出
 */
function writeRarFile(file: { fileHeader: { name: string; flags: { directory: boolean } }; extraction?: Uint8Array }, extractPath: string, files: string[]): boolean {
  if (file.fileHeader.flags.directory) return false;

  const fileName = file.fileHeader.name;
  const destPath = path.join(extractPath, fileName);

  if (!isSafeExtractPath(destPath, extractPath)) {
    console.warn(`[ZipDL] 跳过可疑路径: ${fileName}`);
    return false;
  }

  ensureDir(path.dirname(destPath));

  if (file.extraction) {
    fs.writeFileSync(destPath, Buffer.from(file.extraction));
  }
  files.push(fileName);
  return true;
}

async function extractRar(
  rarPath: string,
  extractPath: string,
  password?: string,
): Promise<{ success: boolean; fileCount: number; files: string[] }> {
  try {
    const data = fs.readFileSync(rarPath);
    const extractor = await createExtractorFromData({
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      password: password || '',
    });

    const extracted = extractor.extract({ password: password || undefined });
    const files: string[] = [];

    for (const file of extracted.files) {
      writeRarFile(file, extractPath, files);
    }

    console.log(`[ZipDL] RAR 解压成功: ${files.length} 个文件`);
    return { success: true, fileCount: files.length, files };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('PASSWORD') || msg.includes('password')) {
      try {
        const data = fs.readFileSync(rarPath);
        const extractor = await createExtractorFromData({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, password: '' });
        const extracted = extractor.extract();
        const files: string[] = [];

        for (const file of extracted.files) {
          writeRarFile(file, extractPath, files);
        }
        console.log(`[ZipDL] RAR 无密码解压成功: ${files.length} 个文件`);
        return { success: true, fileCount: files.length, files };
      } catch {
      }
    }

    console.error(`[ZipDL] RAR 解压失败: ${msg}`);
    return { success: false, fileCount: 0, files: [] };
  }
}

/**
 * 使用 adm-zip 解压 ZIP 文件
 *
 */
function extractZipFile(
  zipPath: string,
  extractPath: string,
  password?: string,
): { success: boolean; fileCount: number; files: string[] } {
  try {
    const zip = new AdmZip(zipPath);

    const entries = zip.getEntries();
    if (entries.length === 0) {
      return { success: false, fileCount: 0, files: [] };
    }

    zip.extractAllTo(extractPath, true, false, password || undefined);

    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) {
        files.push(entry.entryName);
      }
    }

    return { success: true, fileCount: files.length, files };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('password') || msg.includes('Password')) {
      try {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractPath, true);
        const entries = zip.getEntries();
        const files = entries.filter((e) => !e.isDirectory).map((e) => e.entryName);
        return { success: true, fileCount: files.length, files };
      } catch {
      }
    }

    console.error(`[ZipDL] ZIP 解压失败: ${msg}`);
    return { success: false, fileCount: 0, files: [] };
  }
}

export interface ZipDownloadResult {
  success: boolean;
  status: string;
  localPath: string;
  extractedPath: string;
  actualSize: number;
  fileCount: number;
  /** 下载来源 */
  downloadSource?: string;
  /** 英文 ZIP 文件名 */
  zipFileName?: string;
  /** 内容校验是否通过 */
  contentVerified?: boolean;
  /** 是否需要回退爬虫下载 */
  needsFallbackScrape?: boolean;
  /** 校验不匹配原因 */
  verifyReason?: string;
  error?: string;
}

/**
 * 下载并解压图库的 ZIP 压缩包
 *
 * @param galleryId - 图库 ID
 * @param manualUrl - 手动传入的下载 URL（覆盖数据库中的 URL）
 */
export async function downloadAndExtractZip(
  galleryId: number,
  manualUrl?: string,
): Promise<ZipDownloadResult> {
  const lockKey = `gallery:zip:${galleryId}`;
  const lockHandle = await ttlLock.acquire(lockKey, {
    ttl: 300000,
    waitTimeout: 5000,
  });

  if (!lockHandle) {
    throw new Error(`图库 #${galleryId} 的 ZIP 正在下载中`);
  }

  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: { downloadInfo: true },
    });

    if (!gallery) {
      throw new Error(`图库 #${galleryId} 不存在`);
    }

    if (!gallery.downloadInfo) {
      throw new Error(`图库 #${galleryId} 无 ZIP 下载信息`);
    }

    const downloadInfo = gallery.downloadInfo;
    const downloadUrl = manualUrl || downloadInfo.downloadUrl;

    if (!downloadUrl) {
      throw new Error('无可用下载 URL，请手动提供');
    }

    // 检测下载来源（ouo / mediafire / direct / unknown）
    const downloadSource = detectDownloadSource(downloadUrl);
    const isOuoSource = downloadSource === 'ouo';

    // 生成英文 ZIP 文件名
    const ext = path.extname(downloadUrl.split('?')[0]) || '.zip';
    const englishZipName = generateEnglishZipName(
      gallery.protagonist,
      gallery.description,
      galleryId,
      ext,
    );

    console.log(`[ZipDL] 下载来源: ${downloadSource}, 英文名: ${englishZipName}`);

    const { expectedImages, expectedVideos } = parseTitleCount(gallery.title);

    // 更新状态为下载中，同时保存来源和 ouo URL
    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        status: 'downloading',
        downloadSource,
        ouoUrl: isOuoSource ? downloadUrl : downloadInfo.ouoUrl,
        zipFileName: englishZipName,
      },
    });

    // 更新图库的预期数量和下载方式
    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        expectedImageCount: expectedImages,
        expectedVideoCount: expectedVideos,
        downloadMethod: 'zip',
      },
    });

    eventBus.emit('gallery:zipDownloadStarted', {
      galleryId,
      url: downloadUrl,
    });

    // 构建保存路径
    const zipDir = path.join(getZipRoot(), `gallery_${galleryId}`);
    ensureDir(zipDir);

    // 检查目录中是否已有下载好的压缩包（Content-Disposition 可能改了文件名）
    const existingArchive = fs.readdirSync(zipDir).find((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z');
    });

    let actualZipPath = '';
    let actualSize = BigInt(0);
    let skipDownload = false;

    if (existingArchive) {
      const existingPath = path.join(zipDir, existingArchive);
      const stat = fs.statSync(existingPath);
      if (stat.size > 0) {
        console.log(`[ZipDL] 发现已下载文件: ${existingArchive} (${stat.size} bytes)，跳过下载`);
        actualZipPath = existingPath;
        actualSize = BigInt(stat.size);
        skipDownload = true;

        await prisma.galleryDownloadInfo.update({
          where: { galleryId },
          data: { status: 'completed', localPath: actualZipPath, actualSize },
        });
      }
    }

    if (!skipDownload) {

    // 阶段 1：解析中转站获取直链
    let directUrl = downloadUrl;
    let filename = `gallery_${galleryId}.zip`;
    let refererUrl = downloadUrl;

    // 判断是否需要解析中转站
    const isDirectLink = /\.(zip|rar|7z)(\?|$)/i.test(downloadUrl);

    if (!isDirectLink) {
      console.log(`[ZipDL] 解析中转站: ${downloadUrl}`);

      let resolved: { directUrl: string; filename: string; sourceUrl: string } | null = null;
      let lastError: unknown = null;

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          resolved = await resolveDirectDownloadUrl(downloadUrl);
          break;
        } catch (err) {
          lastError = err;
          console.warn(
            `[ZipDL] 中转站解析失败（第 ${retry + 1} 次）:`,
            err instanceof Error ? err.message : err,
          );
          if (retry < MAX_RETRIES - 1) {
            await sleep(backoffDelay(retry, 2000, 10000));
          }
        }
      }

      if (!resolved) {
        const errMsg =
          lastError instanceof Error
            ? `中转站解析失败: ${lastError.message}`
            : '中转站解析失败';

        await prisma.galleryDownloadInfo.update({
          where: { galleryId },
          data: { status: 'failed' },
        });

        eventBus.emit('gallery:zipDownloadFailed', {
          galleryId,
          error: errMsg,
        });

        return {
          success: false,
          status: 'failed',
          localPath: '',
          extractedPath: '',
          actualSize: 0,
          fileCount: 0,
          error: errMsg,
        };
      }

      directUrl = resolved.directUrl;
      filename = resolved.filename || filename;
      refererUrl = resolved.sourceUrl || directUrl;

      await prisma.galleryDownloadInfo.update({
        where: { galleryId },
        data: { resolvedDirectUrl: directUrl },
      });
    } else {
      filename = extractFilenameFromUrl(downloadUrl);
    }

    console.log(`[ZipDL] 直链: ${directUrl}`);
    console.log(`[ZipDL] 文件名: ${filename}`);

    // 阶段 2：多线程下载 ZIP 文件
    const zipFilePath = path.join(zipDir, sanitizeFilename(filename));

    let downloadResult = {
      success: false,
      fileSize: 0,
      savedPath: '',
      parallelism: 0,
      avgSpeed: 0,
    };

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      const parallelResult = await parallelDownload(directUrl, zipFilePath, {
        chunkCount: PARALLEL_CHUNK_COUNT,
        headers: { Referer: refererUrl },
        onProgress: (downloaded, total) => {
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100);
            eventBus.emit('gallery:zipDownloadProgress', {
              galleryId,
              downloaded,
              total,
              percent: pct,
            });
          }
        },
      });

      downloadResult = {
        success: parallelResult.success,
        fileSize: parallelResult.fileSize,
        savedPath: parallelResult.savedPath,
        parallelism: parallelResult.parallelism,
        avgSpeed: parallelResult.avgSpeed,
      };

      if (downloadResult.success) break;

      if (retry < MAX_RETRIES - 1) {
        console.warn(`[ZipDL] 下载重试（第 ${retry + 1} 次）`);
        await sleep(backoffDelay(retry, 3000, 15000));
      }
    }

    // 使用实际保存路径（Content-Disposition 可能重命名了文件）
    actualZipPath = downloadResult.savedPath || zipFilePath;

    if (!downloadResult.success || !fs.existsSync(actualZipPath)) {
      const errMsg = 'ZIP 文件下载失败';

      await prisma.galleryDownloadInfo.update({
        where: { galleryId },
        data: { status: 'failed' },
      });

      eventBus.emit('gallery:zipDownloadFailed', { galleryId, error: errMsg });

      return {
        success: false,
        status: 'failed',
        localPath: '',
        extractedPath: '',
        actualSize: 0,
        fileCount: 0,
        error: errMsg,
      };
    }

    actualSize = BigInt(fs.statSync(actualZipPath).size);

    // 将压缩包重命名为英文名
    const englishZipPath = path.join(zipDir, englishZipName);
    if (actualZipPath !== englishZipPath) {
      try {
        if (fs.existsSync(englishZipPath)) {
          fs.unlinkSync(englishZipPath);
        }
        fs.renameSync(actualZipPath, englishZipPath);
        actualZipPath = englishZipPath;
        console.log(`[ZipDL] 压缩包重命名: → ${englishZipName}`);
      } catch (err) {
        console.warn(`[ZipDL] 重命名失败，保留原文件名:`, err instanceof Error ? err.message : err);
      }
    }

    // 更新下载信息（含并行数、速度、英文名）
    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        status: 'completed',
        localPath: actualZipPath,
        actualSize,
        zipFileName: englishZipName,
        parallelism: downloadResult.parallelism,
        avgSpeed: downloadResult.avgSpeed,
      },
    });

    eventBus.emit('gallery:zipDownloadCompleted', {
      galleryId,
      localPath: actualZipPath,
      actualSize: Number(actualSize),
    });

    console.log(`[ZipDL] ZIP 下载完成: ${actualZipPath} (${actualSize} bytes)`);
    } // end if (!skipDownload)

    // 阶段 3：解压
    const extractDir = path.join(
      gallery.savePath || path.join(getZipRoot(), `gallery_${galleryId}`),
      'zip_extracted',
    );
    ensureDir(extractDir);

    console.log(`[ZipDL] 开始解压: ${actualZipPath} → ${extractDir} (密码: ${downloadInfo.password ? '有' : '无'})`);

    const extractResult = await extractArchive(actualZipPath, extractDir, downloadInfo.password || undefined);

    if (!extractResult.success) {
      await prisma.galleryDownloadInfo.update({
        where: { galleryId },
        data: {
          status: 'failed',
          localPath: actualZipPath,
          actualSize,
        },
      });

      eventBus.emit('gallery:zipExtractFailed', {
        galleryId,
        error: '解压失败',
      });

      return {
        success: false,
        status: 'failed',
        localPath: actualZipPath,
        extractedPath: '',
        actualSize: Number(actualSize),
        fileCount: 0,
        error: 'ZIP 解压失败（密码可能不正确）',
      };
    }

    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        status: 'completed',
        localPath: actualZipPath,
        extractedPath: extractDir,
        actualSize,
        fileCount: extractResult.fileCount,
      },
    });

    // 阶段 4：内容校验
    const verification = verifyExtractedContent(extractDir, expectedImages, expectedVideos);

    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        verifiedCount: verification.totalCount,
        countMatched: verification.matched,
      },
    });

    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        contentVerified: true,
      },
    });

    if (!verification.matched) {
      console.warn(`[ZipDL] 内容校验不通过: ${verification.reason}`);
      eventBus.emit('gallery:zipVerifyFailed', {
        galleryId,
        reason: verification.reason ?? '',
        expectedImages,
        actualImages: verification.imageCount,
        expectedVideos,
        actualVideos: verification.videoCount,
      });
    } else {
      console.log(`[ZipDL] 内容校验通过: 图片 ${verification.imageCount}, 视频 ${verification.videoCount}`);
    }

    eventBus.emit('gallery:zipExtractCompleted', {
      galleryId,
      extractedPath: extractDir,
      fileCount: extractResult.fileCount,
    });

    console.log(
      `[ZipDL] 解压完成: ${extractDir}（${extractResult.fileCount} 个文件）`,
    );

    // 阶段 5：下载封面图到 cover/ 子目录（用于资源架展示）
    if (gallery.coverUrl && !gallery.coverLocalPath) {
      const galleryBasePath = gallery.savePath || path.join(getZipRoot(), `gallery_${galleryId}`);
      const coverDir = path.join(galleryBasePath, 'cover');
      if (!fs.existsSync(coverDir)) {
        fs.mkdirSync(coverDir, { recursive: true });
      }
      const coverExt = (() => {
        try {
          const cleanUrl = gallery.coverUrl.split('?')[0].split('#')[0];
          const ext = path.extname(cleanUrl).toLowerCase();
          if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return ext;
        } catch {}
        return '.jpg';
      })();
      const coverFilePath = path.join(coverDir, `cover${coverExt}`);

      if (!fs.existsSync(coverFilePath) || fs.statSync(coverFilePath).size === 0) {
        let coverDownloaded = false;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          coverDownloaded = await downloadCoverImage(gallery.coverUrl, coverFilePath, gallery.sourceUrl);
          if (coverDownloaded) break;
          if (retry < MAX_RETRIES - 1) {
            await sleep(backoffDelay(retry, 1000, 8000));
          }
        }
        if (coverDownloaded) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { coverLocalPath: coverFilePath, savePath: galleryBasePath },
          });
          console.log(`[ZipDL] 图库 #${galleryId} 封面下载成功: ${coverFilePath}`);
        } else {
          console.error(`[ZipDL] 图库 #${galleryId} 封面下载失败: ${gallery.coverUrl}`);
        }
      } else {
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { coverLocalPath: coverFilePath },
        });
      }
    }

    return {
      success: true,
      status: 'completed',
      localPath: actualZipPath,
      extractedPath: extractDir,
      actualSize: Number(actualSize),
      fileCount: extractResult.fileCount,
      downloadSource,
      zipFileName: englishZipName,
      contentVerified: verification.matched,
      needsFallbackScrape: verification.needsFallbackScrape,
      verifyReason: verification.reason,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    await prisma.galleryDownloadInfo
      .update({
        where: { galleryId },
        data: { status: 'failed' },
      })
      .catch(() => {});

    eventBus.emit('gallery:zipDownloadFailed', { galleryId, error: errMsg });

    return {
      success: false,
      status: 'failed',
      localPath: '',
      extractedPath: '',
      actualSize: 0,
      fileCount: 0,
      error: errMsg,
    };
  } finally {
    ttlLock.releaseHandle(lockHandle);
  }
}
