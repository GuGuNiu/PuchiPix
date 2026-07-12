/**
 * 模块：ZIP 压缩包下载器（v2.0 反检测 + 多线程增强版）
 *
 * 处理从中转站（ouo.io → MediaFire 等）下载 ZIP 压缩包并解压的完整流程。
 *
 * v2.0 改进：
 * - 人类行为模拟：鼠标轨迹、随机延迟、真实点击时序，降低 ouo.io/Cloudflare 检测概率
 * - ouo.io URL 缓存：解析成功后缓存直链，重试时不重复访问 ouo.io 避免触发 IP 限速
 * - 多线程分块下载：使用 HTTP Range 请求并行下载，速度提升 3-5 倍
 * - 智能重试策略：中转站解析和文件下载独立重试，解析失败不浪费已缓存的直链
 *
 * 流程：
 * 1. 从数据库读取 GalleryDownloadInfo，获取中转站 URL（通常为 ouo.io 短链接）
 * 2. 解析中转站链路：ouo.io 广告页 → MediaFire 下载页 → 直链（带缓存）
 * 3. 多线程下载 ZIP 文件到本地（支持进度跟踪）
 * 4. 使用密码解压到图库目录
 * 5. 更新数据库状态和路径
 *
 * 支持的中转站链路：
 * - ouo.io：广告短链接，需点击/等待后获取真实 URL
 * - MediaFire：页面有 #downloadButton，点击后等待倒计时出现直链
 * - 直接链接：URL 以 .zip/.rar 结尾时直接下载
 * - 通用模式：尝试在页面中查找下载链接
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 * @lastModified 2026-07-12
 */

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

// ============================================================
// 常量
// ============================================================

const DEFAULT_ZIP_PATH = './data/gallery_zips';
const MAX_RETRIES = 3;
const DOWNLOAD_TIMEOUT = 300000;
const MEDIAFIRE_COUNTDOWN_MAX = 30;
const PARALLEL_CHUNK_COUNT = 4;

/** ouo.io 解析结果缓存（ouoUrl → directUrl），避免重试时重复访问触发 IP 限速 */
const ouoCache = new Map<string, { directUrl: string; filename: string; expires: number }>();
const OUO_CACHE_TTL = 10 * 60 * 1000;

// ============================================================
// 工具函数
// ============================================================

