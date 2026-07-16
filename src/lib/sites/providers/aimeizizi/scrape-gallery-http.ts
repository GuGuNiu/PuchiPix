import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
} from '@/types';
import { MAX_GALLERY_PAGES, randomDelay, sleep, buildAntiCrawlerHeaders } from '@/lib/core/anti-crawler';
import { logT } from '@/lib/i18n/server';
import { detectWaf } from '@/lib/core/waf-detector';
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';
import * as cheerio from 'cheerio';
import {
  SITE_DOMAINS,
  domainHealthTracker,
  extractArticleId,
  extractDomainFromUrl,
  type GalleryPageMetadata,
} from './constants';
import { parseGalleryPageHtml, parseZipInfoFromHtml } from './html-parser';
import type { ScrapeDeps } from './scrape-deps';

/**
 * 使用 HTTP fetch + cheerio 爬取图库（无浏览器，含翻页、域名回退）
 */
export async function scrapeGalleryHttp(
  pageUrl: string,
  deps: ScrapeDeps,
): Promise<GalleryScrapeResult> {
  const hT0 = Date.now();
  const hLog = (msg: string): void => console.log(`[HttpScrapeTiming] ${Date.now() - hT0}ms — ${msg}`);
  hLog(`开始 HTTP 爬取: ${pageUrl}`);

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
      hLog(`HTTP 请求第一页: ${tryUrl}`);
      const resp = await fetch(tryUrl, {
        headers: buildAntiCrawlerHeaders(domain),
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (resp.status === 403 || resp.status === 429) {
        domainHealthTracker.markRateLimited(domain);
        hLog(`域名 ${domain} 返回 ${resp.status}（WAF 限流），切换`);
        continue;
      }
      if (resp.status === 404) {
        hLog(`域名 ${domain} 返回 404`);
        continue;
      }
      if (!resp.ok) {
        hLog(`域名 ${domain} 返回 ${resp.status}`);
        continue;
      }

      const html = await resp.text();
      const try$ = cheerio.load(html);

      const wafResult = detectWaf(resp.status, html, try$);
      if (wafResult.blocked) {
        domainHealthTracker.markRateLimited(domain);
        hLog(`域名 ${domain} 被 WAF 拦截: ${wafResult.detail}，切换`);
        continue;
      }

      const articleEl = try$('article').first();
      const h1Text = try$('h1').first().text().trim();
      const titleText = try$('title').text().trim();
      if (articleEl.length === 0 && !h1Text && !titleText) {
        hLog(`域名 ${domain} HTML 无有效内容 (article=${articleEl.length}, h1="${h1Text.substring(0, 20)}")，尝试下一个域名`);
        continue;
      }

      $ = try$;
      usedDomain = domain;
      usedUrl = tryUrl;
      domainHealthTracker.markHealthy(domain);
      hLog(`第一页获取成功 (${html.length} bytes)`);
      break;
    } catch (err) {
      hLog(`域名 ${domain} 请求失败: ${err instanceof Error ? err.message : err}`);
      continue;
    }
  }

  if (!$) {
    throw new Error('所有域名 HTTP 请求均失败');
  }

  const firstPageData = parseGalleryPageHtml($, 0);
  hLog(`第一页解析完成: ${firstPageData.images.length} 图片, ${firstPageData.videos.length} 视频, 总页数=${firstPageData.totalPages}`);

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
  hLog(`ZIP 信息提取: ${zipInfo ? '有' : '无'}`);

  const GALLERY_HTTP_DELAY_MIN = 200;
  const GALLERY_HTTP_DELAY_MAX = 400;

  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    hLog(`HTTP 请求第 ${pageNum}/${totalPages} 页`);
    await sleep(randomDelay(GALLERY_HTTP_DELAY_MIN, GALLERY_HTTP_DELAY_MAX));

    let pageData: GalleryPageMetadata | null = null;
    const pageUrlConstructed = `${usedDomain}/article/${articleId}/page/${pageNum}/`;

    try {
      const resp = await fetch(pageUrlConstructed, {
        headers: buildAntiCrawlerHeaders(usedDomain),
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
              headers: buildAntiCrawlerHeaders(fbDomain),
              redirect: 'follow',
              signal: AbortSignal.timeout(10000),
            });
            if (!fbResp.ok) continue;
            const fbHtml = await fbResp.text();
            const fb$ = cheerio.load(fbHtml);
            pageData = parseGalleryPageHtml(fb$, pageNum - 1);
            usedDomain = fbDomain;
            domainHealthTracker.markHealthy(fbDomain);
            hLog(`第 ${pageNum} 页切换到域名 ${fbDomain} 成功`);
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
      hLog(`第 ${pageNum} 页请求失败: ${err instanceof Error ? err.message : err}`);
      const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
      for (const fbDomain of fallbackDomains) {
        if (fbDomain === usedDomain) continue;
        const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
        try {
          const fbResp = await fetch(fbUrl, {
            headers: buildAntiCrawlerHeaders(fbDomain),
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });
          if (!fbResp.ok) continue;
          const fbHtml = await fbResp.text();
          const fb$ = cheerio.load(fbHtml);
          pageData = parseGalleryPageHtml(fb$, pageNum - 1);
          usedDomain = fbDomain;
          hLog(`第 ${pageNum} 页切换到域名 ${fbDomain} 成功`);
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
  hLog(`翻页完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

  const title = deps.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
  hLog(`标题清洗: "${title.substring(0, 40)}"`);
  const protagonist = await deps.extractProtagonist(title, firstPageData.tags);
  hLog(`主角提取: "${protagonist}"`);
  const description = deps.extractDescription(title, protagonist);

  const blockCheck = await deps.checkContentBlockedAsync(title, firstPageData.category, protagonist);
  if (blockCheck.blocked) {
    throw new Error(`内容被屏蔽: ${blockCheck.reason}`);
  }

  const metaKeywordsStr = $('meta[name="keywords"]').attr('content') || '';
  const metaKeywords = metaKeywordsStr
    .split(/[,，;；]/)
    .map((t) => t.trim())
    .filter((t) => t && t.length < 50);

  const allTags = [...new Set([...firstPageData.tags, ...metaKeywords])];

  const gameCharMatches = await getGameCharacterService().identifyInTags(allTags);
  const gameCharacters = gameCharMatches.map((m) => m.character.name);

  if (zipInfo && zipInfo.downloadUrl === '' && articleId) {
    try {
      hLog('调用 eligibility API');
      const apiUrl = `${usedDomain}/api/download/eligibility?page_id=${articleId}&next=${encodeURIComponent(`/article/${articleId}/`)}`;
      const eligResp = await fetch(apiUrl, {
        headers: buildAntiCrawlerHeaders(usedDomain),
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
      hLog('eligibility API 完成');
    } catch {
      hLog('eligibility API 失败');
    }
  }

  hLog(`HTTP 爬取全部完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

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
