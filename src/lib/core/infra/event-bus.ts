import { getOrCreateGlobal } from './global-singleton';
import { createLogger } from './logger';
import type { NodeState, NodeError, NodeExecutionResult, ResourceRequirement, DagSnapshot, SchedulerStats, SlotPoolSnapshot, SlotUsage } from '@/types/dag';

export interface EventMap {
  // DownloadtaskEvent
  'task:created': { taskId: number; title?: string; source?: string };
  'task:progress': { taskId: number; progress: number; status: string; speed?: string; segment?: number; total?: number };
  'task:completed': { taskId: number; title?: string };
  'task:failed': { taskId: number; error: string };
  'task:cancelled': { taskId: number };
  'task:deleted': { taskId: number };
  'task:scraped': { taskId: number; m3u8URL: string; title: string };
  'task:scraping': { taskId: number; url: string };
  'task:m3u8Select': { taskId: number; candidates: { url: string; title: string }[] };

  // SearchEvent
  'search:started': { jobId: string; keywords: string[] };
  'search:completed': { jobId: string; totalFound: number; totalDownloaded: number };
  'search:failed': { jobId: string; error: string };

  'scrape:started': { pageUrl: string };
  'scrape:completed': { pageUrl: string; m3u8Url: string; title: string };
  'scrape:failed': { pageUrl: string; error: string };

  'sniff:url': { url: string; type: string };
  'sniff:started': { targetUrl: string };
  'sniff:stopped': { captured: number };

  // GraphlibraryEvent
  'gallery:pending': { galleryId: number; url: string };
  'gallery:scrapePending': { galleryId: number; url: string };
  'gallery:scrapeStarted': { galleryId: number; url: string };
  'gallery:scrapeCompleted': { galleryId: number; title: string; imageCount: number; videoCount: number };
  'gallery:scrapeFailed': { galleryId: number; url: string; error: string };
  'gallery:downloadPending': { galleryId: number; url: string };
  'gallery:downloadStarted': { galleryId: number; total: number };
  'gallery:downloadProgress': { galleryId: number; completed: number; total: number; failed: number };
  'gallery:downloadCompleted': { galleryId: number; success: number; failed: number; skipped: number; savePath: string; status: string; actualImages: number; actualVideos: number; expectedImages: number; expectedVideos: number };
  'gallery:downloadFailed': { galleryId: number; error: string };
  'gallery:deleted': { galleryId: number };

  // Graphlibrary ZIP CompresspackageEvent
  'gallery:zipDownloadStarted': { galleryId: number; url: string };
  'gallery:zipDownloadProgress': { galleryId: number; downloaded: number; total: number; percent: number };
  'gallery:zipDownloadCompleted': { galleryId: number; localPath: string; actualSize: number };
  'gallery:zipDownloadFailed': { galleryId: number; error: string };
  'gallery:zipExtractFailed': { galleryId: number; error: string };
  'gallery:zipExtractCompleted': { galleryId: number; extractedPath: string; fileCount: number };
  'gallery:zipVerifyFailed': { galleryId: number; reason: string; expectedImages: number; actualImages: number; expectedVideos: number; actualVideos: number };

  // OUO TaskorchestratorEvent
  'ouo:taskQueued': { galleryId: number; ouoUrl: string; queuePosition: number };
  'ouo:taskStarted': { galleryId: number; ouoUrl: string; processedCount: number };
  'ouo:taskCompleted': { galleryId: number; success: boolean; zipFileName?: string; contentVerified?: boolean };
  'ouo:taskFailed': { galleryId: number; error: string; willRetry: boolean };
  'ouo:cooldown': { reason: string; durationMs: number; nextTaskAt?: number };
  'ouo:rateLimited': { galleryId: number; cooldownMs: number };
  'ouo:queueEmpty': { totalProcessed: number; totalSucceeded: number; totalFailed: number };
  'ouo:orchestratorStatus': { running: boolean; paused: boolean; queueLength: number; processedCount: number; rateLimited: boolean; rejectedEnqueueCount: number; maxQueueSize: number };

  'sniffTask:started': { sniffId: number; url: string };
  'sniffTask:galleryCreated': { sniffId: number; url: string; galleryId: number; seq?: string | null; title: string; totalCreated: number; totalSkipped: number };
  'sniffTask:completed': { sniffId: number; url: string; totalFound: number; totalCreated: number; totalSkipped: number };
  'sniffTask:failed': { sniffId: number; url: string; error: string };
  'sniffTask:deleted': { sniffId: number };

  'task:stateReset': { count: number };

  // SystemEvent
  'system:health': { status: string; uptime: number };
  'system:shutdown': { reason: string };

  'worker:restarting': { restartCount: number; reason: string };
  'worker:ready': { pid: number; uptime: number };

