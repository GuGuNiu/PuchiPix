import { getOrCreateGlobal } from './global-singleton';

export interface EventMap {
  // 下载任务事件
  'task:created': { taskId: number; title?: string; source?: string };
  'task:progress': { taskId: number; progress: number; status: string; speed?: string; segment?: number; total?: number };
  'task:completed': { taskId: number; title?: string };
  'task:failed': { taskId: number; error: string };
  'task:cancelled': { taskId: number };
  'task:deleted': { taskId: number };
  'task:scraped': { taskId: number; m3u8URL: string; title: string };
  'task:scraping': { taskId: number; url: string };
  'task:m3u8Select': { taskId: number; candidates: { url: string; title: string }[] };

  // 搜索事件
  'search:started': { jobId: string; keywords: string[] };
  'search:completed': { jobId: string; totalFound: number; totalDownloaded: number };
  'search:failed': { jobId: string; error: string };

  // 爬取事件
  'scrape:started': { pageUrl: string };
  'scrape:completed': { pageUrl: string; m3u8Url: string; title: string };
  'scrape:failed': { pageUrl: string; error: string };

  // 嗅探事件
  'sniff:url': { url: string; type: string };
  'sniff:started': { targetUrl: string };
  'sniff:stopped': { captured: number };

  // 图库事件
  'gallery:scrapeStarted': { galleryId: number; url: string };
  'gallery:scrapeCompleted': { galleryId: number; title: string; imageCount: number; videoCount: number };
  'gallery:scrapeFailed': { galleryId: number; url: string; error: string };
  'gallery:downloadStarted': { galleryId: number; total: number };
  'gallery:downloadProgress': { galleryId: number; completed: number; total: number; failed: number };
  'gallery:downloadCompleted': { galleryId: number; success: number; failed: number; skipped: number; savePath: string; status: string; actualImages: number; actualVideos: number; expectedImages: number; expectedVideos: number };
  'gallery:downloadFailed': { galleryId: number; error: string };
  'gallery:deleted': { galleryId: number };

  // 图库 ZIP 压缩包事件
  'gallery:zipDownloadStarted': { galleryId: number; url: string };
  'gallery:zipDownloadProgress': { galleryId: number; downloaded: number; total: number; percent: number };
  'gallery:zipDownloadCompleted': { galleryId: number; localPath: string; actualSize: number };
  'gallery:zipDownloadFailed': { galleryId: number; error: string };
  'gallery:zipExtractFailed': { galleryId: number; error: string };
  'gallery:zipExtractCompleted': { galleryId: number; extractedPath: string; fileCount: number };
  'gallery:zipVerifyFailed': { galleryId: number; reason: string; expectedImages: number; actualImages: number; expectedVideos: number; actualVideos: number };

  // OUO 任务编排器事件
  'ouo:taskQueued': { galleryId: number; ouoUrl: string; queuePosition: number };
  'ouo:taskStarted': { galleryId: number; ouoUrl: string; processedCount: number };
  'ouo:taskCompleted': { galleryId: number; success: boolean; zipFileName?: string; contentVerified?: boolean };
  'ouo:taskFailed': { galleryId: number; error: string; willRetry: boolean };
  'ouo:cooldown': { reason: string; durationMs: number; nextTaskAt?: number };
  'ouo:rateLimited': { galleryId: number; cooldownMs: number };
  'ouo:queueEmpty': { totalProcessed: number; totalSucceeded: number; totalFailed: number };
  'ouo:orchestratorStatus': { running: boolean; paused: boolean; queueLength: number; processedCount: number; rateLimited: boolean };

  // 嗅探任务事件（列表页批量分析）
  'sniffTask:started': { sniffId: number; url: string };
  'sniffTask:galleryCreated': { sniffId: number; url: string; galleryId: number; seq?: string | null; title: string; totalCreated: number; totalSkipped: number };
  'sniffTask:completed': { sniffId: number; url: string; totalFound: number; totalCreated: number; totalSkipped: number };
  'sniffTask:failed': { sniffId: number; url: string; error: string };
  'sniffTask:deleted': { sniffId: number };

