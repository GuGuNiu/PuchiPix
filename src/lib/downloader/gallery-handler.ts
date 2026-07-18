﻿import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { getSiteRegistry, extractDomainFromUrl } from '@/lib/sites';
import { getSiteModuleByUrl } from '@/lib/sites/site-modules';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { getGalleryDownloader } from '@/lib/downloader/gallery';
import { createStealthPage } from '@/lib/core/stealth/anti-crawler';
import { shouldFallbackToPlaywright } from '@/lib/core/stealth/waf-detector';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { logT } from '@/lib/i18n/server';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import { checkGalleryDuplicate } from '@/lib/utils/task-dedup';
import { normalizeUrl, cleanUrl } from '@/lib/utils/url-normalizer';

export function getGalleryProvider(url: string): (SiteProvider & GallerySiteProvider) | null {
  const trimmedUrl = url.trim();
  if (trimmedUrl.endsWith('.m3u8')) return null;

  const registry = getSiteRegistry();
  const provider = registry.getProviderByUrl(trimmedUrl);
  if (provider) {
    const galleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
    if (typeof galleryProvider.scrapeGallery === 'function') {
      return galleryProvider as SiteProvider & GallerySiteProvider;
    }
  }

  const moduleInfo = getSiteModuleByUrl(trimmedUrl);
  if (moduleInfo && moduleInfo.type === 'photo') {
    const fallbackProvider = registry.getProvider(moduleInfo.id);
    if (fallbackProvider) {
      const galleryProvider = fallbackProvider as SiteProvider & Partial<GallerySiteProvider>;
      if (typeof galleryProvider.scrapeGallery === 'function') {
        console.warn(
          `[GalleryHandler] 鍥惧簱 Provider 閫氳繃 site-modules 鍏滃簳鍖归厤: ${trimmedUrl} 鈫?${moduleInfo.id}` +
          `(registry.matchesUrl 鏈尮閰嶏紝鍙兘瀛樺湪杈圭晫鎯呭喌)`,
        );
        return galleryProvider as SiteProvider & GallerySiteProvider;
      }
    }
  }

  return null;
}

