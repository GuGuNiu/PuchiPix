import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { getSiteRegistry, extractDomainFromUrl } from '@/lib/sites';
import { getSiteModuleByUrl } from '@/lib/sites/site-modules';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/browser-pool';
import { getGalleryDownloader } from '@/lib/downloader/gallery-downloader';
import { createStealthPage, sleep, randomDelay } from '@/lib/core/anti-crawler';
import { shouldFallbackToPlaywright } from '@/lib/core/waf-detector';
import { allocateSeq } from '@/lib/core/seq-allocator';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import { checkGalleryDuplicate } from '@/lib/utils/task-dedup';
import { normalizeUrl, cleanUrl } from '@/lib/utils/url-normalizer';

/**
 * 图库任务处理器
 *
 * 从 tasks/route.ts 提取的图库相关逻辑，供搜索引擎和任务路由共享调用。
 * 负责图库 URL 检测、图库记录创建、异步爬取和下载触发。
 */

/**
 * 检测 URL 是否属于图库站点
 *
 * 匹配优先级：SiteRegistry → site-modules 域名配置 → URL 路径兜底
 */
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
          `[GalleryHandler] 图库 Provider 通过 site-modules 兜底匹配: ${trimmedUrl} → ${moduleInfo.id}` +
          `(registry.matchesUrl 未匹配，可能存在边界情况)`,
        );
        return galleryProvider as SiteProvider & GallerySiteProvider;
      }
    }
  }

  return null;
}

/**
 * 异步爬取图库全部页面图片和视频，完成后触发下载
 */