function getZipRoot(): string {
  return process.env.GALLERY_ZIP_PATH || DEFAULT_ZIP_PATH;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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
    // 忽略
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

// ============================================================
// 中转站解析器
// ============================================================

/**
 * 使用 Playwright 解析中转站页面，获取直链
 *
 * 链路：ouo.io → MediaFire → 直链
 *
 * 策略：
 * 1. ouo.io：广告短链接，等待倒计时后点击按钮获取真实 URL，然后递归解析
 * 2. MediaFire：等待 #downloadButton 可见 → 点击 → 等待直链出现
 * 3. 通用：查找页面中所有指向 .zip/.rar/.7z 的链接
 * 4. 如果页面本身就是直链（URL 以 .zip 结尾），直接返回
 *
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */
async function resolveDirectDownloadUrl(
  intermediateUrl: string,
  depth: number = 0,
): Promise<{ directUrl: string; filename: string; sourceUrl: string }> {
  if (depth > 3) {
    throw new Error('中转站解析深度超限（最多 3 层跳转）');
  }

  // 防御：chrome-error:// 或 about:blank 等无效 URL
  if (intermediateUrl.startsWith('chrome-error://') || intermediateUrl === 'about:blank') {
    throw new Error(`无效的中转站 URL: ${intermediateUrl}`);
  }

  // 如果 URL 本身看起来就是直链，直接返回
  const lowerUrl = intermediateUrl.toLowerCase();
  if (lowerUrl.endsWith('.zip') || lowerUrl.endsWith('.rar') || lowerUrl.endsWith('.7z')) {
    return {
      directUrl: intermediateUrl,
      filename: extractFilenameFromUrl(intermediateUrl),
      sourceUrl: intermediateUrl,
    };
  }

  const hostname = new URL(intermediateUrl).hostname.toLowerCase();

  // ouo.io 短链接解析
  if (hostname.includes('ouo.io') || hostname.includes('ouo.press')) {
    const resolved = await resolveOuoIo(intermediateUrl);
    // ouo.io 解析后通常得到 MediaFire 链接，递归解析
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
 * ouo.io 页面结构（2026-07 实测）：
 * 1. 页面含 #form-captcha 表单，POST 到 /go/{id}
 * 2. Cloudflare Turnstile 不可见验证码自动填充 cf-turnstile-response
 * 3. AdsCore 脚本填充 v-token（signature）
 * 4. setTimeout 2.5s 后 #btn-main 按钮激活（className 移除 disabled）
 * 5. 点击 "I'm a human" 按钮提交表单 → 跳转到目标 URL
 * 6. 部分链路有两步：第一跳后到达第二个 ouo.io 页面，再次点击
 * 7. 备用路径：页面中的 /fbc/{id} 链接可直接跳过验证码
 *
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */
async function resolveOuoIo(
  ouoUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  // 检查缓存：如果 10 分钟内已解析过同一 ouo.io 链接，直接返回缓存结果
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

    // 检查是否被 IP 限速重定向到 /shorten 页面
    const currentUrl = page.url();
    if (currentUrl.includes('/shorten') || currentUrl.includes('/go/shorten')) {
      throw new Error('ouo.io IP 限速：被重定向到 /shorten 页面，请等待 5-10 分钟后重试');
    }

    // 模拟人类浏览行为：等待 + 随机滚动
    await humanWait();
    await humanScroll(page, 1 + Math.floor(Math.random() * 2));

    console.log(`[ZipDL] ouo.io 第一步: 等待按钮激活...`);
    // 第一步：等待 #btn-main 按钮激活（2.5s 后由页面 setTimeout 移除 disabled 类）
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

    // 人类行为：点击前再等一小段时间
    await sleep(gaussianDelay(500, 200));

    console.log(`[ZipDL] ouo.io 第一步: 点击 "I'm a human"`);
    // 使用人类行为模拟点击
    const navPromise = page
      .waitForNavigation({ timeout: 15000 })
      .catch(() => null);
    await humanClick(page, '#btn-main');
    await navPromise;

    // 检查是否被限速
    const afterFirstClickUrl = page.url();
    if (afterFirstClickUrl.includes('/shorten')) {
      throw new Error('ouo.io IP 限速：第一步点击后被重定向到 /shorten');
    }

    // 人类行为：页面跳转后等待内容加载
    await humanWait();

    console.log(`[ZipDL] ouo.io 第二步: 等待 "Get Link" 按钮激活 (URL: ${afterFirstClickUrl})`);
    // 第二步：/go/{id} 页面有 "Get Link" 按钮，点击后跳转到目标站点
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

    // 人类行为：点击前随机滚动 + 等待
    await humanScroll(page, 1);
    await sleep(gaussianDelay(800, 300));

    console.log(`[ZipDL] ouo.io 第二步: 点击 "Get Link"`);
    // 在点击前设置响应监听器，捕获 ouo.io 重定向的目标 URL
    // 即使目标页面加载失败（chrome-error://），也能从响应中获取真实 URL
    let capturedTargetUrl: string | null = null;
    const responseHandler = (response: import('playwright').Response) => {
      const url = response.url();
      if (!url.includes('ouo.io') && !url.includes('ouo.press') && !url.includes('chrome-error')) {
        capturedTargetUrl = url;
      }
    };
    page.on('response', responseHandler);

    // 使用人类行为模拟点击 "Get Link"
    const nav2 = page
      .waitForNavigation({ timeout: 15000 })
      .catch(() => null);
    await humanClick(page, '#btn-main, .btn-main, button[type="submit"]');
    await nav2;

    page.off('response', responseHandler);

    const finalUrl = page.url();
    console.log(`[ZipDL] ouo.io: 跳转结果 URL = ${finalUrl}`);

    // 如果页面加载失败（chrome-error://），使用从响应中捕获的目标 URL
    if ((finalUrl.startsWith('chrome-error://') || finalUrl === 'about:blank') && capturedTargetUrl) {
      console.log(`[ZipDL] ouo.io: 页面加载失败，从响应中捕获目标 URL: ${capturedTargetUrl}`);
      const result = {
        directUrl: capturedTargetUrl,
        filename: extractFilenameFromUrl(capturedTargetUrl),
      };
      ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
      return result;
    }

    // 检测 chrome-error 但未捕获到目标 URL 的情况
    if (finalUrl.startsWith('chrome-error://')) {
      throw new Error('ouo.io 跳转失败：目标页面加载错误且未捕获到目标 URL');
    }

    // 已跳转到目标站点（ouo.io 和 ouo.press 都算）
    if (!finalUrl.includes('ouo.io') && !finalUrl.includes('ouo.press')) {
      const result = {
        directUrl: finalUrl,
        filename: extractFilenameFromUrl(finalUrl),
      };
      ouoCache.set(ouoUrl, { ...result, expires: Date.now() + OUO_CACHE_TTL });
      return result;
    }

    // 第三步：极少数情况仍有第三层页面，再次尝试点击
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
 * 1. 页面加载后出现 #downloadButton 或 .download-btn
 * 2. 点击后显示倒计时（通常 10-15 秒）
 * 3. 倒计时结束后出现直链 <a> 元素
 * 4. 直链域名通常为 download###.mediafire.com
 *
 * @date 2026-07-11
 */
async function resolveMediaFire(
  page: import('playwright').Page,
  originalUrl: string,
): Promise<{ directUrl: string; filename: string }> {
  console.log(`[ZipDL] MediaFire: 等待下载按钮...`);

  // 人类行为：页面加载后先等待 + 滚动
  await humanWait();
  await humanScroll(page, 2);

  // 等待下载按钮出现
  const downloadButton = await page
    .waitForSelector('#downloadButton, .download-btn, a[href*="download"]', {
      timeout: 10000,
    })
    .catch(() => null);

  let filename = extractFilenameFromUrl(originalUrl);

  // 尝试从页面提取文件名
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

  // 如果按钮是 <a> 标签，直接获取 href
  if (downloadButton) {
    const href = await downloadButton.getAttribute('href').catch(() => null);
    if (href && href.startsWith('http')) {
      console.log(`[ZipDL] MediaFire: 按钮直接含直链 → ${href.substring(0, 80)}`);
      return { directUrl: href, filename };
    }
  }

  // 点击下载按钮触发倒计时（使用人类行为模拟）
  if (downloadButton) {
    console.log(`[ZipDL] MediaFire: 点击下载按钮，等待倒计时...`);
    // 获取按钮的选择器用于人类点击
    const btnSelector = await page.evaluate(() => {
      const btn = document.querySelector('#downloadButton, .download-btn');
      if (btn?.id) return `#${btn.id}`;
      if (btn?.className) return `.${btn.className.split(' ')[0]}`;
      return '#downloadButton';
    }).catch(() => '#downloadButton');
    await humanClick(page, btnSelector);
  }

  // 等待直链出现（最多等 30 秒）
  for (let i = 0; i < MEDIAFIRE_COUNTDOWN_MAX; i++) {
    await sleep(1000);

    const directUrl = await page
      .evaluate(() => {
        // MediaFire 倒计时结束后会出现 .DLExtraWait a 或 #download_link
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

        // 也检查弹出窗口中的链接
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
 * @date 2026-07-11
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

      // 检查 meta refresh
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

// ============================================================
// 文件下载
// ============================================================

/**
 * 下载文件到指定路径
 *
 * 支持重定向跟踪和进度回调。
 * 如果目标文件已存在且大小 > 0，视为已下载（断点续传简化版）。
 *
 * @date 2026-07-11
 */
function downloadFile(
  url: string,
  filePath: string,
  headers: Record<string, string> = {},
  onProgress?: (downloaded: number, total: number) => void,
): Promise<{ success: boolean; fileSize: number; savedPath: string }> {
  return new Promise((resolve) => {
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

    const finish = (result: { success: boolean; fileSize: number; savedPath: string }) => {
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
        // 处理重定向
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
          downloadFile(absoluteRedirect, filePath, headers, onProgress).then(resolve);
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

        // 从 Content-Disposition 提取文件名，确定最终保存路径
        const cdFilename = extractFilenameFromHeaders(response.headers);
        if (cdFilename) {
          const dir = path.dirname(filePath);
          const newPath = path.join(dir, sanitizeFilename(cdFilename));
          if (newPath !== filePath) {
            actualPath = newPath;
          }
        }

        // 创建写入流，手动写入数据避免 pipe 与 data 事件的竞态
        const writeStream = fs.createWriteStream(actualPath);
        let lastProgressLog = 0;

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          writeStream.write(chunk);
          if (onProgress) onProgress(downloaded, total);
          // 每 5MB 输出一次进度
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

// ============================================================
// ZIP 解压
// ============================================================

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
 * @date 2026-07-11
 * @lastModified 2026-07-12
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
 * @date 2026-07-12
 * @lastModified 2026-07-12
 */
async function extractRar(
  rarPath: string,
  extractPath: string,
  password?: string,
): Promise<{ success: boolean; fileCount: number; files: string[] }> {
  try {
    const data = new Uint8Array(fs.readFileSync(rarPath));
    const extractor = await createExtractorFromData({
      data,
      password: password || '',
    });

    const extracted = extractor.extract({ password: password || undefined });
    const files: string[] = [];

    for (const file of extracted.files) {
      if (!file.fileHeader.flags.directory) {
        const fileName = file.fileHeader.name;
        const destPath = path.join(extractPath, fileName);

        ensureDir(path.dirname(destPath));

        if (file.extraction) {
          fs.writeFileSync(destPath, Buffer.from(file.extraction));
        }
        files.push(fileName);
      }
    }

    console.log(`[ZipDL] RAR 解压成功: ${files.length} 个文件`);
    return { success: true, fileCount: files.length, files };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('PASSWORD') || msg.includes('password')) {
      try {
        const data = new Uint8Array(fs.readFileSync(rarPath));
        const extractor = await createExtractorFromData({ data, password: '' });
        const extracted = extractor.extract();
        const files: string[] = [];

        for (const file of extracted.files) {
          if (!file.fileHeader.flags.directory) {
            const fileName = file.fileHeader.name;
            const destPath = path.join(extractPath, fileName);

            ensureDir(path.dirname(destPath));

            if (file.extraction) {
              fs.writeFileSync(destPath, Buffer.from(file.extraction));
            }
            files.push(fileName);
          }
        }
        console.log(`[ZipDL] RAR 无密码解压成功: ${files.length} 个文件`);
        return { success: true, fileCount: files.length, files };
      } catch {
        // 确实需要密码但密码错误
      }
    }

    console.error(`[ZipDL] RAR 解压失败: ${msg}`);
    return { success: false, fileCount: 0, files: [] };
  }
}

/**
 * 使用 adm-zip 解压 ZIP 文件
 *
 * @date 2026-07-11
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
        // 确实需要密码但密码错误
      }
    }

    console.error(`[ZipDL] ZIP 解压失败: ${msg}`);
    return { success: false, fileCount: 0, files: [] };
  }
}

// ============================================================
// 主流程
// ============================================================

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
 * 完整流程：
 * 1. 从数据库读取下载信息
 * 2. 检查是否有可用的下载 URL（支持手动传入）
 * 3. 解析中转站获取直链
 * 4. 下载 ZIP 文件
 * 5. 解压到图库目录
 * 6. 更新数据库状态
 *
 * @param galleryId - 图库 ID
 * @param manualUrl - 手动传入的下载 URL（覆盖数据库中的 URL）
 * @date 2026-07-11
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

    // 解析标题中的预期图片/视频数量
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

    // ----------------------------------------------------------
    // 阶段 1：解析中转站获取直链
    // ----------------------------------------------------------

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

      // 保存解析后的直链到数据库
      await prisma.galleryDownloadInfo.update({
        where: { galleryId },
        data: { resolvedDirectUrl: directUrl },
      });
    } else {
      filename = extractFilenameFromUrl(downloadUrl);
    }

    console.log(`[ZipDL] 直链: ${directUrl}`);
    console.log(`[ZipDL] 文件名: ${filename}`);

    // ----------------------------------------------------------
    // 阶段 2：多线程下载 ZIP 文件
    // ----------------------------------------------------------

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

    // ----------------------------------------------------------
    // 阶段 3：解压
    // ----------------------------------------------------------

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

    // 更新解压信息
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

    // ----------------------------------------------------------
    // 阶段 4：内容校验
    // ----------------------------------------------------------

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
        reason: verification.reason,
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
