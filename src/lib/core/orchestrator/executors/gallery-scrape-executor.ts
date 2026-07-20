import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { getSiteRegistry, extractDomainFromUrl } from '@/lib/sites';
import { getSiteModuleByUrl } from '@/lib/sites/site-modules';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { getSharedBrowser, browserContextPool } from '@/lib/core/stealth/browser-pool';
import { shouldFallbackToPlaywright } from '@/lib/core/stealth/waf-detector';
import type { TaskExecutor } from '@/lib/core/orchestrator/task/executor';
import { loggers } from '@/lib/core/infra/logger';
import type {
  SchedulableNode,
  ExecutionContext,
  NodeExecutionResult,
  NodeProgress,
  TaskPhase,
} from '@/types/dag';

const logger = loggers.galleryScrapeExecutor();

function resolveProvider(url: string): (SiteProvider & GallerySiteProvider) | null {
  const trimmedUrl = url.trim();
  if (trimmedUrl.endsWith('.m3u8')) return null;

  const registry = getSiteRegistry();
  const provider = registry.getProviderByUrl(trimmedUrl);
  if (provider) {
    const gp = provider as SiteProvider & Partial<GallerySiteProvider>;
    if (typeof gp.scrapeGallery === 'function') {
      return gp as SiteProvider & GallerySiteProvider;
    }
  }

  const moduleInfo = getSiteModuleByUrl(trimmedUrl);
  if (moduleInfo && moduleInfo.type === 'photo') {
    const fallback = registry.getProvider(moduleInfo.id);
    if (fallback) {
      const gp = fallback as SiteProvider & Partial<GallerySiteProvider>;
      if (typeof gp.scrapeGallery === 'function') {
        return gp as SiteProvider & GallerySiteProvider;
      }
    }
  }

  return null;
}

class GalleryScrapeExecutor implements TaskExecutor {
  readonly key = 'gallery:scrape';
  readonly supportedPhases: TaskPhase[] = ['scrape'];

  private progress = new Map<string, NodeProgress>();
  private cancelled = new Set<string>();

