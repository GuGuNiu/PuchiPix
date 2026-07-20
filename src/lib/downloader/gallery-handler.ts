import prisma from '@/lib/db/prisma';
import { loggers } from '@/lib/core/infra/logger';
import { eventBus } from '@/lib/core/infra/event-bus';
import { getSiteRegistry, extractDomainFromUrl } from '@/lib/sites';
import { getSiteModuleByUrl } from '@/lib/sites/site-modules';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { getSharedBrowser, browserContextPool } from '@/lib/core/stealth/browser-pool';
import { getGalleryDownloader } from '@/lib/downloader/gallery';
import { shouldFallbackToPlaywright } from '@/lib/core/stealth/waf-detector';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { logT } from '@/lib/i18n/server';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';
import { dagConfig } from '@/lib/core/orchestrator/dag/config';
import { dagOrchestrator } from '@/lib/core/orchestrator/dag/orchestrator';
import { createGalleryDag } from '@/lib/core/orchestrator/dag/init';
import { checkGalleryDuplicate } from '@/lib/utils/task-dedup';
import { normalizeUrl, cleanUrl } from '@/lib/utils/url-normalizer';
import { sleep } from '@/lib/utils/delay';


const logger = loggers.galleryHandler();
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
          `[GalleryHandler] Provider did not match URL, falling back to site-modules mapping: ${trimmedUrl} → ${moduleInfo.id}` +
          `(registry.matchesUrl failed)`,
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

  const hasScrapingSlot = taskQueueManager.hasActiveScrapingSlot('gallery', galleryId);

  if (!hasScrapingSlot) {
    const scrapingAcquired = await taskQueueManager.acquireScrapingSlot('gallery', galleryId);
    if (!scrapingAcquired) {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'scrape_pending' },
      });
      eventBus.emit('gallery:scrapePending', { galleryId, url });
      logger.infoT('log.galleryHandler.cancelledInScrapeQueue', { id: galleryId });
      return;
    }
  }

  const T0 = Date.now();
  const log = (msg: string): void => console.log(`[ScrapeTiming#${galleryId}] ${Date.now() - T0}ms | ${msg}`);
  const SCRAPE_TO_DOWNLOAD_DELAY_MS = 3000;
  log(`Scrape started: ${url}`);

  if (provider.supportsHttpScrape && provider.scrapeGalleryHttp) {
    try {
      log('Trying HTTP scrape');
      const httpResult = await provider.scrapeGalleryHttp(url);

      const qualityCheck = shouldFallbackToPlaywright({
        title: httpResult.title,
        imageCount: httpResult.imageCount,
        videoCount: httpResult.videoCount,
        pageCount: httpResult.pageCount,
      });

      if (qualityCheck.fallback) {
        log(`HTTP scrape quality poor: ${qualityCheck.reason}, falling back to Playwright`);
      } else {
        log(`HTTP scrape success: title="${httpResult.title.substring(0, 30)}" images=${httpResult.imageCount} videos=${httpResult.videoCount}`);

        const httpHasImages = httpResult.images.length > 0;
        const httpHasVideos = httpResult.videos.length > 0;
        const httpHasZipInfo = httpResult.zipInfo && httpResult.zipInfo.downloadUrl;

        if (!httpHasImages && !httpHasVideos && !httpHasZipInfo) {
          log(`Gallery #${galleryId} no valid content`);
          await prisma.gallery.update({
            where: { id: galleryId },
            data: {
              title: httpResult.title || 'Unknown',
              status: 'failed',
              errorMsg: 'Empty scrape result',
            },
          });
          eventBus.emit('gallery:scrapeFailed', {
            galleryId,
            url,
            error: 'Empty scrape result',
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

        log(`Waiting ${SCRAPE_TO_DOWNLOAD_DELAY_MS}ms before download...`);
        await sleep(SCRAPE_TO_DOWNLOAD_DELAY_MS);

        // DelayafterheavynewChecktask status，Preventcancelled/completed resumedownload
        const refreshedGallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
        if (!refreshedGallery || refreshedGallery.status === 'completed' || refreshedGallery.status === 'cancelled') {
          log('Task status changed, skipping download');
          return;
        }

        const slotUsage = taskQueueManager.getSlotUsage('gallery');
        log(`Download slots: ${slotUsage.current}/${slotUsage.max}, available=${slotUsage.available}`);

        if (!slotUsage.available) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: 'download_pending' },
          });
          eventBus.emit('gallery:downloadPending', { galleryId, url });
          log('Waiting for download slot');
          return;
        }

        const downloadAcquired = await taskQueueManager.acquireSlot('gallery', galleryId);
        if (!downloadAcquired) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: 'download_pending' },
          });
          eventBus.emit('gallery:downloadPending', { galleryId, url });
          log('Download slot acquisition failed');
          return;
        }

        log('Starting download');
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
      log(`HTTP scrape failed: ${err instanceof Error ? err.message : err}, falling back to Playwright`);
    }
  }

  const browser = await getSharedBrowser();
  log('Acquiring browser');
  const { page, context } = await browserContextPool.acquire(browser, undefined, provider.baseUrl);
  log('Acquiring stealth context (pooled)');

  if (provider.setupBrowserContext) {
    await provider.setupBrowserContext(context);
    log('setupBrowserContext completed');
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
        log(`Navigating to ${tryUrl}`);
        const response = await page.goto(tryUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        log(`Response status (HTTP ${response?.status()})`);

        const httpStatus = response?.status();
        if (httpStatus === 404) {
          isNotFound = true;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        if (httpStatus === 403 || httpStatus === 429) {
          const domain = extractDomainFromUrl(tryUrl);
          logger.warnT('log.galleryHandler.domainRateLimited', { url: tryUrl, status: httpStatus });
          if (domain && adaptiveProvider.markDomainRateLimited) {
            adaptiveProvider.markDomainRateLimited(domain);
          }
          lastError = new Error(`RATE_LIMITED: ${tryUrl}`);
          continue;
        }

        const resp = await page.waitForSelector('article, #gdt, #gn, .itg, #postlist, #threadlisttableid', { timeout: 10000 }).catch(() => null);
        log(`Page content detected (${resp ? 'success' : 'failed'})`);
        if (!resp) {
          lastError = new Error(`Page content not found: ${tryUrl}`);
          continue;
        }

        log('Calling scrapeGallery');
        result = await provider.scrapeGallery(page, tryUrl);
        log(`scrapeGallery completed: title="${result.title.substring(0, 30)}" images=${result.imageCount} videos=${result.videoCount} pages=${result.pageCount}`);

        if (result.title === '404' || result.title.includes('未找到') || result.title.includes('Not Found')) {
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
        if (err instanceof Error && err.message.includes('Target closed')) {
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
          data: { status: 'not_found', errorMsg: 'Page not found (404)' },
        });
        eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: 'Page not found (404)' });
        return;
      }
      throw lastError || new Error('Scrape failed');
    }

    const hasImages = result.images.length > 0;
    const hasVideos = result.videos.length > 0;
    const hasZipInfo = result.zipInfo && result.zipInfo.downloadUrl;

    if (!hasImages && !hasVideos && !hasZipInfo) {
      log(`Gallery #${galleryId} no valid content`);
      await prisma.gallery.update({
        where: { id: galleryId },
        data: {
          title: result.title || 'Unknown',
          status: 'failed',
          errorMsg: 'Empty scrape result',
        },
      });
      eventBus.emit('gallery:scrapeFailed', {
        galleryId,
        url,
        error: 'Empty scrape result',
      });
      taskQueueManager.releaseScrapingSlot('gallery', galleryId);
      return;
    }

    log('Scrape succeeded, saving data');
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
    log('Data saved');

    eventBus.emit('gallery:scrapeCompleted', {
      galleryId,
      title: result.title,
      imageCount: result.imageCount,
      videoCount: result.videoCount,
    });

    taskQueueManager.releaseScrapingSlot('gallery', galleryId);

    log(`Waiting ${SCRAPE_TO_DOWNLOAD_DELAY_MS}ms before download...`);
    await sleep(SCRAPE_TO_DOWNLOAD_DELAY_MS);

    const refreshedGallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
    if (!refreshedGallery || refreshedGallery.status === 'completed' || refreshedGallery.status === 'cancelled') {
      log('Task status changed, skipping download');
      return;
    }

    const slotUsage = taskQueueManager.getSlotUsage('gallery');
    log(`Download slots: ${slotUsage.current}/${slotUsage.max}, available=${slotUsage.available}`);

    if (!slotUsage.available) {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'download_pending' },
      });
      eventBus.emit('gallery:downloadPending', { galleryId, url });
      log('Waiting for download slot');
      return;
    }

    const downloadAcquired = await taskQueueManager.acquireSlot('gallery', galleryId);
    if (!downloadAcquired) {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'download_pending' },
      });
      eventBus.emit('gallery:downloadPending', { galleryId, url });
      log('Download slot acquisition failed');
      return;
    }

    log('Starting download');
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
    log(`Scrape failed: ${errMsg}`);

    taskQueueManager.releaseScrapingSlot('gallery', galleryId);
    const isBrowserClosed =
      errMsg.includes('Target closed') ||
      errMsg.includes('Target page') ||
      errMsg.includes('Browser') && errMsg.includes('closed') ||
      errMsg.includes('Page closed') ||
      errMsg.includes('context') && errMsg.includes('destroyed');

    if (isBrowserClosed) {
      log('Browser closed, resetting to pending');
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: 'pending', errorMsg: '' },
      });
    } else {
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { status: notFound ? 'not_found' : 'failed', errorMsg: errMsg },
      });
    }

    eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: errMsg });
  } finally {
    await browserContextPool.release(context, page);
    log('Scrape flow ended');
  }
}


