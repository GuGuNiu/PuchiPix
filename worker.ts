
try {
  const Module = require('module');
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request: string, parent: NodeJS.Module | undefined, ...args: unknown[]) {
    if (request === 'server-only') {
      return require.resolve('./empty-server-only.js');
    }
    return origResolve.call(this, request, parent, ...args);
  };
} catch {
}

import { lifecycle } from './src/lib/core/infra/lifecycle';
import { eventBus } from './src/lib/core/infra/event-bus';
import { createLogger } from './src/lib/core/infra/logger';
import { setupWorkerIpcBridge, teardownWorkerIpcBridge } from './src/lib/core/infra/ipc-bridge';
import { isWorkerCommand, type WorkerCommand, type TaskCreatePayload, type TaskActionPayload, type TaskSelectM3u8Payload, type GalleryDownloadPayload, type GalleryActionPayload, type GalleryBatchPayload, type ConfigUpdatePayload, type DagCommandPayload } from './src/lib/core/infra/ipc-protocol';
import type { ProgressMessage } from '@/types';

const workerLogger = createLogger('Worker');

lifecycle.setMode('worker');

lifecycle.onInit({
  name: 'dag-system',
  timeout: 120000,
  fn: async () => {
    const { dagSystem } = await import('./src/lib/core/orchestrator/dag/init');
    await dagSystem.initialize();
  },
});

lifecycle.onInit({
  name: 'task-state-reset',
  timeout: 15000,
  fn: async () => {
    const { resetRunningTasksOnStartup } = await import(
      './src/lib/core/orchestrator/task/state-reset'
    );
    const { logT } = await import('@/lib/i18n/server');
    const resetResult = await resetRunningTasksOnStartup();
    workerLogger.info(logT('log.server.taskStateReset'));
    eventBus.emit('task:stateReset', { count: resetResult.total });
  },
});

lifecycle.onInit({
  name: 'seed-preset-data',
  timeout: 10000,
  fn: async () => {
    const { seedPresetData } = await import(
      './src/lib/core/infra/seed-preset-data'
    );
    await seedPresetData();
  },
});

lifecycle.onInit({
  name: 'download-manager',
  timeout: 15000,
  fn: async () => {
    const { getDownloadManager } = await import('./src/lib/api-helpers');
    const { logT } = await import('@/lib/i18n/server');
    const dm = getDownloadManager();

    dm.setProgressCallback((msg: ProgressMessage) => {
      eventBus.emit('task:progress', {
        taskId: msg.task_id,
        progress: msg.progress,
        status: msg.status,
        speed: msg.speed,
        segment: msg.segment,
        total: msg.total,
      });

      if (msg.status === 'completed') {
        eventBus.emit('task:completed', { taskId: msg.task_id });
      } else if (msg.status === 'failed') {
        eventBus.emit('task:failed', {
          taskId: msg.task_id,
          error: 'Download failed',
        });
      }
    });

    workerLogger.info(logT('log.server.downloadManagerInit'));
  },
});

lifecycle.onInit({
  name: 'event-bus-bridge',
  fn: async () => {
    setupWorkerIpcBridge();
  },
});

const SNAPSHOT_SYNC_INTERVAL = 3_000;

lifecycle.onInit({
  name: 'dag-snapshot-sync',
  fn: async () => {
    const { emitDagSnapshotSync, dagSnapshotSyncManager } = await import(
      './src/lib/core/orchestrator/dag/snapshot-sync'
    );

    dagSnapshotSyncManager.initialize();
    emitDagSnapshotSync();

    const timer = setInterval(() => {
      emitDagSnapshotSync();
    }, SNAPSHOT_SYNC_INTERVAL);

    lifecycle.onShutdown({
      name: 'dag-snapshot-sync',
      fn: async () => {
        clearInterval(timer);
        dagSnapshotSyncManager.dispose();
      },
    });

    workerLogger.info('DAG snapshot sync timer started', { intervalMs: SNAPSHOT_SYNC_INTERVAL });
  },
});

lifecycle.onInit({
  name: 'ouo-orchestrator',
  fn: async () => {
    const { getOuoOrchestrator } = await import(
      './src/lib/core/orchestrator/ouo-orchestrator'
    );
    const { logT } = await import('@/lib/i18n/server');
    getOuoOrchestrator().start();
    workerLogger.info(logT('log.server.ouoOrchestratorStart'));
  },
});

// onShutdown — graceful shutdown of heavy modules

