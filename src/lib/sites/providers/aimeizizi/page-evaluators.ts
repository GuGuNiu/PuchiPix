import type { Page } from 'playwright';
import type { ExtendedMetadata } from '../../types';
import type { GalleryZipInfo } from '@/types';
import { PLACEHOLDER_FRAGMENT, type GalleryPageMetadata } from './constants';
import * as cheerio from 'cheerio';
import { parseGalleryPageHtml, parseExtMetadata, parseSearchResults } from './html-parser';

export async function extractGalleryPageData(page: Page, pageIndex: number): Promise<GalleryPageMetadata> {
  const html = await page.content();
  const $ = cheerio.load(html);
  return parseGalleryPageHtml($, pageIndex);
}

export async function extractZipDownloadInfo(page: Page): Promise<GalleryZipInfo | undefined> {
  const zT0 = Date.now();
  const zLog = (msg: string): void => console.log(`[ZipInfoTiming] ${Date.now() - zT0}ms — ${msg}`);
  zLog('开始提取 ZIP 下载信息');

  const [boxEl, btnEl] = await Promise.all([
    page.$('.download-info-box'),
    page.$('.btn-download'),
  ]);
  if (!boxEl && !btnEl) {
    zLog('无下载信息元素跳过提取');
    return undefined;
  }
  zLog(`元素检测: box=${!!boxEl}, btn=${!!btnEl}`);

  if (boxEl) {
    await page.waitForSelector('.download-info-box', { timeout: 2000 }).catch(() => {});
  }
  if (btnEl) {
    await page.waitForSelector('.btn-download', { timeout: 2000 }).catch(() => {});
  }
  zLog('等待选择器完成');

  if (btnEl) {
    await page.waitForFunction(() => {
      const btn = document.querySelector('.btn-download');
      if (!btn) return true;
      return !btn.classList.contains('is-pending');
    }, { timeout: 5000 }).catch(() => {});
  }
  zLog('等待 is-pending 移除完成');

  const raw = await page.evaluate(() => {
    const section = document.querySelector('.download-section');
    const box = document.querySelector('.download-info-box');

    if (!box && !section) return null;

    const titleEl = box?.querySelector('.info-title');
    const title = titleEl?.textContent?.trim() || '';

    let fileCount = 0;
    let fileSizeText = '';
    let imageDimensions = '';
    let password = '';

    if (box) {
      const items = box.querySelectorAll('.info-item');
      items.forEach((item) => {
        const label = item.querySelector('strong')?.textContent?.trim() || '';
        const text = item.textContent?.replace(label, '').trim() || '';

        if (label.includes('文件数量') || label.includes('Files')) {
          const m = text.match(/(\d+)/);
          if (m) fileCount = parseInt(m[1]);
        } else if (label.includes('文件大小') || label.includes('Size')) {
          fileSizeText = text;
        } else if (label.includes('图片尺寸') || label.includes('Dimensions')) {
          imageDimensions = text;
        } else if (label.includes('密码') || label.includes('Password')) {
          const input = item.querySelector('.password-input') as HTMLInputElement | null;
          password = input?.value || text;
        }
      });
    }

    const downloadBtn = document.querySelector('.btn-download') as HTMLAnchorElement | null;
    let downloadUrl = '';
    let provider = '';
    let requiresLogin = false;
    let requiresEmail = false;

    if (downloadBtn) {
      provider = downloadBtn.getAttribute('data-provider') || '';
      const href = downloadBtn.getAttribute('href') || '';
      const label = downloadBtn.querySelector('.download-label')?.textContent?.trim() || '';

      if (provider === 'mediafire' || label.toLowerCase().includes('mediafire')) {
        provider = 'MediaFire';
      }

      if (href && href.startsWith('http') && href !== '#') {
        downloadUrl = href;
      } else if (href && href.startsWith('/') && !href.includes('/auth/login') && href !== '#') {
        downloadUrl = new URL(href, window.location.href).href;
      }

      if (downloadBtn.classList.contains('is-locked') || href.includes('/auth/login')) {
        requiresLogin = true;
      }
    }

    const noticeEl = document.querySelector('.download-notice-text');
    const noticeText = noticeEl?.textContent?.trim() || '';
    if (noticeText.includes('登录') || noticeText.includes('Login')) {
      requiresLogin = true;
    }
    if (noticeText.includes('邮箱') || noticeText.includes('验证') || noticeText.includes('Verify')) {
      requiresEmail = true;
    }

    const pageId = section?.getAttribute('data-page-id') || '';
    const eligibilityUrl = section?.getAttribute('data-eligibility-url') || '/api/download/eligibility';
    const nextUrl = section?.getAttribute('data-next-url') || '';

    return {
      title, fileCount, fileSizeText, imageDimensions, password,
      downloadUrl, provider, requiresLogin, requiresEmail,
      pageId, eligibilityUrl, nextUrl,
    };
  });

  if (!raw) return undefined;
  if (!raw.fileCount && !raw.fileSizeText && !raw.downloadUrl) return undefined;

  const zipInfo: GalleryZipInfo = {
    title: raw.title,
    fileCount: raw.fileCount,
    fileSizeText: raw.fileSizeText,
    imageDimensions: raw.imageDimensions,
    password: raw.password,
    downloadUrl: raw.downloadUrl,
    provider: raw.provider,
    requiresLogin: raw.requiresLogin,
    requiresEmail: raw.requiresEmail,
  };

  if (raw.pageId) {
    const nextParam = raw.nextUrl || `/article/${raw.pageId}/`;
    const apiUrl = `${raw.eligibilityUrl}?page_id=${raw.pageId}&next=${encodeURIComponent(nextParam)}`;

    try {
      zLog('开始调用 eligibility API');
      const eligResult = await page.evaluate(async (url) => {
        const resp = await fetch(url, { credentials: 'include' });
        return resp.json();
      }, apiUrl);
      zLog('eligibility API 调用完成');

      if (eligResult?.resolved_links && Array.isArray(eligResult.resolved_links) && eligResult.resolved_links.length > 0) {
        zipInfo.downloadUrl = eligResult.resolved_links[0];
        zipInfo.requiresLogin = false;
      }

      if (eligResult?.requires_registration) {
        zipInfo.requiresLogin = true;
      }
      if (eligResult?.requires_email_verification) {
        zipInfo.requiresEmail = true;
      }
    } catch {
      zLog('eligibility API 调用失败');
    }
  }
  zLog('ZIP 下载信息提取完成');
  return zipInfo;
}

export async function extractSearchResultsRaw(page: Page): Promise<{ url: string; title: string; coverUrl?: string; date?: string }[]> {
  const html = await page.content();
  const $ = cheerio.load(html);
  return parseSearchResults($, page.url());
}

export async function extractExtMetadataRaw(page: Page): Promise<{
  h1Title: string;
  category: string;
  tags: string[];
  keywordStr: string;
  coverUrl: string;
  documentTitle: string;
}> {
  const html = await page.content();
  const $ = cheerio.load(html);
  return parseExtMetadata($);
}