  async execute(
    node: SchedulableNode,
    context: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const config = node.config as { url: string; providerId: string; galleryId: number };
    const { url, galleryId } = config;

    try {
      const provider = resolveProvider(url);
      if (!provider) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_NOT_FOUND',
            message: `Unable to resolve site provider: ${url}`,
            retryable: false,
          },
        };
      }

      const pendingGallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
      if (!pendingGallery || pendingGallery.status === 'completed' || pendingGallery.status === 'not_found') {
        return {
          success: false,
          error: {
            code: 'GALLERY_NOT_FOUND',
            message: `Gallery #${galleryId} not found or already completed`,
            retryable: false,
          },
        };
      }

      const result = await this.doScrape(galleryId, url, provider, context);

      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: {
          code: 'SCRAPE_ERROR',
          message: errMsg,
          retryable: true,
        },
      };
    }
  }

  private async doScrape(
    galleryId: number,
    url: string,
    provider: SiteProvider & GallerySiteProvider,
    context: ExecutionContext,
  ): Promise<NodeExecutionResult> {
    const T0 = Date.now();
    const log = (msg: string): void => logger.info(`ScrapeTiming #${galleryId} ${Date.now() - T0}ms | ${msg}`);
    log(`Start identification: ${url}`);

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

        if (!qualityCheck.fallback) {
          log(`HTTP scrape success: title="${httpResult.title.substring(0, 30)}" images=${httpResult.imageCount} videos=${httpResult.videoCount}`);

          const httpHasContent = httpResult.images.length > 0 || httpResult.videos.length > 0 || (httpResult.zipInfo && httpResult.zipInfo.downloadUrl);

          if (!httpHasContent) {
            log(`Gallery #${galleryId} no valid content`);
            await prisma.gallery.update({
              where: { id: galleryId },
              data: { title: httpResult.title || 'Unknown', status: 'failed', errorMsg: 'Empty scrape result' },
            });
            eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: 'Empty scrape result' });
            return { success: false, error: { code: 'EMPTY_RESULT', message: 'Empty scrape result', retryable: false } };
          }

          await this.saveScrapeResult(galleryId, httpResult);
          eventBus.emit('gallery:scrapeCompleted', { galleryId, title: httpResult.title, imageCount: httpResult.imageCount, videoCount: httpResult.videoCount });

          context.onProgress({ nodeId: '', phase: 'scrape', current: 1, total: 1 });
          return { success: true, data: { galleryId, title: httpResult.title, imageCount: httpResult.imageCount, videoCount: httpResult.videoCount } };
        }

        log(`HTTP scrape quality poor: ${qualityCheck.reason}, falling back to Playwright`);
      } catch (err) {
        log(`HTTP scrape failed: ${err instanceof Error ? err.message : err}, falling back to Playwright`);
      }
    }

    return this.scrapeWithPlaywright(galleryId, url, provider, context, log);
  }

  private async scrapeWithPlaywright(
    galleryId: number,
    url: string,
    provider: SiteProvider & GallerySiteProvider,
    context: ExecutionContext,
    log: (msg: string) => void,
  ): Promise<NodeExecutionResult> {
    const browser = await getSharedBrowser();
    log('Acquiring browser');
    const { page, context: ctx } = await browserContextPool.acquire(browser, undefined, provider.baseUrl);
    log('Acquiring stealth context (pooled)');

    if (provider.setupBrowserContext) {
      await provider.setupBrowserContext(ctx);
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
        if (this.cancelled.has(`gallery-${galleryId}`)) {
          return { success: false, error: { code: 'CANCELLED', message: 'Cancelled by user', retryable: false } };
        }

        try {
          log(`Navigating to ${tryUrl}`);
          const response = await page.goto(tryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          log(`Response status (HTTP ${response?.status()})`);

          const httpStatus = response?.status();
          if (httpStatus === 404) {
            isNotFound = true;
            lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
            continue;
          }

          if (httpStatus === 403 || httpStatus === 429) {
            const domain = extractDomainFromUrl(tryUrl);
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
          if (err instanceof Error && err.message.includes('Target closed')) throw err;
          if (err instanceof Error && err.message.includes('PAGE_NOT_FOUND')) isNotFound = true;
        }
      }

      if (!result) {
        if (isNotFound) {
          await prisma.gallery.update({ where: { id: galleryId }, data: { status: 'not_found', errorMsg: 'Page not found (404)' } });
          eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: 'Page not found (404)' });
          return { success: false, error: { code: 'NOT_FOUND', message: 'Page not found (404)', retryable: false } };
        }
        throw lastError || new Error('Scrape failed');
      }

      const hasContent = result.images.length > 0 || result.videos.length > 0 || (result.zipInfo && result.zipInfo.downloadUrl);
      if (!hasContent) {
        log(`Gallery #${galleryId} no valid content`);
        await prisma.gallery.update({ where: { id: galleryId }, data: { title: result.title || 'Unknown', status: 'failed', errorMsg: 'Empty scrape result' } });
        eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: 'Empty scrape result' });
        return { success: false, error: { code: 'EMPTY_RESULT', message: 'Empty scrape result', retryable: false } };
      }

      log('Scrape succeeded, saving data');
      await this.saveScrapeResult(galleryId, result);
      eventBus.emit('gallery:scrapeCompleted', { galleryId, title: result.title, imageCount: result.imageCount, videoCount: result.videoCount });

      context.onProgress({ nodeId: '', phase: 'scrape', current: 1, total: 1 });
      return { success: true, data: { galleryId, title: result.title, imageCount: result.imageCount, videoCount: result.videoCount } };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`Scrape failed: ${errMsg}`);

      const isBrowserClosed =
        errMsg.includes('Target closed') ||
        errMsg.includes('Target page') ||
        (errMsg.includes('Browser') && errMsg.includes('closed')) ||
        errMsg.includes('Page closed') ||
        (errMsg.includes('context') && errMsg.includes('destroyed'));

      if (isBrowserClosed) {
        log('Browser closed, resetting to pending');
        await prisma.gallery.update({ where: { id: galleryId }, data: { status: 'pending', errorMsg: '' } });
      } else {
        const notFound = errMsg.includes('PAGE_NOT_FOUND') || errMsg.includes('404');
        await prisma.gallery.update({ where: { id: galleryId }, data: { status: notFound ? 'not_found' : 'failed', errorMsg: errMsg } });
      }

      eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: errMsg });
      return { success: false, error: { code: 'SCRAPE_ERROR', message: errMsg, retryable: true } };
    } finally {
      await browserContextPool.release(ctx, page);
      log('Scrape flow ended');
    }
  }

  private async saveScrapeResult(galleryId: number, result: Awaited<ReturnType<GallerySiteProvider['scrapeGallery']>>): Promise<void> {
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

    /*
     * Clean up old image/video records before creating new ones.
     * This prevents duplicate entries when re-scraping after retry or
     * verification-triggered re-execution.
     */
    await prisma.galleryImage.deleteMany({ where: { galleryId } });
    await prisma.galleryVideo.deleteMany({ where: { galleryId } });

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
  }

  async cancel(nodeId: string): Promise<void> {
    this.cancelled.add(nodeId);
  }

  getProgress(nodeId: string): NodeProgress | null {
    return this.progress.get(nodeId) || null;
  }
}

export const galleryScrapeExecutor = new GalleryScrapeExecutor();
