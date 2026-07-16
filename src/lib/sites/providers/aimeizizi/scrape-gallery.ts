import type { Page } from 'playwright';
import type {
  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
} from '@/types';
import { MAX_GALLERY_PAGES, randomDelay, sleep } from '@/lib/core/anti-crawler';
import { logT } from '@/lib/i18n/server';
import { getGameCharacterService } from '@/lib/game-characters/game-character-service';
import {
  SITE_DOMAINS,
  domainHealthTracker,
  extractArticleId,
  extractDomainFromUrl,
  type GalleryPageMetadata,
} from './constants';
import { extractGalleryPageData, extractZipDownloadInfo } from './page-evaluators';
import type { ScrapeDeps } from './scrape-deps';

export async function scrapeGallery(
  page: Page,
  pageUrl: string,
  deps: ScrapeDeps,
): Promise<GalleryScrapeResult> {
  const sT0 = Date.now();
  const sLog = (msg: string): void => console.log(`[ScrapeGalleryTiming] ${Date.now() - sT0}ms — ${msg}`);
  sLog('开始');

  const firstPageData = await extractGalleryPageData(page, 0);
  sLog(`第一页数据提取完成: ${firstPageData.images.length} 张图片, ${firstPageData.videos.length} 个视频, 总页数=${firstPageData.totalPages}`);

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
  sLog(`第一页图片/视频去重完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

  const zipInfo = await extractZipDownloadInfo(page);
  sLog(`ZIP 信息提取完成: ${zipInfo ? '有' : '无'}`);

  const articleId = extractArticleId(pageUrl);
  let currentDomain = extractDomainFromUrl(pageUrl);

  const GALLERY_PAGE_DELAY_MIN = 300;
  const GALLERY_PAGE_DELAY_MAX = 600;

  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    sLog(`开始翻页第 ${pageNum}/${totalPages} 页`);
    await sleep(randomDelay(GALLERY_PAGE_DELAY_MIN, GALLERY_PAGE_DELAY_MAX));

    let pageData: GalleryPageMetadata | null = null;

    try {
      const pageUrlConstructed = `${pageUrl.replace(/\/$/, '')}/page/${pageNum}/`;
      const response = await page.goto(pageUrlConstructed, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      const httpStatus = response?.status();
      if (httpStatus === 403 || httpStatus === 429) {
        domainHealthTracker.markRateLimited(currentDomain);
        console.warn(logT('log.aimeizizi.domainRateLimited', { page: pageNum, status: httpStatus, domain: currentDomain }));

        if (articleId) {
          const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
          for (const fbDomain of fallbackDomains) {
            if (fbDomain === currentDomain) continue;
            const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
            try {
              const fbResp = await page.goto(fbUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 15000,
              });
              const fbStatus = fbResp?.status();
              if (fbStatus === 403 || fbStatus === 429) {
                domainHealthTracker.markRateLimited(fbDomain);
                continue;
              }
              await page.waitForSelector('article', { timeout: 3000 }).catch(() => {});
              pageData = await extractGalleryPageData(page, pageNum - 1);
              currentDomain = fbDomain;
              domainHealthTracker.markHealthy(fbDomain);
              console.log(logT('log.aimeizizi.domainSwitchSuccess', { page: pageNum, domain: fbDomain }));
              break;
            } catch (fbErr) {
              console.warn(logT('log.aimeizizi.domainSwitchFailed', { page: pageNum, domain: fbDomain, msg: fbErr instanceof Error ? fbErr.message : String(fbErr) }));
              continue;
            }
          }
        }
      } else {
        await page.waitForSelector('article', { timeout: 3000 }).catch(() => {});
        pageData = await extractGalleryPageData(page, pageNum - 1);
      }
    } catch (err) {
      console.error(logT('log.aimeizizi.scrapePageFailed', { page: pageNum, domain: currentDomain }), err);

      if (articleId) {
        const fallbackDomains = domainHealthTracker.getAllDomainsOrdered(SITE_DOMAINS);
        for (const fbDomain of fallbackDomains) {
          if (fbDomain === currentDomain) continue;
          const fbUrl = `${fbDomain}/article/${articleId}/page/${pageNum}/`;
          try {
            await page.goto(fbUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForSelector('article', { timeout: 3000 }).catch(() => {});
            pageData = await extractGalleryPageData(page, pageNum - 1);
            currentDomain = fbDomain;
            console.log(logT('log.aimeizizi.domainSwitchSuccess', { page: pageNum, domain: fbDomain }));
            break;
          } catch {
            continue;
          }
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

  const title = deps.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
  sLog(`标题清洗完成: "${title.substring(0, 40)}"`);
  const protagonist = await deps.extractProtagonist(title, firstPageData.tags);
  sLog(`主角提取完成: "${protagonist}"`);
  const description = deps.extractDescription(title, protagonist);

  const blockCheck = await deps.checkContentBlockedAsync(title, firstPageData.category, protagonist);
  if (blockCheck.blocked) {
    console.log(logT('log.aimeizizi.blockedGalleryScrape', { title: title.substring(0, 50), reason: blockCheck.reason ?? '' }));
    throw new Error(`内容被屏蔽: ${blockCheck.reason}`);
  }

  const metaKeywordsStr = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="keywords"]');
    return meta?.getAttribute('content') || '';
  });
  const metaKeywords = metaKeywordsStr
    .split(/[,，;；]/)
    .map((t: string) => t.trim())
    .filter((t: string) => t && t.length < 50);

  const allTags = [...new Set([...firstPageData.tags, ...metaKeywords])];

  const gameCharMatches = await getGameCharacterService().identifyInTags(allTags);
  const gameCharacters = gameCharMatches.map((m) => m.character.name);
  if (gameCharacters.length > 0) {
    console.log(logT('log.aimeizizi.gameCharDetected', { chars: gameCharacters.join(', ') }));
  }
  sLog(`后处理完成: tags=${allTags.length}, 游戏角色=${gameCharacters.length}`);

  let scrapedDomain = '';
  try {
    const parsed = new URL(pageUrl);
    scrapedDomain = `${parsed.protocol}//${parsed.host}`;
  } catch {}

  sLog(`scrapeGallery 全部完成: 图片=${allImages.length}, 视频=${allVideos.length}`);

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
    scrapedDomain,
    zipInfo,
    gameCharacters: gameCharacters.length > 0 ? gameCharacters : undefined,
  };
}
