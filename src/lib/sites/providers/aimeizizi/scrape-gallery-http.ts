import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
} from '@/types';
import { MAX_GALLERY_PAGES, randomDelay, sleep, buildStealthHeaders, randomProfile } from '@/lib/core/stealth/anti-crawler';
import { logT } from '@/lib/i18n/server';
import { detectWaf } from '@/lib/core/stealth/waf-detector';
import { getCharacterDBServiceAsync } from '@/lib/character-db';
import * as cheerio from 'cheerio';
import {
  SITE_DOMAINS,
  domainHealthTracker,
  extractArticleId,
  extractDomainFromUrl,
  type GalleryPageMetadata,
} from './constants';
import { parseGalleryPageHtml, parseZipInfoFromHtml, parseArticlePageConfig } from './html-parser';
import { requestWithRetry } from '@/lib/core/infra/http-client';
import type { ScrapeDeps } from '../aimeizizi-provider';

export async function scrapeGalleryHttp(
  pageUrl: string,
  deps: ScrapeDeps,
): Promise<GalleryScrapeResult> {
  const hT0 = Date.now();
  const hLog = (msg: string): void => console.log(`[HttpScrapeTiming] ${Date.now() - hT0}ms ${msg}`);
  hLog(`HTTP start: ${pageUrl}`);

  const articleId = extractArticleId(pageUrl);
  const urlDomain = extractDomainFromUrl(pageUrl);
  const orderedDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
  if (urlDomain && orderedDomains.includes(urlDomain)) {
    orderedDomains.splice(orderedDomains.indexOf(urlDomain), 1);
    orderedDomains.unshift(urlDomain);
  }

  let $: cheerio.CheerioAPI | null = null;
  let usedDomain = '';
  let usedUrl = pageUrl;

  for (const domain of orderedDomains) {
    const tryUrl = articleId
      ? `${domain}/article/${articleId}/`
      : pageUrl;
    try {
      hLog(`HTTP try: ${tryUrl}`);
      const resp = await fetch(tryUrl, {
        headers: buildStealthHeaders(randomProfile(), domain),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 403 || resp.status === 429) {
        domainHealthTracker.markRateLimited(domain);
        hLog(` ${domain} ${resp.status} blocked`);
        continue;
      }
      if (resp.status === 404) {
        hLog(` ${domain}  404`);
        continue;
      }
      if (!resp.ok) {
        hLog(` ${domain}  ${resp.status}`);
        continue;
      }

      const html = await resp.text();
      const try$ = cheerio.load(html);

      const wafResult = detectWaf(resp.status, html, try$);
      if (wafResult.blocked) {
        domainHealthTracker.markRateLimited(domain);
        hLog(` ${domain} WAF: ${wafResult.detail}`);
        continue;
      }

      const articleEl = try$('article').first();
      const h1Text = try$('h1').first().text().trim();
      const titleText = try$('title').text().trim();
      if (articleEl.length === 0 && !h1Text && !titleText) {
        hLog(` ${domain} HTML empty (article=${articleEl.length}, h1="${h1Text.substring(0, 20)}")`);
        continue;
      }

      $ = try$;
      usedDomain = domain;
      usedUrl = tryUrl;
      domainHealthTracker.markHealthy(domain);
      hLog(`(${html.length} bytes)`);
      break;
    } catch (err) {
      hLog(` ${domain} error: ${err instanceof Error ? err.message : err}`);
      continue;
    }
  }

  if (!$) {
    throw new Error('All HTTP domains failed to fetch page');
  }

  const firstPageData = parseGalleryPageHtml($, 0);
  const pageConfig = parseArticlePageConfig($);
  const configPageId = pageConfig?.pageId ?? null;
  const configTotalPages = pageConfig?.pagination?.total_pages ?? null;
  hLog(`page1: ${firstPageData.images.length} images, ${firstPageData.videos.length} videos, configPages=${configTotalPages ?? 'n/a'} htmlPages=${firstPageData.totalPages}`);

  const totalPages = Math.min(configTotalPages ?? firstPageData.totalPages, MAX_GALLERY_PAGES);

  const allImages: GalleryImageItem[] = [];
  const allVideos: GalleryVideoItem[] = [];
  const videoUrlSet = new Set<string>();
  const imageUrlSet = new Set<string>();

  let orderIndex = 0;
  for (const img of firstPageData.images) {
    const fullUrl = deps.resolveUrl(img.url, usedDomain);
    if (fullUrl && !imageUrlSet.has(fullUrl)) {
      imageUrlSet.add(fullUrl);
      allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
    }
  }
  for (const videoUrl of firstPageData.videos) {
    const fullUrl = deps.resolveUrl(videoUrl, usedDomain);
    if (fullUrl && !videoUrlSet.has(fullUrl)) {
      videoUrlSet.add(fullUrl);
      allVideos.push({ url: fullUrl });
    }
  }

  let zipInfo = parseZipInfoFromHtml($, usedDomain);
  hLog(`ZIP: ${zipInfo ? 'yes' : 'no'}`);

  const GALLERY_HTTP_DELAY_MIN = 200;
  const GALLERY_HTTP_DELAY_MAX = 400;

  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    hLog(`HTTP page ${pageNum}/${totalPages}`);
    await sleep(randomDelay(GALLERY_HTTP_DELAY_MIN, GALLERY_HTTP_DELAY_MAX));

    let pageData: GalleryPageMetadata | null = null;
    const pageUrlConstructed = `${usedDomain}/article/${articleId}/page/${pageNum}/`;

    try {
      const resp = await fetch(pageUrlConstructed, {
        headers: buildStealthHeaders(randomProfile(), usedDomain),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 403 || resp.status === 429) {
        domainHealthTracker.markRateLimited(usedDomain);
        const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
        for (const fbDomain of fallbackDomains) {
          if (fbDomain === usedDomain) continue;
          const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
          try {
            const fbResp = await fetch(fbUrl, {
              headers: buildStealthHeaders(randomProfile(), fbDomain),
              redirect: 'follow',
              signal: AbortSignal.timeout(10000),
            });
            if (!fbResp.ok) continue;
            const fbHtml = await fbResp.text();
            const fb$ = cheerio.load(fbHtml);
            pageData = parseGalleryPageHtml(fb$, pageNum - 1);
            usedDomain = fbDomain;
            domainHealthTracker.markHealthy(fbDomain);
            hLog(`page ${pageNum} fallback ${fbDomain}`);
            break;
          } catch {
            continue;
          }
        }
      } else if (resp.ok) {
        const html = await resp.text();
        const page$ = cheerio.load(html);
        pageData = parseGalleryPageHtml(page$, pageNum - 1);
      }
    } catch (err) {
      hLog(`page ${pageNum} error: ${err instanceof Error ? err.message : err}`);
      const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
      for (const fbDomain of fallbackDomains) {
        if (fbDomain === usedDomain) continue;
        const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
        try {
          const fbResp = await fetch(fbUrl, {
            headers: buildStealthHeaders(randomProfile(), fbDomain),
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });
          if (!fbResp.ok) continue;
          const fbHtml = await fbResp.text();
          const fb$ = cheerio.load(fbHtml);
          pageData = parseGalleryPageHtml(fb$, pageNum - 1);
          usedDomain = fbDomain;
          hLog(`page ${pageNum} fallback ${fbDomain}`);
          break;
        } catch {
          continue;
        }
      }
    }

    if (pageData) {
      for (const img of pageData.images) {
        const fullUrl = deps.resolveUrl(img.url, usedDomain);
        if (fullUrl && !imageUrlSet.has(fullUrl)) {
          imageUrlSet.add(fullUrl);
          allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
        }
      }
      for (const videoUrl of pageData.videos) {
        const fullUrl = deps.resolveUrl(videoUrl, usedDomain);
        if (fullUrl && !videoUrlSet.has(fullUrl)) {
          videoUrlSet.add(fullUrl);
          allVideos.push({ url: fullUrl });
        }
      }
    }
  }
  hLog(`page1 done: images=${allImages.length}, videos=${allVideos.length}`);

  const title = deps.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
  hLog(`title: "${title.substring(0, 40)}"`);
  const protagonist = await deps.extractProtagonist(title, firstPageData.tags);
  hLog(`protagonist: "${protagonist}"`);
  const description = deps.extractDescription(title, protagonist);

  const blockCheck = await deps.checkContentBlockedAsync(title, firstPageData.category, protagonist);
  if (blockCheck.blocked) {
    throw new Error(`Content blocked: ${blockCheck.reason || 'unknown reason'}`);
  }

  const metaKeywordsStr = $('meta[name="keywords"]').attr('content') || '';
  const metaKeywords = metaKeywordsStr
    .split(/[,]/)
    .map((t) => t.trim())
    .filter((t) => t && t.length < 50);

  const allTags = [...new Set([...firstPageData.tags, ...metaKeywords])];

  const db = await getCharacterDBServiceAsync();
  const gameCharMatches = db
    .identifyInTags(allTags)
    .filter(m => m.character.category === 'game');
  const gameCharacters = gameCharMatches.map((m) => m.character.name);

  const eligibilityPageId = configPageId ?? articleId;
  if (eligibilityPageId) {
    hLog(`eligibility API (pageId=${eligibilityPageId})`);
    const apiUrl = `${usedDomain}/api/download/eligibility?page_id=${eligibilityPageId}&next=${encodeURIComponent(`/article/${eligibilityPageId}/`)}`;
    const eligResult = await requestWithRetry(apiUrl, {
      headers: buildStealthHeaders(randomProfile(), usedDomain),
      fatal: false,
      retries: 2,
      timeout: 10000,
    });
    if (eligResult.ok && eligResult.body) {
      try {
        const eligData = JSON.parse(eligResult.body) as Record<string, unknown>;
        const resolvedLinks = eligData['resolved_links'];
        const hasResolvedLink = Array.isArray(resolvedLinks) && resolvedLinks.length > 0;
        if (hasResolvedLink || !zipInfo) {
          if (!zipInfo) {
            zipInfo = {
              title: pageConfig?.title?.baseTitle || firstPageData.h1Title || '',
              fileCount: 0,
              fileSizeText: '',
              imageDimensions: '',
              password: '',
              downloadUrl: '',
              provider: '',
              requiresLogin: false,
              requiresEmail: false,
            };
          }
          if (hasResolvedLink) {
            zipInfo.downloadUrl = resolvedLinks[0] as string;
            zipInfo.requiresLogin = false;
          }
        }
        if (zipInfo) {
          if (eligData['requires_registration']) {
            zipInfo.requiresLogin = true;
          }
          if (eligData['requires_email_verification']) {
            zipInfo.requiresEmail = true;
          }
        }
        hLog('eligibility API ok');
      } catch {
        hLog('eligibility API JSON parse failed');
      }
    } else {
      hLog(`eligibility API failed (status=${eligResult.status})`);
    }
  }

  hLog(`HTTP scrape done: images=${allImages.length}, videos=${allVideos.length}`);

  return {
    sourceUrl: pageUrl,
    title,
    protagonist,
    description,
    category: firstPageData.category,
    tags: allTags,
    coverUrl: deps.resolveUrl(firstPageData.coverUrl, usedDomain),
    publishTime: firstPageData.publishTime || undefined,
    images: allImages,
    videos: allVideos,
    pageCount: totalPages,
    imageCount: allImages.length,
    videoCount: allVideos.length,
    scrapedDomain: usedDomain,
    zipInfo,
    gameCharacters: gameCharacters.length > 0 ? gameCharacters : undefined,
  };
}