export async function scrapeGalleryAsync(
  galleryId: number,
  url: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<void> {
  const acquired = await taskQueueManager.acquireSlot('gallery', galleryId);
  if (!acquired) {
    console.log(`[GalleryHandler] 图库 #${galleryId} 在排队等待中被取消`);
    return;
  }

  const pendingGallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
  if (!pendingGallery || pendingGallery.status === 'completed' || pendingGallery.status === 'not_found') {
    taskQueueManager.releaseSlot('gallery', galleryId);
    return;
  }

  const scrapingAcquired = await taskQueueManager.acquireScrapingSlot('gallery', galleryId);
  if (!scrapingAcquired) {
    console.log(`[GalleryHandler] 图库 #${galleryId} 在识别排队等待中被取消`);
    taskQueueManager.releaseSlot('gallery', galleryId);
    return;
  }

  const T0 = Date.now();
  const log = (msg: string): void => console.log(`[ScrapeTiming#${galleryId}] ${Date.now() - T0}ms — ${msg}`);
  log(`开始异步爬取: ${url}`);

  if (provider.supportsHttpScrape && provider.scrapeGalleryHttp) {
    try {
      log('尝试 HTTP 快速路径');
      const httpResult = await provider.scrapeGalleryHttp(url);

      const qualityCheck = shouldFallbackToPlaywright({
        title: httpResult.title,
        imageCount: httpResult.imageCount,
        videoCount: httpResult.videoCount,
        pageCount: httpResult.pageCount,
      });

      if (qualityCheck.fallback) {
        log(`HTTP 路径内容质量不足: ${qualityCheck.reason}，降级到 Playwright`);
      } else {
        log(`HTTP 爬取成功: 标题="${httpResult.title.substring(0, 30)}" 图片=${httpResult.imageCount} 视频=${httpResult.videoCount}`);

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
            status: 'downloading',
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

        log('触发下载');
        getGalleryDownloader()
          .downloadGallery(galleryId)
          .then((dlResult) => {
            log(`下载完成: 成功 ${dlResult.success}, 失败 ${dlResult.failed}, 跳过 ${dlResult.skipped}`);
          })
          .catch((err) => {
            log(`下载失败: ${err.message}`);
            eventBus.emit('gallery:downloadFailed', { galleryId, error: err.message });
          });

        return;
      }
    } catch (err) {
      log(`HTTP 路径异常: ${err instanceof Error ? err.message : err}，降级到 Playwright`);
    }
  }

  log('使用 Playwright 回退路径');

  const browser = await getSharedBrowser();
  log('获取共享浏览器实例完成');
  const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);
  log('创建 Stealth 页面完成');

  if (provider.setupBrowserContext) {
    await provider.setupBrowserContext(context);
    log('setupBrowserContext 完成');
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
        log(`开始导航: ${tryUrl}`);
        const response = await page.goto(tryUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        log(`页面导航完成 (HTTP ${response?.status()})`);

        const httpStatus = response?.status();
        if (httpStatus === 404) {
          isNotFound = true;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        if (httpStatus === 403 || httpStatus === 429) {
          const domain = extractDomainFromUrl(tryUrl);
          console.warn(`[GalleryHandler] 域名 ${tryUrl} 返回 ${httpStatus}（限流），快速切换`);
          if (domain && adaptiveProvider.markDomainRateLimited) {
            adaptiveProvider.markDomainRateLimited(domain);
          }
          lastError = new Error(`RATE_LIMITED: ${tryUrl}`);
          continue;
        }

        const resp = await page.waitForSelector('article, #gdt, #gn, .itg, #postlist, #threadlisttableid', { timeout: 10000 }).catch(() => null);
        log(`等待内容选择器完成 (${resp ? '命中' : '超时'})`);
        if (!resp) {
          lastError = new Error(`页面无内容: ${tryUrl}`);
          continue;
        }

        log('开始 scrapeGallery');
        result = await provider.scrapeGallery(page, tryUrl);
        log(`scrapeGallery 完成: 标题="${result.title.substring(0, 30)}" 图片=${result.imageCount} 视频=${result.videoCount} 页数=${result.pageCount}`);

        if (result.title === '404' || result.title.includes('页面不存在') || result.title.includes('Not Found')) {
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
        if (err instanceof Error && err.message.includes('内容被屏蔽')) {
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
          data: { status: 'not_found', errorMsg: '页面不存在 (404)' },
        });
        eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: '页面不存在 (404)' });
        return;
      }
      throw lastError || new Error('所有域名均爬取失败');
    }

    log('开始数据库写入');
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
        status: 'downloading',
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
    log('数据库写入完成');

    eventBus.emit('gallery:scrapeCompleted', {
      galleryId,
      title: result.title,
      imageCount: result.imageCount,
      videoCount: result.videoCount,
    });

    taskQueueManager.releaseScrapingSlot('gallery', galleryId);

    log('触发下载');
    getGalleryDownloader()
      .downloadGallery(galleryId)
      .then((dlResult) => {
        log(`下载完成: 成功 ${dlResult.success}, 失败 ${dlResult.failed}, 跳过 ${dlResult.skipped}`);
      })
      .catch((err) => {
        log(`下载失败: ${err.message}`);
        eventBus.emit('gallery:downloadFailed', { galleryId, error: err.message });
      });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const notFound = errMsg.includes('PAGE_NOT_FOUND') || errMsg.includes('404');
    log(`爬取异常: ${errMsg}`);

    taskQueueManager.releaseScrapingSlot('gallery', galleryId);

    await prisma.gallery.update({
      where: { id: galleryId },
      data: { status: notFound ? 'not_found' : 'failed', errorMsg: errMsg },
    });

    eventBus.emit('gallery:scrapeFailed', { galleryId, url, error: errMsg });
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    log(`流程结束（页面/上下文已关闭）`);
  }
}

/**
 * 创建图库任务并异步触发爬取
 *
 * 供搜索引擎和任务路由共享调用。执行去重检查、创建 Gallery 记录、
 * 异步触发 scrapeGalleryAsync。
 *
 * @returns 图库 ID 和编号，若重复则返回已有记录信息
 */
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
  const gallery = await prisma.gallery.upsert({
    where: { sourceUrl: normalizedUrl },
    create: {
      sourceUrl: normalizedUrl,
      siteId: provider.id,
      status: 'scraping',
      seq,
    },
    update: {
      status: 'scraping',
    },
  });

  eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

  scrapeGalleryAsync(gallery.id, url, provider).catch((err) => {
    console.error(`[GalleryHandler] 图库 #${gallery.id} 异步爬取异常:`, err);
  });

  return {
    galleryId: gallery.id,
    seq: gallery.seq ?? seq,
    duplicate: false,
  };
}
