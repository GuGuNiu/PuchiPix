import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { getSiteRegistry, extractDomainFromUrl } from '@/lib/sites';
import { getSharedBrowser } from '@/lib/core/stealth/browser-pool';
import { ttlLock } from '@/lib/core/infra/ttl-lock';
import { eventBus } from '@/lib/core/infra/event-bus';
import { createStealthPage, sleep, randomDelay } from '@/lib/core/stealth/anti-crawler';
import { allocateSeq } from '@/lib/core/orchestrator/seq-allocator';
import { parseTitleCount, detectDownloadSource } from '@/lib/downloader/gallery-content-verifier';
import { getGalleryDownloader } from '@/lib/downloader/gallery';
import { taskQueueManager } from '@/lib/core/orchestrator/task-queue-manager';
import type { SiteProvider, GallerySiteProvider } from '@/lib/sites';
import { t, setServerLocaleFromHeaders } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BATCH_DELAY_MIN = 3000;
const BATCH_DELAY_MAX = 8000;

interface BatchResult {
  url: string;
  status: 'completed' | 'not_found' | 'failed' | 'skipped';
  galleryId?: number;
  title?: string;
  error?: string;
}

/**
 * 处理单个图库 URL（内部函数，不返回 NextResponse）
 *
 */
async function processSingleGallery(
  url: string,
  provider: SiteProvider & GallerySiteProvider,
): Promise<BatchResult> {
  const existing = await prisma.gallery.findUnique({
    where: { sourceUrl: url },
    include: { downloadInfo: true },
  });

  if (existing && (existing.status === 'completed' || existing.status === 'not_found')) {
    return {
      url,
      status: existing.status === 'completed' ? 'skipped' : 'not_found',
      galleryId: existing.id,
      title: existing.title,
    };
  }

  const seq = await allocateSeq();
  const gallery = await prisma.gallery.upsert({
    where: { sourceUrl: url },
    create: { sourceUrl: url, siteId: provider.id, status: 'scraping', seq },
    update: { status: 'scraping' },
  });

  eventBus.emit('gallery:scrapeStarted', { galleryId: gallery.id, url });

  const lockKey = `gallery:scrape:${url}`;
  const lockHandle = await ttlLock.acquire(lockKey, { ttl: 120000, waitTimeout: 5000 });

  if (!lockHandle) {
    return { url, status: 'failed', galleryId: gallery.id, error: t('api.gallery.alreadyScraping') };
  }

  const browser = await getSharedBrowser();
  const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);

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
        const response = await page.goto(tryUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        const httpStatus = response?.status();
        if (httpStatus === 404) {
          isNotFound = true;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        // 检测 403/429 限流，快速切换域名（不再等待 10s 超时）
        if (httpStatus === 403 || httpStatus === 429) {
          const domain = extractDomainFromUrl(tryUrl);
          console.warn(`[Batch] 域名 ${tryUrl} 返回 ${httpStatus}（限流），快速切换`);
          if (domain && adaptiveProvider.markDomainRateLimited) {
            adaptiveProvider.markDomainRateLimited(domain);
          }
          lastError = new Error(`RATE_LIMITED: ${tryUrl}`);
          continue;
        }

        const resp = await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
        if (!resp) {
          lastError = new Error(`页面无内容: ${tryUrl}`);
          continue;
        }

        result = await provider.scrapeGallery(page, tryUrl);

        if (result.title === '404' || result.title.includes('页面不存在') || result.title.includes('Not Found')) {
          isNotFound = true;
          result = null;
          lastError = new Error(`PAGE_NOT_FOUND: ${tryUrl}`);
          continue;
        }

        // 成功，标记域名为健康
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
        await prisma.gallery.update({
          where: { id: gallery.id },
          data: { status: 'not_found' },
        });
        return { url, status: 'not_found', galleryId: gallery.id };
      }
      throw lastError || new Error('所有域名均爬取失败');
    }

    const { expectedImages, expectedVideos } = parseTitleCount(result.title);

    await prisma.gallery.update({
      where: { id: gallery.id },
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
        gameCharacters: result.gameCharacters ? JSON.stringify(result.gameCharacters) : null,
        expectedImageCount: expectedImages,
        expectedVideoCount: expectedVideos,
        status: 'completed',
      },
    });

    if (result.zipInfo) {
      const zipDownloadSource = detectDownloadSource(result.zipInfo.downloadUrl);
      const isOuoUrl = zipDownloadSource === 'ouo';
      await prisma.galleryDownloadInfo.upsert({
        where: { galleryId: gallery.id },
        create: {
          galleryId: gallery.id,
          title: result.zipInfo.title,
          fileCount: result.zipInfo.fileCount,
          fileSizeText: result.zipInfo.fileSizeText,
          imageDimensions: result.zipInfo.imageDimensions,
          password: result.zipInfo.password,
          downloadUrl: result.zipInfo.downloadUrl,
          downloadSource: zipDownloadSource,
          ouoUrl: isOuoUrl ? result.zipInfo.downloadUrl : '',
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
          downloadSource: zipDownloadSource,
          ouoUrl: isOuoUrl ? result.zipInfo.downloadUrl : '',
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
          galleryId: gallery.id,
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
          galleryId: gallery.id,
          url: vid.url,
          status: 'pending',
        })),
      });
    }

    eventBus.emit('gallery:scrapeCompleted', {
      galleryId: gallery.id,
      title: result.title,
      imageCount: result.imageCount,
      videoCount: result.videoCount,
    });

    // 通过队列管理器获取槽位，遵守并发上限设置
    taskQueueManager.acquireSlot('gallery', gallery.id).then(async (acquired) => {
      if (!acquired) {
        console.log(`[BatchGallery] 图库 #${gallery.id} 在排队等待中被取消`);
        return;
      }
      const currentGallery = await prisma.gallery.findUnique({ where: { id: gallery.id } });
      if (!currentGallery || currentGallery.status === 'completed' || currentGallery.status === 'not_found') {
        taskQueueManager.releaseSlot('gallery', gallery.id);
        return;
      }
      getGalleryDownloader()
        .downloadGallery(gallery.id)
        .then((dlResult) => {
          console.log(
            `[BatchGallery] 图库 #${gallery.id} 下载完成: ` +
            `成功 ${dlResult.success}, 失败 ${dlResult.failed}, 跳过 ${dlResult.skipped}`,
          );
        })
        .catch((err) => {
          console.error(`[BatchGallery] 图库 #${gallery.id} 下载失败:`, err);
          // 发射失败事件，触发 TaskQueueManager.releaseSlot 释放普通槽位
          eventBus.emit('gallery:downloadFailed', { galleryId: gallery.id, error: err.message });
        });
    });

    return { url, status: 'completed', galleryId: gallery.id, title: result.title };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const notFound = errMsg.includes('PAGE_NOT_FOUND') || errMsg.includes('404');

    await prisma.gallery.update({
      where: { id: gallery.id },
      data: { status: notFound ? 'not_found' : 'failed' },
    });

    eventBus.emit('gallery:scrapeFailed', { galleryId: gallery.id, url, error: errMsg });

    return {
      url,
      status: notFound ? 'not_found' : 'failed',
      galleryId: gallery.id,
      error: errMsg,
    };
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    ttlLock.releaseHandle(lockHandle);
  }
}