lifecycle.onShutdown({
  name: 'task-state-reset',
  timeout: 10000,
  fn: async () => {
    const { resetRunningTasksOnStartup } = await import(
      './src/lib/core/orchestrator/task/state-reset'
    );
    await resetRunningTasksOnStartup();
    workerLogger.info('Task states reset on shutdown');
  },
});

lifecycle.onShutdown({
  name: 'download-manager',
  timeout: 10000,
  fn: async () => {
    const { getDownloadManager } = await import('./src/lib/api-helpers');
    const dm = getDownloadManager();
    await dm.stop();
    workerLogger.info('Download manager stopped');
  },
});

lifecycle.onShutdown({
  name: 'gallery-downloader',
  timeout: 10000,
  fn: async () => {
    const { getGalleryDownloader } = await import(
      './src/lib/downloader/gallery'
    );
    getGalleryDownloader().stopAll();
    workerLogger.info('Gallery downloader stopped');
  },
});

lifecycle.onShutdown({
  name: 'ouo-orchestrator',
  timeout: 15000,
  fn: async () => {
    const { getOuoOrchestrator } = await import(
      './src/lib/core/orchestrator/ouo-orchestrator'
    );
    await getOuoOrchestrator().stop();
    workerLogger.info('OUO orchestrator stopped');
  },
});

lifecycle.onShutdown({
  name: 'dag-system',
  timeout: 15000,
  fn: async () => {
    const { dagSystem } = await import(
      './src/lib/core/orchestrator/dag/init'
    );
    await dagSystem.shutdown();
    workerLogger.info('DAG system stopped');
  },
});

lifecycle.onShutdown({
  name: 'browser-instances',
  timeout: 10000,
  fn: async () => {
    const { closeSharedBrowser } = await import(
      './src/lib/core/stealth/browser-pool'
    );
    const { getSearchEngine } = await import('./src/lib/search');
    const { getScraper } = await import('./src/lib/sites/scraper');
    const { getSniffer } = await import('./src/lib/sites/sniffer');

    await Promise.allSettled([
      closeSharedBrowser(),
      getSearchEngine().close(),
      getScraper().close(),
      getSniffer().stop(),
    ]);

    workerLogger.info('Browser instances closed');
  },
});

lifecycle.onShutdown({
  name: 'ttl-lock-cleanup',
  fn: async () => {
    const { ttlLock } = await import('./src/lib/core/infra/ttl-lock');
    ttlLock.stopCleanup();
    ttlLock.clear();
  },
});

lifecycle.onShutdown({
  name: 'event-bus',
  fn: async () => {
    eventBus.emit('system:shutdown', { reason: 'graceful' });
    teardownWorkerIpcBridge();
    eventBus.clear();
  },
});

// IPC command handling

let isShuttingDown = false;

// Auto-close when parent process exits unexpectedly to prevent orphan process
process.on('disconnect', () => {
  workerLogger.warn('IPC channel disconnected, parent process may have died');
  if (!isShuttingDown) {
    isShuttingDown = true;
    lifecycle.shutdown(1).catch(() => process.exit(1));
  }
});

