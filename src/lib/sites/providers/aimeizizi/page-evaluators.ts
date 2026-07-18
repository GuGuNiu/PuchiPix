import type { Page } from 'playwright';
import type { ExtendedMetadata } from '../../types';
import type { GalleryZipInfo } from '@/types';
import { PLACEHOLDER_FRAGMENT, type GalleryPageMetadata } from './constants';

export async function extractGalleryPageData(page: Page, pageIndex: number): Promise<GalleryPageMetadata> {
  return page.evaluate(
    ({ pageIndex, placeholderFragment }) => {
      const result: GalleryPageMetadata = {
        h1Title: '',
        rawTitle: '',
        tags: [],
        category: '',
        coverUrl: '',
        publishTime: '',
        currentPage: 1,
        totalPages: 1,
        images: [],
        videos: [],
      };

      const h1 = document.querySelector('h1');
      result.h1Title = h1?.textContent?.trim() || '';
      result.rawTitle = document.title;

      const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"]');
      if (breadcrumb) {
        const links = breadcrumb.querySelectorAll('a');
        if (links.length >= 2) {
          result.category = links[links.length - 1].textContent?.trim() || '';
        }
      }

      document.querySelectorAll('a[href*="/tag/"]').forEach((a) => {
        const text = a.textContent?.trim();
        if (text && text !== '标签' && text.length < 30 && !result.tags.includes(text)) {
          result.tags.push(text);
        }
      });

      const navs = document.querySelectorAll('nav');
      navs.forEach((nav) => {
        const text = nav.textContent || '';
        const match = text.match(/第\s*(\d+)\s*[頁页].*?共\s*(\d+)\s*[頁页]/);
        if (match) {
          result.currentPage = parseInt(match[1]);
          result.totalPages = parseInt(match[2]);
        }
      });

      const article = document.querySelector('article');
      if (article) {
        const imgs = article.querySelectorAll('img');
        imgs.forEach((img) => {
          const src = img.getAttribute('src') || '';
          const dataSrc = img.getAttribute('data-src') || '';
          const url = dataSrc || src;

          if (
            url &&
            !url.includes(placeholderFragment) &&
            !url.includes('/static/images/Loading') &&
            !url.includes('data:image/')
          ) {
            result.images.push({ url, pageIndex });
          }
        });
      }

      document.querySelectorAll('video source[src*=".m3u8"]').forEach((source) => {
        const src = source.getAttribute('src') || '';
        if (src) result.videos.push(src);
      });

      document.querySelectorAll('video source[src*=".mp4"]').forEach((source) => {
        const src = source.getAttribute('src') || '';
        if (src && !result.videos.includes(src)) {
          result.videos.push(src);
        }
      });

      document.querySelectorAll('script').forEach((script) => {
        const content = script.textContent || '';
        const matches = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
        if (matches) {
          matches.forEach((url) => {
            if (!result.videos.includes(url)) {
              result.videos.push(url);
            }
          });
        }
      });

      if (article) {
        const imgs = article.querySelectorAll('img');
        for (const img of imgs) {
          const src = img.getAttribute('src') || '';
          const dataSrc = img.getAttribute('data-src') || '';
          const url = dataSrc || src;
          if (url && !url.includes(placeholderFragment) && !url.includes('/static/images/Loading')) {
            result.coverUrl = url;
            break;
          }
        }
      }

      document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
        if (result.publishTime) return;
        try {
          const data = JSON.parse(script.textContent || '') as { '@type'?: string; uploadDate?: string };
          if (data['@type'] === 'VideoObject' && data.uploadDate) {
            result.publishTime = String(data.uploadDate).substring(0, 10);
          }
        } catch {}
      });

      if (!result.publishTime && result.coverUrl) {
        const match = result.coverUrl.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
        if (match) {
          result.publishTime = `${match[1]}-${match[2]}-${match[3]}`;
        }
      }

      return result;
    },
    { pageIndex, placeholderFragment: PLACEHOLDER_FRAGMENT },
  );
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
    zLog('无下载信息元素，跳过提取');
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
  return page.evaluate(() => {
    const results: { url: string; title: string; coverUrl?: string; date?: string }[] = [];
    const seen = new Set<string>();
    const PLACEHOLDER = '/static/zde/timg.gif';

    const resolveUrl = (raw: string | null | undefined): string | undefined => {
      if (!raw) return undefined;
      if (raw.includes(PLACEHOLDER) || raw.includes('/static/images/Loading')) return undefined;
      if (raw.startsWith('data:')) return undefined;
      try {
        return new URL(raw, window.location.href).href;
      } catch {
        return undefined;
      }
    };

    document.querySelectorAll('article').forEach((article) => {
      const link = article.querySelector('a[href*="/article/"]') as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.href;
      if (href && !seen.has(href)) {
        seen.add(href);

        const img = article.querySelector('img');
        const coverUrl =
          resolveUrl(img?.getAttribute('data-original-src')) ||
          resolveUrl(img?.getAttribute('data-src')) ||
          resolveUrl(img?.getAttribute('data-original')) ||
          resolveUrl(img?.getAttribute('src'));

        const titleEl = article.querySelector('h2 a') || link;
        const title =
          titleEl?.getAttribute('title') ||
          titleEl?.textContent?.trim() ||
          link.getAttribute('title') ||
          '';

        const timeEl = article.querySelector('footer time');
        const date = timeEl?.textContent?.trim() || undefined;

        results.push({ url: href, title, coverUrl, date });
      }
    });

    return results.slice(0, 30);
  });
}

export async function extractExtMetadataRaw(page: Page): Promise<{
  h1Title: string;
  category: string;
  tags: string[];
  keywordStr: string;
  coverUrl: string;
  documentTitle: string;
}> {
  return page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const h1Title = h1?.textContent?.trim() || '';

    const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"]');
    let category = '';
    if (breadcrumb) {
      const links = breadcrumb.querySelectorAll('a');
      if (links.length >= 2) {
        category = links[links.length - 1].textContent?.trim() || '';
      }
    }

    const tags: string[] = [];
    document.querySelectorAll('a[href*="/tag/"]').forEach((a) => {
      const text = a.textContent?.trim();
      if (text && text !== '标签' && text.length < 30 && !tags.includes(text)) {
        tags.push(text);
      }
    });

    const metaKeywords = document.querySelector('meta[name="keywords"]');
    const keywordStr = metaKeywords?.getAttribute('content') || '';

    let coverUrl = '';
    const article = document.querySelector('article');
    if (article) {
      const imgs = article.querySelectorAll('img');
      for (const img of imgs) {
        const src = img.getAttribute('src') || '';
        const dataSrc = img.getAttribute('data-src') || '';
        const url = dataSrc || src;
        if (url && !url.includes('/static/zde/timg.gif') && !url.includes('/static/images/Loading')) {
          coverUrl = url;
          break;
        }
      }
    }

    return { h1Title, category, tags, keywordStr, coverUrl, documentTitle: document.title };
  });
}
