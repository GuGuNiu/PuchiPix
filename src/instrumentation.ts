const _dynImport = new Function('p', 'return import(p)') as (
  p: string,
) => Promise<Record<string, unknown>>;

export async function register(): Promise<void> {
  try {
    // 注意：启动时任务状态重置已在 server.ts 的 lifecycle.onInit 中处理，
    // 此处不再重复调用，避免 Next.js 编译后模块路径解析失败。

    const { lifecycle } = await _dynImport('./lib/core/lifecycle') as {
      lifecycle: {
        onInit: (h: { name: string; fn: () => Promise<void> }) => void;
        onShutdown: (h: { name: string; fn: () => Promise<void> }) => void;
        boot: () => Promise<void>;
      };
    };

    const { getDownloadManager } = await _dynImport('./lib/api-helpers') as {
      getDownloadManager: () => { stop: () => Promise<void> };
    };
    const { getGalleryDownloader } = await _dynImport(
      './lib/downloader/gallery-downloader',
    ) as {
      getGalleryDownloader: () => { stopAll: () => void };
    };
    const { getOuoOrchestrator } = await _dynImport(
      './lib/core/ouo-orchestrator',
    ) as {
      getOuoOrchestrator: () => { start: () => void; stop: () => Promise<void> };
    };
    const { ttlLock } = await _dynImport('./lib/core/ttl-lock') as {
      ttlLock: { stopCleanup: () => void; clear: () => void };
    };
    const { eventBus } = await _dynImport('./lib/core/event-bus') as {
      eventBus: { clear: () => void; emit: (event: string, payload: unknown) => void; removeSocketBridge: () => void };
    };

    lifecycle.onInit({
      name: 'ouo-orchestrator',
      fn: async () => {
        getOuoOrchestrator().start();
      },
    });

    lifecycle.onShutdown({
      name: 'download-manager',
      fn: async () => {
        await getDownloadManager().stop();
      },
    });

    lifecycle.onShutdown({
      name: 'gallery-downloader',
      fn: async () => {
        getGalleryDownloader().stopAll();
      },
    });

    lifecycle.onShutdown({
      name: 'ouo-orchestrator',
      fn: async () => {
        await getOuoOrchestrator().stop();
      },
    });

    lifecycle.onShutdown({
      name: 'ttl-lock-cleanup',
      fn: async () => {
        ttlLock.stopCleanup();
        ttlLock.clear();
      },
    });

    lifecycle.onShutdown({
      name: 'event-bus',
      fn: async () => {
        eventBus.emit('system:shutdown', { reason: 'graceful' });
        eventBus.removeSocketBridge();
        eventBus.clear();
      },
    });

    lifecycle.onShutdown({
      name: 'browser-instances',
      fn: async () => {
        const { closeSharedBrowser } = await _dynImport('./lib/core/browser-pool') as {
          closeSharedBrowser: () => Promise<void>;
        };
        const { getSearchEngine } = await _dynImport('./lib/search/search-engine') as {
          getSearchEngine: () => { close: () => Promise<void> };
        };
        const { getScraper } = await _dynImport('./lib/scraper/scraper') as {
          getScraper: () => { close: () => Promise<void> };
        };
        const { getSniffer } = await _dynImport('./lib/scraper/sniffer') as {
          getSniffer: () => { stop: () => Promise<void> };
        };
        await Promise.allSettled([
          closeSharedBrowser(),
          getSearchEngine().close(),
          getScraper().close(),
          getSniffer().stop(),
        ]);
      },
    });

    await lifecycle.boot();
  } catch (err) {
    console.error('[Instrumentation] 初始化失败:', err);
  }
}