export async function createGalleryRecord(
  rawUrl: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<{
  galleryId: number;
  seq: string;
  duplicate: boolean;
  matchType?: string | null;
  existingUrl?: string | null;
  existingStatus?: string;
  existingTitle?: string;
  message?: string | null;
}> {
  const url = cleanUrl(rawUrl);
  const normalizedUrl = normalizeUrl(url);

  const dedupResult = await checkGalleryDuplicate(url);
  if (dedupResult.duplicate) {
    return {
      galleryId: dedupResult.recordId ?? 0,
      seq: '',
      duplicate: true,
      matchType: dedupResult.matchType,
      existingUrl: dedupResult.existingUrl,
      existingStatus: dedupResult.status ?? undefined,
      existingTitle: dedupResult.title ?? undefined,
      message: dedupResult.message,
    };
  }

  const seq = await allocateSeq();

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

  return {
    galleryId: gallery.id,
    seq: gallery.seq ?? seq,
    duplicate: false,
  };
}

export async function createGalleryTask(
  rawUrl: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<{
  galleryId: number;
  seq: string;
  duplicate: boolean;
  matchType?: string | null;
  existingUrl?: string | null;
  existingStatus?: string;
  existingTitle?: string;
  message?: string | null;
}> {
  const url = cleanUrl(rawUrl);
  const normalizedUrl = normalizeUrl(url);

  const dedupResult = await checkGalleryDuplicate(url);
  if (dedupResult.duplicate) {
    return {
      galleryId: dedupResult.recordId ?? 0,
      seq: '',
      duplicate: true,
      matchType: dedupResult.matchType,
      existingUrl: dedupResult.existingUrl,
      existingStatus: dedupResult.status ?? undefined,
      existingTitle: dedupResult.title ?? undefined,
      message: dedupResult.message,
    };
  }

  const seq = await allocateSeq();

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

  if (dagConfig.enabled && dagConfig.isTaskTypeEnabledSync('gallery')) {
    const dagDefinition = createGalleryDag({
      galleryId: gallery.id,
      url,
      providerId: provider.id,
      isBatch: false,
    });

    dagDefinition.nodes[0].config.galleryId = gallery.id;

    await dagOrchestrator.submitDag(dagDefinition);

    return {
      galleryId: gallery.id,
      seq: gallery.seq ?? seq,
      duplicate: false,
    };
  }

  const scrapingAcquired = await taskQueueManager.acquireScrapingSlot('gallery', gallery.id);
  if (!scrapingAcquired) {
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

  await prisma.gallery.update({
    where: { id: gallery.id },
    data: { status: 'scraping' },
  });

  eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

  scrapeGalleryAsync(gallery.id, url, provider).catch((err) => {
    logger.errorT('log.galleryHandler.asyncScrapeError', { id: gallery.id }, err);
  });

  return {
    galleryId: gallery.id,
    seq: gallery.seq ?? seq,
    duplicate: false,
  };
}