process.on('message', async (msg: unknown) => {
  if (!isWorkerCommand(msg)) {
    workerLogger.warn('Received invalid message from parent', { msg });
    return;
  }

  try {
    await handleCommand(msg);
  } catch (err) {
    workerLogger.error('Command handling failed', {
      cmd: msg.type,
      error: err instanceof Error ? err.message : String(err),
    });
    process.send?.({
      type: 'error',
      payload: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
  }
});

async function handleCommand(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case 'task:create': {
      await handleTaskCreate(cmd.payload);
      break;
    }

    case 'task:action': {
      await handleTaskAction(cmd.payload);
      break;
    }

    case 'task:select-m3u8': {
      await handleTaskSelectM3u8(cmd.payload);
      break;
    }

    case 'gallery:download': {
      await handleGalleryDownload(cmd.payload);
      break;
    }

    case 'gallery:action': {
      await handleGalleryAction(cmd.payload);
      break;
    }

    case 'gallery:batch': {
      await handleGalleryBatch(cmd.payload);
      break;
    }

    case 'config:update': {
      await handleConfigUpdate(cmd.payload);
      break;
    }

    case 'dag:command': {
      await handleDagCommand(cmd.payload);
      break;
    }

    case 'shutdown': {
      await handleShutdown();
      break;
    }
  }
}

async function handleTaskCreate(payload: TaskCreatePayload): Promise<void> {
  const { taskType, url, galleryId, taskId, sniffId, siteId, concurrency } = payload;

  if (taskType === 'gallery' && galleryId !== undefined) {
    const { getGalleryProvider, scrapeGalleryAsync } = await import(
      './src/lib/downloader/gallery-handler'
    );
    const provider = getGalleryProvider(url);
    if (provider) {
      // DAG path: submit DAG for orchestrator scheduling (scrape + download)
      const { dagConfig } = await import('./src/lib/core/orchestrator/dag/config');
      const { dagOrchestrator } = await import('./src/lib/core/orchestrator/dag/orchestrator');
      const { createGalleryDag } = await import('./src/lib/core/orchestrator/dag/init');
      const { taskQueueManager } = await import('./src/lib/core/orchestrator/task/queue-manager');
      const prisma = (await import('./src/lib/db/prisma')).default;

      if (dagConfig.enabled && dagConfig.isTaskTypeEnabledSync('gallery')) {
        const dagDefinition = createGalleryDag({
          galleryId,
          url,
          providerId: provider.id,
          isBatch: false,
        });
        dagDefinition.nodes[0].config.galleryId = galleryId;
        try {
          await dagOrchestrator.submitDag(dagDefinition);
        } catch (err) {
          workerLogger.error('DAG submission failed', { galleryId, error: err });
        }
      } else {
        // Non-DAG path: acquire scrape slot and scrape directly
        const scrapingAcquired = await taskQueueManager.acquireScrapingSlot('gallery', galleryId);
        if (!scrapingAcquired) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: 'scrape_pending' },
          });
          eventBus.emit('gallery:scrapePending', { galleryId, url });
          return;
        }

        await prisma.gallery.update({
          where: { id: galleryId },
          data: { status: 'scraping' },
        });
        eventBus.emit('gallery:scrapeStarted', { galleryId, url });

        scrapeGalleryAsync(galleryId, url, provider).catch((err: unknown) => {
          workerLogger.error('Gallery scrape failed', { galleryId, error: err });
          eventBus.emit('gallery:scrapeFailed', {
            galleryId,
            url,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  } else if (taskType === 'video' && taskId !== undefined) {
    const { scrapeVideoAsync } = await import('./src/app/api/tasks/scrape-helpers');
    scrapeVideoAsync(taskId, url).catch((err: unknown) => {
      workerLogger.error('Video scrape failed', { taskId, error: err });
    });
  } else if (taskType === 'sniff' && sniffId !== undefined && siteId) {
    const { getSiteRegistry } = await import('./src/lib/sites');
    const registry = getSiteRegistry();
    const provider = registry.getProviderByUrl(url);
    if (provider) {
      const { scrapeListingAndEnqueue } = await import('./src/app/api/tasks/scrape-helpers');
      scrapeListingAndEnqueue(sniffId, url, provider as import('./src/lib/sites').SiteProvider & import('./src/lib/sites').GallerySiteProvider).catch((err: unknown) => {
        workerLogger.error('Listing scrape failed', { sniffId, error: err });
      });
    }
  }
}

async function handleTaskAction(payload: TaskActionPayload): Promise<void> {
  const { taskId, action } = payload;
  const { getDownloadManager } = await import('./src/lib/api-helpers');
  const dm = getDownloadManager();

  switch (action) {
    case 'start': {
      const prisma = (await import('./src/lib/db/prisma')).default;
      const { mapTask } = await import('./src/lib/api-helpers');
      const { ensureM3U8URL } = await import('./src/lib/api-helpers');
      const task = await prisma.downloadTask.findUnique({
        where: { id: taskId },
        include: { videoInfo: true },
      });
      if (!task) return;

      const m3u8URL = await ensureM3U8URL({
        ID: task.id,
        URL: task.url,
        M3U8URL: task.m3u8Url,
      });
      if (!m3u8URL) return;

      const { taskQueueManager } = await import('./src/lib/core/orchestrator/task/queue-manager');
      taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
        if (!acquired) return;
        const currentTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
        if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'paused') {
          taskQueueManager.releaseSlot('video', taskId);
          return;
        }
        dm.startDownload(mapTask(task)).catch((err: unknown) => {
          eventBus.emit('task:failed', { taskId, error: err instanceof Error ? err.message : String(err) });
        });
      });
      break;
    }

    case 'pause':
      dm.pauseDownload(taskId);
      break;

    case 'cancel':
      dm.cancelDownload(taskId);
      break;

    case 'resume':
      await dm.resumeDownload(taskId);
      break;

    case 'retry': {
      const prisma = (await import('./src/lib/db/prisma')).default;
      const { mapTask } = await import('./src/lib/api-helpers');
      const { ensureM3U8URL } = await import('./src/lib/api-helpers');
      await prisma.downloadTask.update({
        where: { id: taskId },
        data: { status: 'pending', progress: 0, errorMsg: '' },
      });
      const task = await prisma.downloadTask.findUnique({
        where: { id: taskId },
        include: { videoInfo: true },
      });
      if (!task) return;

      const m3u8URL = await ensureM3U8URL({
        ID: task.id,
        URL: task.url,
        M3U8URL: task.m3u8Url,
      });
      if (!m3u8URL) return;

      dm.startDownload(mapTask(task)).catch((err: unknown) => {
        eventBus.emit('task:failed', { taskId, error: err instanceof Error ? err.message : String(err) });
      });
      break;
    }
  }
}

