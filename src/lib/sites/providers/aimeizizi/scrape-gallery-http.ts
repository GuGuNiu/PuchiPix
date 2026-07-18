﻿import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
} from '@/types';
import { MAX_GALLERY_PAGES, randomDelay, sleep, buildStealthHeaders, randomProfile } from '@/lib/core/stealth/anti-crawler';
import { logT } from '@/lib/i18n/server';
import { detectWaf } from '@/lib/core/stealth/waf-detector';
import { getCharacterDBService } from '@/lib/character-db';
import * as cheerio from 'cheerio';
import {
  SITE_DOMAINS,
  domainHealthTracker,
  extractArticleId,
  extractDomainFromUrl,
  type GalleryPageMetadata,
} from './constants';
import { parseGalleryPageHtml, parseZipInfoFromHtml } from './html-parser';
import type { ScrapeDeps } from '../aimeizizi-provider';

export async function scrapeGalleryHttp(
  pageUrl: string,
  deps: ScrapeDeps,
): Promise<GalleryScrapeResult> {
  const hT0 = Date.now();
  const hLog = (msg: string): void => console.log(`[HttpScrapeTiming] ${Date.now() - hT0}ms 鈥?${msg}`);
  hLog(`寮€濮?HTTP 鐖彇: ${pageUrl}`);

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
      hLog(`HTTP 璇锋眰绗竴椤? ${tryUrl}`);
      const resp = await fetch(tryUrl, {
        headers: buildStealthHeaders(randomProfile(), domain),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 403 || resp.status === 429) {
        domainHealthTracker.markRateLimited(domain);
        hLog(`鍩熷悕 ${domain} 杩斿洖 ${resp.status}锛圵AF 闄愭祦锛夛紝鍒囨崲`);
        continue;
      }
      if (resp.status === 404) {
        hLog(`鍩熷悕 ${domain} 杩斿洖 404`);
        continue;
      }
      if (!resp.ok) {
        hLog(`鍩熷悕 ${domain} 杩斿洖 ${resp.status}`);
        continue;
      }

      const html = await resp.text();
      const try$ = cheerio.load(html);

      const wafResult = detectWaf(resp.status, html, try$);
      if (wafResult.blocked) {
        domainHealthTracker.markRateLimited(domain);
        hLog(`鍩熷悕 ${domain} 琚?WAF 鎷︽埅: ${wafResult.detail}锛屽垏鎹);
        continue;
      }

      const articleEl = try$('article').first();
      const h1Text = try$('h1').first().text().trim();
      const titleText = try$('title').text().trim();
      if (articleEl.length === 0 && !h1Text && !titleText) {
        hLog(`鍩熷悕 ${domain} HTML 鏃犳湁鏁堝唴瀹?(article=${articleEl.length}, h1="${h1Text.substring(0, 20)}")锛屽皾璇曚笅涓€涓煙鍚峘);
        continue;
      }

      $ = try$;
      usedDomain = domain;
      usedUrl = tryUrl;
      domainHealthTracker.markHealthy(domain);
      hLog(`绗竴椤佃幏鍙栨垚鍔?(${html.length} bytes)`);
      break;
    } catch (err) {
      hLog(`鍩熷悕 ${domain} 璇锋眰澶辫触: ${err instanceof Error ? err.message : err}`);
      continue;
    }
  }

  if (!$) {
    throw new Error('鎵€鏈夊煙鍚?HTTP 璇锋眰鍧囧け璐?);
  }

  const firstPageData = parseGalleryPageHtml($, 0);
  hLog(`绗竴椤佃В鏋愬畬鎴? ${firstPageData.images.length} 鍥剧墖, ${firstPageData.videos.length} 瑙嗛, 鎬婚〉鏁?${firstPageData.totalPages}`);

  const totalPages = Math.min(firstPageData.totalPages, MAX_GALLERY_PAGES);

  const allImages: GalleryImageItem[] = [];
  const allVideos: GalleryVideoItem[] = [];
  const videoUrlSet = new Set<string>();
  const imageUrlSet = new Set<string>();

  let orderIndex = 0;
  for (const img of firstPageData.images) {
    const fullUrl = deps.resolveUrl(img.url);
    if (fullUrl && !imageUrlSet.has(fullUrl)) {
      imageUrlSet.add(fullUrl);
      allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
    }
  }
  for (const videoUrl of firstPageData.videos) {
    const fullUrl = deps.resolveUrl(videoUrl);
    if (fullUrl && !videoUrlSet.has(fullUrl)) {
      videoUrlSet.add(fullUrl);
      allVideos.push({ url: fullUrl });
    }
  }

  const zipInfo = parseZipInfoFromHtml($, usedDomain);
  hLog(`ZIP 淇℃伅鎻愬彇: ${zipInfo ? '鏈? : '鏃?}`);

  const GALLERY_HTTP_DELAY_MIN = 200;
  const GALLERY_HTTP_DELAY_MAX = 400;

  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    hLog(`HTTP 璇锋眰绗?${pageNum}/${totalPages} 椤礰);
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
            hLog(`绗?${pageNum} 椤靛垏鎹㈠埌鍩熷悕 ${fbDomain} 鎴愬姛`);
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
      hLog(`绗?${pageNum} 椤佃姹傚け璐? ${err instanceof Error ? err.message : err}`);
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
          hLog(`绗?${pageNum} 椤靛垏鎹㈠埌鍩熷悕 ${fbDomain} 鎴愬姛`);
          break;
        } catch {
          continue;
        }
      }
    }

    if (pageData) {
      for (const img of pageData.images) {
        const fullUrl = deps.resolveUrl(img.url);
        if (fullUrl && !imageUrlSet.has(fullUrl)) {
          imageUrlSet.add(fullUrl);
          allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
        }
      }
      for (const videoUrl of pageData.videos) {
        const fullUrl = deps.resolveUrl(videoUrl);
        if (fullUrl && !videoUrlSet.has(fullUrl)) {
          videoUrlSet.add(fullUrl);
          allVideos.push({ url: fullUrl });
        }
      }
    }
  }
  hLog(`缈婚〉瀹屾垚: 鍥剧墖=${allImages.length}, 瑙嗛=${allVideos.length}`);

  const title = deps.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
  hLog(`鏍囬娓呮礂: "${title.substring(0, 40)}"`);
  const protagonist = await deps.extractProtagonist(title, firstPageData.tags);
  hLog(`涓昏鎻愬彇: "${protagonist}"`);
  const description = deps.extractDescription(title, protagonist);

  const blockCheck = await deps.checkContentBlockedAsync(title, firstPageData.category, protagonist);
  if (blockCheck.blocked) {
    throw new Error(`鍐呭琚睆钄? ${blockCheck.reason}`);
  }

  const metaKeywordsStr = $('meta[name="keywords"]').attr('content') || '';
  const metaKeywords = metaKeywordsStr
    .split(/[,锛?锛沒/)
    .map((t) => t.trim())
    .filter((t) => t && t.length < 50);

  const allTags = [...new Set([...firstPageData.tags, ...metaKeywords])];

  const db = getCharacterDBService();
  if (!db.isLoaded()) {
    await db.load();
  }
  const gameCharMatches = db
    .identifyInTags(allTags)
    .filter(m => m.character.category === 'game');
  const gameCharacters = gameCharMatches.map((m) => m.character.name);

  if (zipInfo && zipInfo.downloadUrl === '' && articleId) {
    try {
      hLog('璋冪敤 eligibility API');
      const apiUrl = `${usedDomain}/api/download/eligibility?page_id=${articleId}&next=${encodeURIComponent(`/article/${articleId}/`)}`;
      const eligResp = await fetch(apiUrl, {
        headers: buildStealthHeaders(randomProfile(), usedDomain),
        signal: AbortSignal.timeout(10000),
      });
      if (eligResp.ok) {
        const eligResult = await eligResp.json() as Record<string, unknown>;
        const resolvedLinks = eligResult['resolved_links'];
        if (Array.isArray(resolvedLinks) && resolvedLinks.length > 0) {
          zipInfo.downloadUrl = resolvedLinks[0] as string;
          zipInfo.requiresLogin = false;
        }
        if (eligResult['requires_registration']) {
          zipInfo.requiresLogin = true;
        }
        if (eligResult['requires_email_verification']) {
          zipInfo.requiresEmail = true;
        }
      }
      hLog('eligibility API 瀹屾垚');
    } catch {
      hLog('eligibility API 澶辫触');
    }
  }

  hLog(`HTTP 鐖彇鍏ㄩ儴瀹屾垚: 鍥剧墖=${allImages.length}, 瑙嗛=${allVideos.length}`);

  return {
    sourceUrl: pageUrl,
    title,
    protagonist,
    description,
    category: firstPageData.category,
    tags: allTags,
    coverUrl: deps.resolveUrl(firstPageData.coverUrl),
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