  // NotifyEvent
  'notification:info': { message: string; id?: string };
  'notification:success': { message: string; id?: string };
  'notification:warning': { message: string; id?: string };
  'notification:error': { message: string; id?: string };

  'dag:created': { dagId: string; taskType: string };
  'dag:cancelled': { dagId: string };
  'dag:completed': { dagId: string };
  'dag:paused': { dagId: string; pausedCount: number };
  'dag:resumed': { dagId: string; resumedCount: number };
  'dag:nodeStateChanged': {
    dagId: string;
    nodeId: string;
    from: NodeState;
    to: NodeState;
    timestamp: Date;
  };
  'dag:nodeCompleted': {
    dagId: string;
    nodeId: string;
    result: NodeExecutionResult;
  };
  'dag:nodeFailed': {
    dagId: string;
    nodeId: string;
    error: NodeError;
  };
  'dag:schedulingDecision': {
    dagId: string;
    nodeId: string;
    strategy: string;
    reason: string;
  };
  'dag:resourceAllocated': {
    dagId: string;
    nodeId: string;
    resources: ResourceRequirement[];
  };
  'dag:resourceReleased': {
    dagId: string;
    nodeId: string;
    resources: string[];
  };
  'dag:nodeProgress': {
    dagId: string;
    nodeId: string;
    phase: string;
    current: number;
    total: number;
    speed?: string;
    failed?: number;
  };
  'dag:nodeRetrying': {
    dagId: string;
    nodeId: string;
    retryCount: number;
    error: { code: string; message: string };
  };

  'dag:snapshotSync': {
    dags: DagSnapshot[];
    dagStats: { totalDags: number; activeDags: number; totalNodes: number };
    schedulerStats: SchedulerStats;
    slotSnapshot: SlotPoolSnapshot;
    slotStats: Record<string, SlotUsage>;
    activeHolders: Record<string, string[]>;
    downloadConcurrency: { tsSegmentConcurrent: number; galleryImageConcurrent: number };
    currentSeq: number;
    timestamp: string;
  };
}

export type EventName = keyof EventMap;
export type EventHandler<K extends EventName> = (payload: EventMap[K]) => void;

export interface EventSubscription {
  /** Unsubscribe */
  unsubscribe: () => void;
}

class EventBus {
  private handlers: Map<string, Set<(payload: unknown) => void>> = new Map();
  private wildcardHandlers: Set<(name: string, payload: unknown) => void> = new Set();
  private lastEvents: Map<string, { payload: unknown; timestamp: number }> = new Map();
  private socketBridge: ((event: string, payload: unknown) => void) | null = null;
  private ipcBridge: ((event: string, payload: unknown) => void) | null = null;
  private readonly logger = createLogger('EventBus');

  /**
   * SubscribeEvent。
   *
   * @param handler - Event handlerfunction
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

  once<K extends EventName>(event: K, handler: EventHandler<K>): EventSubscription {
    const sub = this.on(event, (payload: EventMap[K]) => {
      sub.unsubscribe();
      handler(payload);
    });
    return sub;
  }

  /**
   * PublishEvent。
   *
   *
   * @param event - Eventname
   */
  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    this.lastEvents.set(event, { payload, timestamp: Date.now() });

    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(payload);
        } catch (err) {
          this.logger.error('Handler execution error', { event, error: err });
        }
      }
    }

    for (const handler of this.wildcardHandlers) {
      try {
        handler(event, payload);
      } catch (err) {
        this.logger.error('Wildcard handler execution error', { event, error: err });
      }
    }

    if (this.socketBridge) {
      try {
        this.socketBridge(event, payload);
      } catch (err) {
        this.logger.error('Socket bridge execution error', { event, error: err });
      }
    }

    if (this.ipcBridge) {
      try {
        this.ipcBridge(event, payload);
      } catch (err) {
        this.logger.error('IPC bridge execution error', { event, error: err });
      }
    }
  }

  getLastEvent<K extends EventName>(event: K): { payload: EventMap[K]; timestamp: number } | null {
    const cached = this.lastEvents.get(event);
    if (!cached) return null;
    return { payload: cached.payload as EventMap[K], timestamp: cached.timestamp };
  }

  setSocketBridge(bridge: (event: string, payload: unknown) => void): void {
    this.socketBridge = bridge;
  }

  removeSocketBridge(): void {
    this.socketBridge = null;
  }

  
  setIpcBridge(bridge: (event: string, payload: unknown) => void): void {
    this.ipcBridge = bridge;
  }

  removeIpcBridge(): void {
    this.ipcBridge = null;
  }

  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
    this.lastEvents.clear();
    this.socketBridge = null;
    this.ipcBridge = null;
  }

  
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

export const eventBus = getOrCreateGlobal('__puchipix_event_bus__', () => new EventBus());