  // 系统事件
  'system:health': { status: string; uptime: number };
  'system:shutdown': { reason: string };
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;

export interface EventSubscription {
  /** 取消订阅 */
  unsubscribe: () => void;
}

class EventBus {
  /** 精确事件订阅者 */
  private handlers: Map<string, Set<(payload: unknown) => void>> = new Map();
  /** 通配符订阅者 */
  private wildcardHandlers: Set<(name: string, payload: unknown) => void> = new Set();
  /** 最近事件缓存（每个事件类型保留最后一条） */
  private lastEvents: Map<string, { payload: unknown; timestamp: number }> = new Map();
  /** Socket.IO 桥接函数 */
  private socketBridge: ((event: string, payload: unknown) => void) | null = null;

  /**
   * 订阅事件。
   *
   * @param event - 事件名称，或 '*' 订阅所有事件
   * @param handler - 事件处理函数
   * @returns 订阅句柄，调用 unsubscribe() 取消
   */
  on<K extends EventName>(event: K, handler: EventHandler<K>): EventSubscription;
  on(event: '*', handler: (name: EventName, payload: unknown) => void): EventSubscription;
  on(
    event: string,
    handler: ((payload: unknown) => void) | ((name: string, payload: unknown) => void)
  ): EventSubscription {
    if (event === '*') {
      this.wildcardHandlers.add(handler as (name: string, payload: unknown) => void);
      return {
        unsubscribe: () => {
          this.wildcardHandlers.delete(handler as (name: string, payload: unknown) => void);
        },
      };
    }

    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: unknown) => void);

    return {
      unsubscribe: () => {
        set!.delete(handler as (payload: unknown) => void);
        if (set!.size === 0) {
          this.handlers.delete(event);
        }
      },
    };
  }

  /**
   * 订阅事件（仅触发一次）。
   */
  once<K extends EventName>(event: K, handler: EventHandler<K>): EventSubscription {
    const sub = this.on(event, (payload: EventMap[K]) => {
      sub.unsubscribe();
      handler(payload);
    });
    return sub;
  }

  /**
   * 发布事件。
   *
   * 同步通知所有订阅者，并桥接到 Socket.IO（如已设置）。
   *
   * @param event - 事件名称
   * @param payload - 事件载荷
   */
  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    // 缓存最近事件
    this.lastEvents.set(event, { payload, timestamp: Date.now() });

    // 通知精确订阅者
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[EventBus] handler error for "${event}":`, err);
        }
      }
    }

    // 通知通配符订阅者
    for (const handler of this.wildcardHandlers) {
      try {
        handler(event, payload);
      } catch (err) {
        console.error(`[EventBus] wildcard handler error for "${event}":`, err);
      }
    }

    // 桥接到 Socket.IO
    if (this.socketBridge) {
      try {
        this.socketBridge(event, payload);
      } catch (err) {
        console.error(`[EventBus] socket bridge error for "${event}":`, err);
      }
    }
  }

  /**
   * 获取最近一条事件（迟到的订阅者可用来补全状态）。
   */
  getLastEvent<K extends EventName>(event: K): { payload: EventMap[K]; timestamp: number } | null {
    const cached = this.lastEvents.get(event);
    if (!cached) return null;
    return { payload: cached.payload as EventMap[K], timestamp: cached.timestamp };
  }

  /**
   * 设置 Socket.IO 桥接。
   *
   * 设置后所有 emit 的事件会自动通过 Socket.IO 推送到前端。
   */
  setSocketBridge(bridge: (event: string, payload: unknown) => void): void {
    this.socketBridge = bridge;
  }

  /**
   * 移除 Socket.IO 桥接。
   */
  removeSocketBridge(): void {
    this.socketBridge = null;
  }

  /**
   * 清空所有订阅者和缓存（用于测试）。
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.lastEvents.clear();
    this.socketBridge = null;
  }

  /**
   * 获取事件统计信息。
   */
  getStats(): { eventTypes: number; totalHandlers: number; wildcardHandlers: number } {
    let total = 0;
    for (const set of this.handlers.values()) {
      total += set.size;
    }
    return {
      eventTypes: this.handlers.size,
      totalHandlers: total,
      wildcardHandlers: this.wildcardHandlers.size,
    };
  }
}

/**
 * HMR 安全的全局单例导出。
 *
 * 使用 globalThis 存储实例，确保 HMR 热重载时不会重新创建 EventBus，
 * 从而保留已注册的订阅者、最近事件缓存和 Socket.IO 桥接。
 */
export const eventBus = getOrCreateGlobal('__puchipix_event_bus__', () => new EventBus());