/**
 * 批量爬取图库
 *
 * 逐个处理，每个任务间随机延迟避免触发反爬虫。
 *
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { urls } = body as { urls?: string[] };

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'urls 参数必须是非空数组' }, { status: 400 });
    }

    const registry = getSiteRegistry();
    const results: BatchResult[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i].trim();
      if (!url) {
        results.push({ url, status: 'failed', error: '空 URL' });
        continue;
      }

      const provider = registry.getProviderByUrl(url);
      if (!provider) {
        results.push({ url, status: 'failed', error: t('api.gallery.noProvider') });
        continue;
      }

      const galleryProvider = provider as SiteProvider & Partial<GallerySiteProvider>;
      if (!galleryProvider.scrapeGallery) {
        results.push({ url, status: 'failed', error: `站点 ${provider.name} 不支持图库爬取` });
        continue;
      }

      console.log(`[BatchGallery] 处理 ${i + 1}/${urls.length}: ${url}`);

      const result = await processSingleGallery(url, galleryProvider as SiteProvider & GallerySiteProvider);
      results.push(result);

      console.log(
        `[BatchGallery] 完成 ${i + 1}/${urls.length}: ${result.status}` +
        (result.title ? ` - ${result.title}` : '') +
        (result.error ? ` - ${result.error}` : ''),
      );

      if (i < urls.length - 1) {
        const delay = randomDelay(BATCH_DELAY_MIN, BATCH_DELAY_MAX);
        console.log(`[BatchGallery] 等待 ${delay}ms 后处理下一个...`);
        await sleep(delay);
      }
    }

    const summary = {
      total: results.length,
      completed: results.filter((r) => r.status === 'completed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      not_found: results.filter((r) => r.status === 'not_found').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };

    return NextResponse.json({ results, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Batch gallery failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
