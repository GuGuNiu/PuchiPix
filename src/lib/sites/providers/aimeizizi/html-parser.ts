import type * as cheerio from 'cheerio';
import type { GalleryZipInfo } from '@/types';
import type { GalleryPageMetadata } from './constants';
import { PLACEHOLDER_FRAGMENT } from './constants';

export function parseGalleryPageHtml($: cheerio.CheerioAPI, pageIndex: number): GalleryPageMetadata {
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

  result.h1Title = $('h1').first().text().trim();
  result.rawTitle = $('title').text().trim();

  const breadcrumb = $('nav[aria-label="Breadcrumb"]');
  if (breadcrumb.length > 0) {
    const links = breadcrumb.find('a');
    if (links.length >= 2) {
      result.category = links.last().text().trim();
    }
  }

  const tagSet = new Set<string>();
  $('a[href*="/tag/"]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text !== '标签' && text.length < 30) {
      tagSet.add(text);
    }
  });
  result.tags = Array.from(tagSet);

  $('nav').each((_, nav) => {
    const text = $(nav).text();
    const match = text.match(/第\s*(\d+)\s*[頁页].*?共\s*(\d+)\s*[頁页]/);
    if (match) {
      result.currentPage = parseInt(match[1]);
      result.totalPages = parseInt(match[2]);
    }
  });

  const article = $('article').first();
  if (article.length > 0) {
    article.find('img').each((_, img) => {
      const url =
        $(img).attr('data-src') ||
        $(img).attr('data-original-src') ||
        $(img).attr('data-original') ||
        $(img).attr('data-lazy-src') ||
        $(img).attr('src') ||
        '';

      if (
        url &&
        !url.includes(PLACEHOLDER_FRAGMENT) &&
        !url.includes('/static/images/Loading') &&
        !url.includes('data:image/')
      ) {
        result.images.push({ url, pageIndex });
      }
    });

    article.find('img').each((_, img) => {
      if (result.coverUrl) return;
      const url =
        $(img).attr('data-src') ||
        $(img).attr('data-original-src') ||
        $(img).attr('data-original') ||
        $(img).attr('data-lazy-src') ||
        $(img).attr('src') ||
        '';
      if (url && !url.includes(PLACEHOLDER_FRAGMENT) && !url.includes('/static/images/Loading')) {
        result.coverUrl = url;
      }
    });
  }

  $('video source[src*=".m3u8"]').each((_, source) => {
    const src = $(source).attr('src') || '';
    if (src && !result.videos.includes(src)) {
      result.videos.push(src);
    }
  });

  $('video source[src*=".mp4"]').each((_, source) => {
    const src = $(source).attr('src') || '';
    if (src && !result.videos.includes(src)) {
      result.videos.push(src);
    }
  });

  $('script').each((_, script) => {
    const content = $(script).html() || '';
    const matches = content.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi);
    if (matches) {
      for (const url of matches) {
        if (!result.videos.includes(url)) {
          result.videos.push(url);
        }
      }
    }
  });

  $('script[type="application/ld+json"]').each((_, script) => {
    if (result.publishTime) return;
    try {
      const data = JSON.parse($(script).html() || '') as { '@type'?: string; uploadDate?: string };
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
}

export function parseZipInfoFromHtml($: cheerio.CheerioAPI, domain: string): GalleryZipInfo | undefined {
  const box = $('.download-info-box');
  const section = $('.download-section');
  const btn = $('.btn-download');

  if (box.length === 0 && section.length === 0) return undefined;

  let fileCount = 0;
  let fileSizeText = '';
  let imageDimensions = '';
  let password = '';
  let title = '';

  title = box.find('.info-title').text().trim() || '';

  box.find('.info-item').each((_, item) => {
    const label = $(item).find('strong').text().trim() || '';
    const text = $(item).text().replace(label, '').trim();

    if (label.includes('文件数量') || label.includes('Files')) {
      const m = text.match(/(\d+)/);
      if (m) fileCount = parseInt(m[1]);
    } else if (label.includes('文件大小') || label.includes('Size')) {
      fileSizeText = text;
    } else if (label.includes('图片尺寸') || label.includes('Dimensions')) {
      imageDimensions = text;
    } else if (label.includes('密码') || label.includes('Password')) {
      const input = $(item).find('.password-input');
      password = input.val() as string || text;
    }
  });

  let downloadUrl = '';
  let provider = '';
  let requiresLogin = false;
  let requiresEmail = false;

  if (btn.length > 0) {
    provider = btn.attr('data-provider') || '';
    const href = btn.attr('href') || '';
    const label = btn.find('.download-label').text().trim() || '';

    if (provider === 'mediafire' || label.toLowerCase().includes('mediafire')) {
      provider = 'MediaFire';
    }

    if (href && href.startsWith('http') && href !== '#') {
      downloadUrl = href;
    } else if (href && href.startsWith('/') && !href.includes('/auth/login') && href !== '#') {
      downloadUrl = new URL(href, domain).href;
    }

    if (btn.hasClass('is-locked') || href.includes('/auth/login')) {
      requiresLogin = true;
    }
  }

  const noticeText = $('.download-notice-text').text().trim() || '';
  if (noticeText.includes('登录') || noticeText.includes('Login')) {
    requiresLogin = true;
  }
  if (noticeText.includes('邮箱') || noticeText.includes('验证') || noticeText.includes('Verify')) {
    requiresEmail = true;
  }

  const pageId = section.attr('data-page-id') || '';
  const eligibilityUrl = section.attr('data-eligibility-url') || '/api/download/eligibility';
  const nextUrl = section.attr('data-next-url') || '';

  if (!fileCount && !fileSizeText && !downloadUrl && !pageId) return undefined;

  const zipInfo: GalleryZipInfo = {
    title,
    fileCount,
    fileSizeText,
    imageDimensions,
    password,
    downloadUrl,
    provider,
    requiresLogin,
    requiresEmail,
  };

  if (!downloadUrl && pageId) {
    zipInfo._pageId = pageId;
    zipInfo._eligibilityUrl = eligibilityUrl;
    zipInfo._nextUrl = nextUrl;
  }

  return zipInfo;
}