async function handleTaskSelectM3u8(payload: TaskSelectM3u8Payload): Promise<void> {
  const { taskId, m3u8Url } = payload;
  const prisma = (await import('./src/lib/db/prisma')).default;
  const { mapTask } = await import('./src/lib/api-helpers');
  const { getDownloadManager } = await import('./src/lib/api-helpers');
  const { deleteM3U8Candidates } = await import('./src/lib/core/domain/m3u8-candidate-store');
  const { taskQueueManager } = await import('./src/lib/core/orchestrator/task/queue-manager');

  await prisma.downloadTask.update({
    where: { id: taskId },
    data: { m3u8Url, status: 'pending', errorMsg: '' },
  });

  deleteM3U8Candidates(taskId);

  const task = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    include: { videoInfo: true },
  });
  if (!task) return;

  const dm = getDownloadManager();
  const dlTask = mapTask(task);
  taskQueueManager.acquireSlot('video', taskId).then(async (acquired) => {
    if (!acquired) return;
    const currentTask = await prisma.downloadTask.findUnique({ where: { id: taskId } });
    if (!currentTask || currentTask.status === 'cancelled' || currentTask.status === 'paused') {
      taskQueueManager.releaseSlot('video', taskId);
      return;
    }
    dm.startDownload(dlTask).catch((err: unknown) => {
      eventBus.emit('task:failed', { taskId, error: err instanceof Error ? err.message : String(err) });
    });
  });
}