export async function scrapeGalleryAsync(
  galleryId: number,
  url: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<void> {

  const pendingGallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
  if (!pendingGallery || pendingGallery.status === 'completed' || pendingGallery.status === 'not_found') {
    return;
  }

  // 娉ㄦ剰锛氳皟鐢ㄨ€咃紙createGalleryTask 鎴?startupRecovery锛夊簲璇ュ凡缁忚幏鍙栦簡璇嗗埆妲戒綅
  // 杩欓噷妫€鏌ユ槸鍚﹀凡鍗犵敤妲戒綅锛岄伩鍏嶅弻閲嶆Ы浣嶅崰鐢ㄩ棶棰?
  const hasScrapingSlot = taskQueueManager.hasActiveScrapingSlot('gallery', galleryId);

  // 浠呭湪娌℃湁妲戒綅鏃跺皾璇曡幏鍙栵紙闃插尽鎬х紪绋嬶紝澶勭悊鎵嬪姩璋冪敤鐨勬儏鍐碉級
  if (!hasScrapingSlot) {
    const scrapingAcquired = await taskQueueManager.acquireScrapingSlot('gallery', galleryId);
    if (!scrapingAcquired) {
      console.log(logT('log.galleryHandler.cancelledInScrapeQueue', { id: galleryId }));
      return;
    }
  }

  const T0 = Date.now();
  const log = (msg: string): void => console.log(`[ScrapeTiming#${galleryId}] ${Date.now() - T0}ms 鈥?${msg}`);
  log(`寮€濮嬪紓姝ョ埇鍙? ${url}`);

  if (provider.supportsHttpScrape && provider.scrapeGalleryHttp) {
    try {
      log('灏濊瘯 HTTP 蹇€熻矾寰?);
      const httpResult = await provider.scrapeGalleryHttp(url);

      const qualityCheck = shouldFallbackToPlaywright({
        title: httpResult.title,
        imageCount: httpResult.imageCount,
        videoCount: httpResult.videoCount,
        pageCount: httpResult.pageCount,
      });

      if (qualityCheck.fallback) {
        log(`HTTP 璺緞鍐呭璐ㄩ噺涓嶈冻: ${qualityCheck.reason}锛岄檷绾у埌 Playwright`);
      } else {
        log(`HTTP 鐖彇鎴愬姛: 鏍囬="${httpResult.title.substring(0, 30)}" 鍥剧墖=${httpResult.imageCount} 瑙嗛=${httpResult.videoCount}`);

        const httpHasImages = httpResult.images.length > 0;
        const httpHasVideos = httpResult.videos.length > 0;
        const httpHasZipInfo = httpResult.zipInfo && httpResult.zipInfo.downloadUrl;

        if (!httpHasImages && !httpHasVideos && !httpHasZipInfo) {
          log(`鍥惧簱 #${galleryId} 鐖彇瀹屾垚锛屼絾鏈壘鍒颁换浣曞彲涓嬭浇鍐呭`);
          await prisma.gallery.update({
            where: { id: galleryId },
            data: {
              title: httpResult.title || '鏈懡鍚嶅浘搴?,
              status: 'failed',
              errorMsg: '椤甸潰鐖彇鎴愬姛锛屼絾鏈壘鍒颁换浣曞浘鐗囥€佽棰戞垨涓嬭浇閾炬帴',
            },
          });
          eventBus.emit('gallery:scrapeFailed', {
            galleryId,
            url,
            error: '椤甸潰鐖彇鎴愬姛锛屼絾鏈壘鍒颁换浣曞彲涓嬭浇鍐呭',
          });
          taskQueueManager.releaseScrapingSlot('gallery', galleryId);
          return;
        }

        await prisma.gallery.update({
          where: { id: galleryId },
          data: {
            title: httpResult.title,
            protagonist: httpResult.protagonist,
            description: httpResult.description,
            category: httpResult.category,
            tags: JSON.stringify(httpResult.tags),
            coverUrl: httpResult.coverUrl,
            publishTime: httpResult.publishTime || null,
            imageCount: httpResult.imageCount,
            videoCount: httpResult.videoCount,
            pageCount: httpResult.pageCount,
            scrapedDomain: httpResult.scrapedDomain || '',
            status: 'pending',
          },
        });

        if (httpResult.zipInfo) {
          await prisma.galleryDownloadInfo.upsert({
            where: { galleryId },
            create: {
              galleryId,
              title: httpResult.zipInfo.title,
              fileCount: httpResult.zipInfo.fileCount,
              fileSizeText: httpResult.zipInfo.fileSizeText,
              imageDimensions: httpResult.zipInfo.imageDimensions,
              password: httpResult.zipInfo.password,
              downloadUrl: httpResult.zipInfo.downloadUrl,
              provider: httpResult.zipInfo.provider,
              requiresLogin: httpResult.zipInfo.requiresLogin,
              requiresEmail: httpResult.zipInfo.requiresEmail,
              status: httpResult.zipInfo.downloadUrl ? 'available' : 'unavailable',
            },
            update: {
              title: httpResult.zipInfo.title,
              fileCount: httpResult.zipInfo.fileCount,
              fileSizeText: httpResult.zipInfo.fileSizeText,
              imageDimensions: httpResult.zipInfo.imageDimensions,
              password: httpResult.zipInfo.password,
              downloadUrl: httpResult.zipInfo.downloadUrl,
              provider: httpResult.zipInfo.provider,
              requiresLogin: httpResult.zipInfo.requiresLogin,
              requiresEmail: httpResult.zipInfo.requiresEmail,
              status: httpResult.zipInfo.downloadUrl ? 'available' : 'unavailable',
            },
          });
        }

        if (httpResult.images.length > 0) {
          await prisma.galleryImage.createMany({
            data: httpResult.images.map((img) => ({
              galleryId,
              url: img.url,
              pageIndex: img.pageIndex,
              orderIndex: img.orderIndex,
              status: 'pending',
            })),
          });
        }

        if (httpResult.videos.length > 0) {
          await prisma.galleryVideo.createMany({
            data: httpResult.videos.map((vid) => ({
              galleryId,
              url: vid.url,
              status: 'pending',
            })),
          });
        }

        eventBus.emit('gallery:scrapeCompleted', {
          galleryId,
          title: httpResult.title,
          imageCount: httpResult.imageCount,
          videoCount: httpResult.videoCount,
        });

        taskQueueManager.releaseScrapingSlot('gallery', galleryId);

        // 璇嗗埆瀹屾垚锛屽皾璇曡幏鍙栦笅杞芥Ы浣?
        const slotUsage = taskQueueManager.getSlotUsage('gallery');
        log(`涓嬭浇妲戒綅妫€鏌? 褰撳墠${slotUsage.current}/${slotUsage.max}, 鍙敤=${slotUsage.available}`);

        if (!slotUsage.available) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: 'download_pending' },
          });
          eventBus.emit('gallery:downloadPending', { galleryId, url });
          log('涓嬭浇妲戒綅宸叉弧锛岃繘鍏ョ瓑寰呬笅杞界姸鎬?);
          return;
        }

        const downloadAcquired = await taskQueueManager.acquireSlot('gallery', galleryId);
        if (!downloadAcquired) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: 'download_pending' },
          });
          eventBus.emit('gallery:downloadPending', { galleryId, url });
          log('涓嬭浇妲戒綅绔炰簤澶辫触锛岃繘鍏ョ瓑寰呬笅杞界姸鎬?);
          return;
        }

        log('鑾峰彇鍒颁笅杞芥Ы浣嶏紝瑙﹀彂涓嬭浇');
        getGalleryDownloader()
          .downloadGallery(galleryId)
          .then((dlResult) => {
            log(logT('log.galleryHandler.downloadComplete', { success: dlResult.success, failed: dlResult.failed, skipped: dlResult.skipped }));
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            log(logT('log.galleryHandler.downloadFailed', { msg }));
            eventBus.emit('gallery:downloadFailed', { galleryId, error: msg });
          });

        return;
      }
    } catch (err) {
      log(`HTTP 璺緞寮傚父: ${err instanceof Error ? err.message : err}锛岄檷绾у埌 Playwright`);
    }
  }

  const browser = await getSharedBrowser();
  log('鑾峰彇鍏变韩娴忚鍣ㄥ疄渚嬪畬鎴?);
  const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);
  log('鍒涘缓 Stealth 椤甸潰瀹屾垚');

  if (provider.setupBrowserContext) {
    await provider.setupBrowserContext(context);
    log('setupBrowserContext 瀹屾垚');
  }

  try {
    const adaptiveProvider = provider as SiteProvider & Partial<{
      getAdaptiveUrls: (url: string) => string[];
      markDomainRateLimited: (domain: string) => void;
      markDomainHealthy: (domain: string) => void;
    }>;
    const urlsToTry = adaptiveProvider.getAdaptiveUrls ? adaptiveProvider.getAdaptiveUrls(url) : [url];
    let result: Awaited<ReturnType<GallerySiteProvider['scrapeGallery']>> | null = null;
    let lastError: unknown = null;
    let isNotFound = false;

    for (const tryUrl of urlsToTry) {
      try {
        log(`寮€濮嬪鑸? ${tryUrl}`);
        const response = await page.goto(tryUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        log(`椤甸潰瀵艰埅瀹屾垚 (HTTP ${response?.status()})`);

        const httpStatus = response?.status();
        if (httpStatus === 404) {
          isNotFound = true;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        if (httpStatus === 403 || httpStatus === 429) {
          const domain = extractDomainFromUrl(tryUrl);
          console.warn(logT('log.galleryHandler.domainRateLimited', { url: tryUrl, status: httpStatus }));
          if (domain && adaptiveProvider.markDomainRateLimited) {
            adaptiveProvider.markDomainRateLimited(domain);
          }
          lastError = new Error(`RATE_LIMITED: ${tryUrl}`);
          continue;
        }

        const resp = await page.waitForSelector('article, #gdt, #gn, .itg, #postlist, #threadlisttableid', { timeout: 10000 }).catch(() => null);
        log(`绛夊緟鍐呭閫夋嫨鍣ㄥ畬鎴?(${resp ? '鍛戒腑' : '瓒呮椂'})`);
        if (!resp) {
          lastError = new Error(`椤甸潰鏃犲唴瀹? ${tryUrl}`);
          continue;
        }

        log('寮€濮?scrapeGallery');
        result = await provider.scrapeGallery(page, tryUrl);
        log(`scrapeGallery 瀹屾垚: 鏍囬="${result.title.substring(0, 30)}" 鍥剧墖=${result.imageCount} 瑙嗛=${result.videoCount} 椤垫暟=${result.pageCount}`);

        if (result.title === '404' || result.title.includes('椤甸潰涓嶅瓨鍦?) || result.title.includes('Not Found')) {
          isNotFound = true;
          result = null;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        const successDomain = extractDomainFromUrl(tryUrl);
        if (successDomain && adaptiveProvider.markDomainHealthy) {
          adaptiveProvider.markDomainHealthy(successDomain);
        }

        break;
      } catch (err) {
        lastError = err;
        if (err instanceof Error && err.message.includes('鍐呭琚睆钄?)) {
          throw err;
        }
        if (err instanceof Error && err.message.includes('PAGE_NOT_FOUND')) {
          isNotFound = true;
        }
      }
    }

    if (!result) {
      if (isNotFound) {
        taskQueueManager.releaseScrapingSlot('gallery', galleryId);
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { status: 'not_found', errorMsg: '椤甸潰涓嶅瓨鍦?(404)' },
        });
        eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: '椤甸潰涓嶅瓨鍦?(404)' });
        return;
      }
      throw lastError || new Error('鎵€鏈夊煙鍚嶅潎鐖彇澶辫触');
    }

    const hasImages = result.images.length > 0;
    const hasVideos = result.videos.length > 0;
    const hasZipInfo = result.zipInfo && result.zipInfo.downloadUrl;
    
    if (!hasImages && !hasVideos && !hasZipInfo) {
      log(`鍥惧簱 #${galleryId} 鐖彇瀹屾垚锛屼絾鏈壘鍒颁换浣曞彲涓嬭浇鍐呭`);
      await prisma.gallery.update({
        where: { id: galleryId },
        data: {
          title: result.title || '鏈懡鍚嶅浘搴?,
          status: 'failed',
          errorMsg: '椤甸潰鐖彇鎴愬姛锛屼絾鏈壘鍒颁换浣曞浘鐗囥€佽棰戞垨涓嬭浇閾炬帴',
        },
      });
      eventBus.emit('gallery:scrapeFailed', {
        galleryId,
        url,
        error: '椤甸潰鐖彇鎴愬姛锛屼絾鏈壘鍒颁换浣曞彲涓嬭浇鍐呭',
      });
      taskQueueManager.releaseScrapingSlot('gallery', galleryId);
      return;
    }

    log('寮€濮嬫暟鎹簱鍐欏叆');
    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        title: result.title,
        protagonist: result.protagonist,
        description: result.description,
        category: result.category,
        tags: JSON.stringify(result.tags),
        coverUrl: result.coverUrl,
        publishTime: result.publishTime || null,
        imageCount: result.imageCount,
        videoCount: result.videoCount,
        pageCount: result.pageCount,
        scrapedDomain: result.scrapedDomain || '',
        status: 'pending',
      },
    });

    if (result.zipInfo) {
      await prisma.galleryDownloadInfo.upsert({
        where: { galleryId },
        create: {
          galleryId,
          title: result.zipInfo.title,
          fileCount: result.zipInfo.fileCount,
          fileSizeText: result.zipInfo.fileSizeText,
          imageDimensions: result.zipInfo.imageDimensions,
          password: result.zipInfo.password,
          downloadUrl: result.zipInfo.downloadUrl,
          provider: result.zipInfo.provider,
          requiresLogin: result.zipInfo.requiresLogin,
          requiresEmail: result.zipInfo.requiresEmail,
          status: result.zipInfo.downloadUrl ? 'available' : 'unavailable',
        },
        update: {
          title: result.zipInfo.title,
          fileCount: result.zipInfo.fileCount,
          fileSizeText: result.zipInfo.fileSizeText,
          imageDimensions: result.zipInfo.imageDimensions,
          password: result.zipInfo.password,
          downloadUrl: result.zipInfo.downloadUrl,
          provider: result.zipInfo.provider,
          requiresLogin: result.zipInfo.requiresLogin,
          requiresEmail: result.zipInfo.requiresEmail,
          status: result.zipInfo.downloadUrl ? 'available' : 'unavailable',
        },
      });
    }

    if (result.images.length > 0) {
      await prisma.galleryImage.createMany({
        data: result.images.map((img) => ({
          galleryId,
          url: img.url,
          pageIndex: img.pageIndex,
          orderIndex: img.orderIndex,
          status: 'pending',
        })),
      });
    }

    if (result.videos.length > 0) {
      await prisma.galleryVideo.createMany({
        data: result.videos.map((vid) => ({
          galleryId,
          url: vid.url,
          status: 'pending',
        })),
      });
    }
    log('鏁版嵁搴撳啓鍏ュ畬鎴?);

    eventBus.emit('gallery:scrapeCompleted', {
      galleryId,
      title: result.title,
      imageCount: result.imageCount,
      videoCount: result.videoCount,
    });

    taskQueueManager.releaseScrapingSlot('gallery', galleryId);

    const slotUsage = taskQueueManager.getSlotUsage('gallery');
    log(`涓嬭浇妲戒綅妫€鏌? 褰撳墠${slotUsage.current}/${slotUsage.max}, 鍙敤=${slotUsage.available}`);
    
    if (!slotUsage.available) {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'download_pending' },
      });
      eventBus.emit('gallery:downloadPending', { galleryId, url });
      log('涓嬭浇妲戒綅宸叉弧锛岃繘鍏ョ瓑寰呬笅杞界姸鎬?);
      return;
    }

    const downloadAcquired = await taskQueueManager.acquireSlot('gallery', galleryId);
    if (!downloadAcquired) {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'download_pending' },
      });
      eventBus.emit('gallery:downloadPending', { galleryId, url });
      log('涓嬭浇妲戒綅绔炰簤澶辫触锛岃繘鍏ョ瓑寰呬笅杞界姸鎬?);
      return;
    }

    log('鑾峰彇鍒颁笅杞芥Ы浣嶏紝绔嬪嵆瑙﹀彂涓嬭浇');
    getGalleryDownloader()
      .downloadGallery(galleryId)
      .then((dlResult) => {
        log(logT('log.galleryHandler.downloadComplete', { success: dlResult.success, failed: dlResult.failed, skipped: dlResult.skipped }));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log(logT('log.galleryHandler.downloadFailed', { msg }));
        eventBus.emit('gallery:downloadFailed', { galleryId, error: msg });
      });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const notFound = errMsg.includes('PAGE_NOT_FOUND') || errMsg.includes('404');
    log(`鐖彇寮傚父: ${errMsg}`);

    taskQueueManager.releaseScrapingSlot('gallery', galleryId);
    const isBrowserClosed =
      errMsg.includes('Target closed') ||
      errMsg.includes('Target page') ||
      errMsg.includes('Browser') && errMsg.includes('closed') ||
      errMsg.includes('Page closed') ||
      errMsg.includes('context') && errMsg.includes('destroyed');

    if (isBrowserClosed) {
      log('妫€娴嬪埌娴忚鍣ㄥ叧闂敊璇紝淇濇寔 pending 鐘舵€佺瓑寰呴噸鍚悗閲嶈瘯');
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'pending', errorMsg: '鏈嶅姟鍏抽棴涓柇锛岀瓑寰呴噸鏂板惎鍔? },
      });
    } else {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: notFound ? 'not_found' : 'failed', errorMsg: errMsg },
      });
    }

    eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: errMsg });
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    log(`娴佺▼缁撴潫锛堥〉闈?涓婁笅鏂囧凡鍏抽棴锛塦);
  }
}

export async function createGalleryTask(
  rawUrl: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<{
  galleryId: number;
  seq: string;
  duplicate: boolean;
  existingStatus?: string;
  existingTitle?: string;
}> {
  const url = cleanUrl(rawUrl);
  const normalizedUrl = normalizeUrl(url);

  const dedupResult = await checkGalleryDuplicate(url);
  if (dedupResult.duplicate) {
    return {
      galleryId: dedupResult.recordId ?? 0,
      seq: '',
      duplicate: true,
      existingStatus: dedupResult.status ?? undefined,
      existingTitle: dedupResult.title ?? undefined,
    };
  }

  const seq = await allocateSeq();

  // 鍏堝垱寤哄浘搴撹褰曪紙鐘舵€佷负 pending锛夛紝鑾峰彇鐪熷疄 galleryId
  const gallery = await prisma.gallery.upsert({
    where: { sourceUrl: normalizedUrl },
    create: {
      sourceUrl: normalizedUrl,
      siteId: provider.id,
      status: 'pending',
      seq,
    },
    update: {},
  });

  // 浣跨敤鐪熷疄 galleryId 灏濊瘯鑾峰彇璇嗗埆妲戒綅
  const scrapingAcquired = await taskQueueManager.acquireScrapingSlot('gallery', gallery.id);
  if (!scrapingAcquired) {
    // 妲戒綅宸叉弧锛岃繘鍏ョ瓑寰呰瘑鍒槦鍒?
    await prisma.gallery.update({
      where: { id: gallery.id },
      data: { status: 'scrape_pending' },
    });
    eventBus.emit('gallery:scrapePending', { galleryId: gallery.id, url });

    return {
      galleryId: gallery.id,
      seq: gallery.seq ?? seq,
      duplicate: false,
    };
  }

  // 鑾峰彇妲戒綅鎴愬姛锛屽紑濮嬭瘑鍒?
  await prisma.gallery.update({
    where: { id: gallery.id },
    data: { status: 'scraping' },
  });

  eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

  scrapeGalleryAsync(gallery.id, url, provider).catch((err) => {
    console.error(logT('log.galleryHandler.asyncScrapeError', { id: gallery.id }), err);
  });

  return {
    galleryId: gallery.id,
    seq: gallery.seq ?? seq,
    duplicate: false,
  };
}
