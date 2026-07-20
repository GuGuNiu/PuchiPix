import type { Page } from 'playwright';
import { loggers } from '@/lib/core/infra/logger';
import type {

  GalleryScrapeResult,
  GalleryImageItem,
  GalleryVideoItem,
} from '@/types';
import { MAX_GALLERY_PAGES, randomDelay, sleep } from '@/lib/core/stealth/anti-crawler';
import { logT } from '@/lib/i18n/server';
import { getCharacterDBServiceAsync } from '@/lib/character-db';
import {
  SITE_DOMAINS,
  domainHealthTracker,
  extractArticleId,
  extractDomainFromUrl,
  type GalleryPageMetadata,
} from './constants';
import { extractGalleryPageData, extractZipDownloadInfo } from './page-evaluators';
import type { ScrapeDeps } from '../aimeizizi-provider';

const logger = loggers.scrapeGallery();
export async function scrapeGallery(
  page: Page,
  pageUrl: string,
  deps: ScrapeDeps,
): Promise<GalleryScrapeResult> {
  const sT0 = Date.now();
  const sLog = (msg: string): void => console.log(`[ScrapeGalleryTiming] ${Date.now() - sT0}ms ${msg}`);
  sLog('start');

  const firstPageData = await extractGalleryPageData(page, 0);
  sLog(`page1: ${firstPageData.images.length} images, ${firstPageData.videos.length} videos, ${firstPageData.totalPages} pages`);

  const totalPages = Math.min(firstPageData.totalPages, MAX_GALLERY_PAGES);

  const allImages: GalleryImageItem[] = [];
  const allVideos: GalleryVideoItem[] = [];
  const videoUrlSet = new Set<string>();
  const imageUrlSet = new Set<string>();

  let orderIndex = 0;
  let currentDomain = extractDomainFromUrl(pageUrl);
  for (const img of firstPageData.images) {
    const fullUrl = deps.resolveUrl(img.url, currentDomain);
    if (fullUrl && !imageUrlSet.has(fullUrl)) {
      imageUrlSet.add(fullUrl);
      allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
    }
  }
  for (const videoUrl of firstPageData.videos) {
    const fullUrl = deps.resolveUrl(videoUrl, currentDomain);
    if (fullUrl && !videoUrlSet.has(fullUrl)) {
      videoUrlSet.add(fullUrl);
      allVideos.push({ url: fullUrl });
    }
  }
  sLog(`page1 done: images=${allImages.length}, videos=${allVideos.length}`);

  const zipInfo = await extractZipDownloadInfo(page);
  sLog(`ZIP: ${zipInfo ? 'yes' : 'no'}`);

  const articleId = extractArticleId(pageUrl);

  const GALLERY_PAGE_DELAY_MIN = 300;
  const GALLERY_PAGE_DELAY_MAX = 600;

  for (let pageNum = 2; pageNum <= totalPages; pageNum++) {
    sLog(`page ${pageNum}/${totalPages}`);
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
        logger.warnT('log.aimeizizi.domainRateLimited', { page: pageNum, status: httpStatus, domain: currentDomain });

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
              logger.infoT('log.aimeizizi.domainSwitchSuccess', { page: pageNum, domain: fbDomain });
              break;
            } catch (fbErr) {
              logger.warnT('log.aimeizizi.domainSwitchFailed', { page: pageNum, domain: fbDomain, msg: fbErr instanceof Error ? fbErr.message : String(fbErr) });
              continue;
            }
          }
        }
      } else {
        await page.waitForSelector('article', { timeout: 3000 }).catch(() => {});
        pageData = await extractGalleryPageData(page, pageNum - 1);
      }
    } catch (err) {
      logger.errorT('log.aimeizizi.scrapePageFailed', { page: pageNum, domain: currentDomain }, err);

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
            logger.infoT('log.aimeizizi.domainSwitchSuccess', { page: pageNum, domain: fbDomain });
            break;
          } catch {
            continue;
          }
        }
      }
    }

    if (pageData) {
      for (const img of pageData.images) {
        const fullUrl = deps.resolveUrl(img.url, currentDomain);
        if (fullUrl && !imageUrlSet.has(fullUrl)) {
          imageUrlSet.add(fullUrl);
          allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
        }
      }
      for (const videoUrl of pageData.videos) {
        const fullUrl = deps.resolveUrl(videoUrl, currentDomain);
        if (fullUrl && !videoUrlSet.has(fullUrl)) {
          videoUrlSet.add(fullUrl);
          allVideos.push({ url: fullUrl });
        }
      }
    }
  }

  const title = deps.cleanTitle(firstPageData.h1Title || firstPageData.rawTitle);
  sLog(`title: "${title.substring(0, 40)}"`);
  const protagonist = await deps.extractProtagonist(title, firstPageData.tags);
  sLog(`protagonist: "${protagonist}"`);
  const description = deps.extractDescription(title, protagonist);

  const blockCheck = await deps.checkContentBlockedAsync(title, firstPageData.category, protagonist);
  if (blockCheck.blocked) {
    logger.infoT('log.aimeizizi.blockedGalleryScrape', { title: title.substring(0, 50), reason: blockCheck.reason ?? '' });
    throw new Error(`Content blocked: ${blockCheck.reason || 'unknown reason'}`);
  }

  const metaKeywordsStr = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="keywords"]');
    return meta?.getAttribute('content') || '';
  });
  const metaKeywords = metaKeywordsStr
    .split(/[,]/)
    .map((t: string) => t.trim())
    .filter((t: string) => t && t.length < 50);

  const allTags = [...new Set([...firstPageData.tags, ...metaKeywords])];

  const db = await getCharacterDBServiceAsync();
  const gameCharMatches = db
    .identifyInTags(allTags)
    .filter(m => m.character.category === 'game');
  const gameCharacters = gameCharMatches.map((m) => m.character.name);
  if (gameCharacters.length > 0) {
    logger.infoT('log.aimeizizi.gameCharDetected', { chars: gameCharacters.join(', ') });
  }
  sLog(`tags=${allTags.length}, gameChars=${gameCharacters.length}`);

  let scrapedDomain = '';
  try {
    const parsed = new URL(pageUrl);
    scrapedDomain = `${parsed.protocol}`
  } catch {}

  sLog(`scrapeGallery done: images=${allImages.length}, videos=${allVideos.length}`);

  return {
    sourceUrl: pageUrl,
    title,
    protagonist,
    description,
    category: firstPageData.category,
    tags: allTags,
    coverUrl: deps.resolveUrl(firstPageData.coverUrl, currentDomain),
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