async function handleGalleryDownload(payload: GalleryDownloadPayload): Promise<void> {
  const { galleryId, concurrency } = payload;
  const { getGalleryDownloader } = await import('./src/lib/downloader/gallery');
  const { taskQueueManager } = await import('./src/lib/core/orchestrator/task/queue-manager');
  const prisma = (await import('./src/lib/db/prisma')).default;
  const { logT } = await import('@/lib/i18n/server');

  taskQueueManager.acquireSlot('gallery', galleryId).then(async (acquired) => {
    if (!acquired) {
      workerLogger.infoT('log.galleryHandler.cancelledInQueue', { id: galleryId });
      return;
    }

    const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
    if (!gallery || gallery.status === 'completed' || gallery.status === 'not_found') {
      taskQueueManager.releaseSlot('gallery', galleryId);
      return;
    }

    if (gallery.status === 'scraping') {
      taskQueueManager.releaseSlot('gallery', galleryId);
      eventBus.emit('gallery:downloadFailed', { galleryId, error: logT('api.gallery.identifying') });
      return;
    }

    const noMedia = gallery.imageCount === 0 && gallery.videoCount === 0;
    if (gallery.status === 'scrape_pending' || (gallery.status === 'pending' && noMedia)) {
      taskQueueManager.releaseSlot('gallery', galleryId);
      // Re-scrape
      const { getGalleryProvider, scrapeGalleryAsync } = await import('./src/lib/downloader/gallery-handler');
      const provider = getGalleryProvider(gallery.sourceUrl);
      if (provider) {
        await prisma.gallery.update({ where: { id: galleryId }, data: { status: 'scraping', errorMsg: '' } });
        eventBus.emit('gallery:scrapeStarted', { galleryId, url: gallery.sourceUrl });
        scrapeGalleryAsync(galleryId, gallery.sourceUrl, provider).catch((err: unknown) => {
          eventBus.emit('gallery:scrapeFailed', {
            galleryId, url: gallery.sourceUrl,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      return;
    }

    if (gallery.status === 'paused' || gallery.status === 'download_pending') {
      await prisma.gallery.update({ where: { id: galleryId }, data: { status: 'downloading' } });
    }

    const total = gallery.imageCount + gallery.videoCount;
    eventBus.emit('gallery:downloadStarted', { galleryId, total });
    getGalleryDownloader().downloadGallery(galleryId, concurrency).catch((err: unknown) => {
      eventBus.emit('gallery:downloadFailed', {
        galleryId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
}

async function handleGalleryAction(payload: GalleryActionPayload): Promise<void> {
  const { galleryId, action, manualUrl, enqueue, maxRetries } = payload;
  const { getGalleryDownloader } = await import('./src/lib/downloader/gallery');
  const { taskQueueManager } = await import('./src/lib/core/orchestrator/task/queue-manager');
  const { dagConfig } = await import('./src/lib/core/orchestrator/dag/config');
  const { dagOrchestrator } = await import('./src/lib/core/orchestrator/dag/orchestrator');
  const { getOuoOrchestrator } = await import('./src/lib/core/orchestrator/ouo-orchestrator');
  const { downloadAndExtractZip } = await import('./src/lib/downloader/zip');
  const prisma = (await import('./src/lib/db/prisma')).default;

  switch (action) {
    case 'pause': {
      if (dagConfig.enabled && dagConfig.isTaskTypeEnabledSync('gallery')) {
        const dagId = `gallery-${galleryId}`;
        try {
          await dagOrchestrator.pauseDag(dagId);
        } catch {
        }
      }
      try {
        getGalleryDownloader().cancelDownload(galleryId);
      } catch {
      }
      taskQueueManager.releaseScrapingSlot('gallery', galleryId);
      taskQueueManager.releaseSlot('gallery', galleryId);
      if (!dagConfig.enabled || !dagConfig.isTaskTypeEnabledSync('gallery')) {
        await prisma.gallery.update({ where: { id: galleryId }, data: { status: 'paused' } });
      }
      break;
    }

    case 'resume': {
      const gallery = await prisma.gallery.findUnique({ where: { id: galleryId } });
      if (!gallery) return;

      if (dagConfig.enabled && dagConfig.isTaskTypeEnabledSync('gallery')) {
        const dagId = `gallery-${galleryId}`;
        try {
          await dagOrchestrator.resumeDag(dagId);
        } catch {
        }
        return;
      }

      const hasResults = gallery.imageCount > 0 || gallery.videoCount > 0;
      if (hasResults) {
        await prisma.gallery.update({ where: { id: galleryId }, data: { status: 'downloading', errorMsg: '' } });
        eventBus.emit('gallery:downloadStarted', { galleryId, total: gallery.imageCount + gallery.videoCount });
        getGalleryDownloader().downloadGallery(galleryId).catch((err: unknown) => {
          eventBus.emit('gallery:downloadFailed', {
            galleryId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      } else {
        const { getGalleryProvider, scrapeGalleryAsync } = await import('./src/lib/downloader/gallery-handler');
        const provider = getGalleryProvider(gallery.sourceUrl);
        if (provider) {
          await prisma.gallery.update({ where: { id: galleryId }, data: { status: 'scraping', errorMsg: '' } });
          eventBus.emit('gallery:scrapeStarted', { galleryId, url: gallery.sourceUrl });
          scrapeGalleryAsync(galleryId, gallery.sourceUrl, provider).catch(() => {
          });
        }
      }
      break;
    }

    case 'retry-failed': {
      const gallery = await prisma.gallery.findUnique({
        where: { id: galleryId },
        include: { images: true, videos: true },
      });
      if (!gallery) return;

      const noMedia = gallery.images.length === 0 && gallery.videos.length === 0;
      if (noMedia) {
        const { getGalleryProvider, scrapeGalleryAsync } = await import('./src/lib/downloader/gallery-handler');
        const provider = getGalleryProvider(gallery.sourceUrl);
        if (provider) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { status: 'scrape_pending', errorMsg: '', imageCount: 0, videoCount: 0 },
          });
          eventBus.emit('gallery:scrapeStarted', { galleryId, url: gallery.sourceUrl });
          scrapeGalleryAsync(galleryId, gallery.sourceUrl, provider).catch((err: unknown) => {
            eventBus.emit('gallery:scrapeFailed', {
              galleryId, url: gallery.sourceUrl,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
        return;
      }

      taskQueueManager.acquireSlot('gallery', galleryId).then(async (acquired) => {
        if (!acquired) return;
        getGalleryDownloader().retryFailedImages(galleryId).catch((err: unknown) => {
          eventBus.emit('gallery:downloadFailed', {
            galleryId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
      break;
    }

    case 'download-zip': {
      const gallery = await prisma.gallery.findUnique({
        where: { id: galleryId },
        include: { downloadInfo: true },
      });
      if (!gallery || !gallery.downloadInfo) return;

      const effectiveUrl = manualUrl || gallery.downloadInfo.downloadUrl;
      if (!effectiveUrl) return;

      if (manualUrl && manualUrl !== gallery.downloadInfo.downloadUrl) {
        await prisma.galleryDownloadInfo.update({
          where: { galleryId },
          data: { downloadUrl: manualUrl },
        });
      }

      if (enqueue) {
        const orchestrator = getOuoOrchestrator();
        orchestrator.enqueueOuo(galleryId, effectiveUrl, manualUrl, maxRetries);
        return;
      }

      await downloadAndExtractZip(galleryId, manualUrl);
      break;
    }
  }
}

async function handleGalleryBatch(payload: GalleryBatchPayload): Promise<void> {
  const { urls, siteId: _siteId } = payload;
  const { createGalleryTask, getGalleryProvider } = await import('./src/lib/downloader/gallery-handler');
  const { getSiteRegistry } = await import('./src/lib/sites');
  const registry = getSiteRegistry();
  const { sleep, randomDelay } = await import('./src/lib/core/stealth/anti-crawler');

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim();
    if (!url) continue;

    const provider = registry.getProviderByUrl(url);
    if (!provider) continue;

    const galleryProvider = getGalleryProvider(url);
    if (!galleryProvider) continue;

    try {
      await createGalleryTask(url, galleryProvider);
    } catch (err) {
      workerLogger.error('Batch gallery create failed', { url, error: err });
    }

    if (i < urls.length - 1) {
      await sleep(randomDelay(3000, 8000));
    }
  }
}

async function handleConfigUpdate(payload: ConfigUpdatePayload): Promise<void> {
  const { key, value } = payload;
  const { taskQueueManager } = await import('./src/lib/core/orchestrator/task/queue-manager');

  const numValue = Number(value);
  const settings: Record<string, number> = {
    maxConcurrentTasks: numValue,
    maxConcurrentSniffTasks: numValue,
    maxScrapingTasks: numValue,
    tsSegmentConcurrent: numValue,
    galleryImageConcurrent: numValue,
  };

  if (key in settings) {
    const stats = taskQueueManager.getStats();
    await taskQueueManager.updateSettings(
      key === 'maxConcurrentTasks' ? numValue : stats.maxConcurrentTasks,
      key === 'maxConcurrentSniffTasks' ? numValue : stats.maxConcurrentSniffTasks,
      key === 'tsSegmentConcurrent' ? numValue : stats.tsSegmentConcurrent,
      key === 'galleryImageConcurrent' ? numValue : stats.galleryImageConcurrent,
      key === 'maxScrapingTasks' ? numValue : stats.maxScrapingTasks,
    );
  }
}

async function handleDagCommand(payload: DagCommandPayload): Promise<void> {
  const { dagId, command, nodeId } = payload;
  const { dagOrchestrator } = await import('./src/lib/core/orchestrator/dag/orchestrator');

  if (!dagId) return;

  switch (command) {
    case 'pause':
      await dagOrchestrator.pauseDag(dagId);
      break;
    case 'resume':
      await dagOrchestrator.resumeDag(dagId, nodeId);
      break;
    case 'retry':
      await dagOrchestrator.retryDag(dagId, nodeId);
      break;
    case 'cancel':
      await dagOrchestrator.cancelDag(dagId);
      break;
  }
}

async function handleShutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  workerLogger.info('Received shutdown command, starting graceful shutdown');
  await lifecycle.shutdown(0);
  process.send?.({ type: 'shutdown:complete' });
  process.exit(0);
}

// Start

async function boot(): Promise<void> {
  try {
    workerLogger.info('Worker boot sequence started');
    await lifecycle.boot();
    process.send?.({ type: 'ready' });
    workerLogger.info('Worker ready signal sent to parent');
  } catch (err) {
    workerLogger.error('Worker boot failed', { error: err });
    process.send?.({
      type: 'error',
      payload: {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
    });
    process.exit(1);
  }
}

boot();
