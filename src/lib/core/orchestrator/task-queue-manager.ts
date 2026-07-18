﻿﻿﻿import { eventBus } from '../infra/event-bus';
import { getOrCreateGlobal } from '../infra/global-singleton';
import prisma from '@/lib/db/prisma';
import { logT } from '@/lib/i18n/server';
import { slotPool } from './slot-pool';
import { dagConfig } from './dag-config';

export type QueueTaskType = 'video' | 'gallery' | 'sniff';
const SLOT_TYPE_MAP: Record<QueueTaskType, string> = {
  video: 'download',
  gallery: 'download',
  sniff: 'sniff',
};

const CONFIG_KEY_MAX_CONCURRENT = 'task_max_concurrent';
const CONFIG_KEY_SNIFF_MAX_CONCURRENT = 'sniff_max_concurrent';
const CONFIG_KEY_TS_SEG_CONCURRENT = 'ts_segment_concurrent';
const CONFIG_KEY_GALLERY_IMG_CONCURRENT = 'gallery_image_concurrent';
const CONFIG_KEY_MAX_SCRAPING = 'task_max_scraping';

const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_SNIFF_MAX_CONCURRENT = 1;
const DEFAULT_TS_SEG_CONCURRENT = 50;
const DEFAULT_GALLERY_IMG_CONCURRENT = 5;
const DEFAULT_MAX_SCRAPING = 5;

interface PendingAcquire {
  taskType: QueueTaskType;
  taskId: number;
  resolve: (acquired: boolean) => void;
  /** Enqueue timestamp for timeout detection */
  enqueuedAt: number;
  /** Timeout timer; auto-resolves(false) on timeout */
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

export interface TaskQueueStats {
  runningNormal: number;
  runningSniff: number;
  runningScraping: number;
  queueLength: number;
  maxConcurrentTasks: number;
  maxConcurrentSniffTasks: number;
  maxScrapingTasks: number;
  tsSegmentConcurrent: number;
  galleryImageConcurrent: number;
  queueItems: { taskType: QueueTaskType; taskId: number }[];
}

class TaskQueueManager {
  private runningNormal = 0;
  private runningSniff = 0;
  private runningScraping = 0;
  private maxConcurrentTasks = DEFAULT_MAX_CONCURRENT;
  private maxConcurrentSniffTasks = DEFAULT_SNIFF_MAX_CONCURRENT;
  private maxScrapingTasks = DEFAULT_MAX_SCRAPING;
  private tsSegmentConcurrent = DEFAULT_TS_SEG_CONCURRENT;
  private galleryImageConcurrent = DEFAULT_GALLERY_IMG_CONCURRENT;
  private pendingAcquires: PendingAcquire[] = [];
  private pendingScrapingAcquires: PendingAcquire[] = [];
  private activeSlots = new Set<string>();
  private activeScrapingSlots = new Set<string>();
  private settingsLoaded = false;
  /** Settings loading promise to prevent concurrent loading */
  private loadingPromise: Promise<void> | null = null;
  private listenersRegistered = false;
  /** Debounce timer for startPendingDownload */
  private downloadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounce timer for startPendingScrape */
  private scrapeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Default acquireSlot timeout (ms, 2 minutes) */
  private static readonly ACQUIRE_SLOT_TIMEOUT_MS = 120_000;
  /** Debounce delay (ms) */
  private static readonly PENDING_DEBOUNCE_MS = 500;
  private async ensureSettingsLoaded(): Promise<void> {
    if (this.settingsLoaded) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this._doLoadSettings();
    try {
      await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  private async _doLoadSettings(): Promise<void> {
    try {
      const configs = await prisma.appConfig.findMany({
        where: {
          key: { in: [CONFIG_KEY_MAX_CONCURRENT, CONFIG_KEY_SNIFF_MAX_CONCURRENT, CONFIG_KEY_TS_SEG_CONCURRENT, CONFIG_KEY_GALLERY_IMG_CONCURRENT, CONFIG_KEY_MAX_SCRAPING] },
        },
      });

      const configMap = new Map(configs.map((c) => [c.key, c.value]));
      const missingKeys: string[] = [];

      const readOrDefault = (key: string, defaultValue: number): number => {
        const raw = configMap.get(key);
        if (raw === undefined) {
          missingKeys.push(key);
          return defaultValue;
        }
        const v = parseInt(raw, 10);
        return !isNaN(v) && v >= 1 ? v : defaultValue;
      };

      this.maxConcurrentTasks = readOrDefault(CONFIG_KEY_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT);
      this.maxConcurrentSniffTasks = readOrDefault(CONFIG_KEY_SNIFF_MAX_CONCURRENT, DEFAULT_SNIFF_MAX_CONCURRENT);
      this.tsSegmentConcurrent = readOrDefault(CONFIG_KEY_TS_SEG_CONCURRENT, DEFAULT_TS_SEG_CONCURRENT);
      this.galleryImageConcurrent = readOrDefault(CONFIG_KEY_GALLERY_IMG_CONCURRENT, DEFAULT_GALLERY_IMG_CONCURRENT);
      this.maxScrapingTasks = readOrDefault(CONFIG_KEY_MAX_SCRAPING, DEFAULT_MAX_SCRAPING);

      if (missingKeys.length > 0) {
        const defaults: Record<string, number> = {
          [CONFIG_KEY_MAX_CONCURRENT]: DEFAULT_MAX_CONCURRENT,
          [CONFIG_KEY_SNIFF_MAX_CONCURRENT]: DEFAULT_SNIFF_MAX_CONCURRENT,
          [CONFIG_KEY_TS_SEG_CONCURRENT]: DEFAULT_TS_SEG_CONCURRENT,
          [CONFIG_KEY_GALLERY_IMG_CONCURRENT]: DEFAULT_GALLERY_IMG_CONCURRENT,
          [CONFIG_KEY_MAX_SCRAPING]: DEFAULT_MAX_SCRAPING,
        };
        await Promise.all(
          missingKeys.map((key) =>
            prisma.appConfig.upsert({
              where: { key },
              create: { key, value: String(defaults[key]) },
              update: { value: String(defaults[key]) },
            })
          )
        );
        console.log(
          logT('log.taskQueue.configSeeded', {
            keys: missingKeys.join(', '),
          }),
        );
      }

    console.log(
      logT('log.taskQueue.configLoaded', {
        maxConcurrent: this.maxConcurrentTasks,
        maxScraping: this.maxScrapingTasks,
        maxSniff: this.maxConcurrentSniffTasks,
        tsSegment: this.tsSegmentConcurrent,
        galleryImage: this.galleryImageConcurrent,
      }),
    );
    } catch (err) {
      console.error(
        logT('log.taskQueue.configLoadFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
    } finally {
      this.settingsLoaded = true;
    }
  }

  private registerEventListeners(): void {
    if (this.listenersRegistered) return;
    this.listenersRegistered = true;

    eventBus.on('task:completed', ({ taskId }) => this.releaseSlot('video', taskId));
    eventBus.on('task:failed', ({ taskId }) => this.releaseSlot('video', taskId));
    eventBus.on('task:cancelled', ({ taskId }) => this.releaseSlot('video', taskId));

    eventBus.on('gallery:downloadCompleted', ({ galleryId }) =>
      this.releaseSlot('gallery', galleryId),
    );
    eventBus.on('gallery:downloadFailed', ({ galleryId }) =>
      this.releaseSlot('gallery', galleryId),
    );
    eventBus.on('gallery:scrapeFailed', ({ galleryId }) =>
      this.releaseSlot('gallery', galleryId),
    );

    eventBus.on('sniffTask:completed', ({ sniffId }) => this.releaseSlot('sniff', sniffId));
    eventBus.on('sniffTask:failed', ({ sniffId }) => this.releaseSlot('sniff', sniffId));

    console.log(logT('log.taskQueue.listenersRegistered'));
  }

  /**
   * Check whether a slot is available (synchronous, non-blocking).
   *
   * Note: On first call, settings may not be fully loaded yet; a conservative
   * estimate based on defaults is returned. To ensure settings are loaded,
   * use the async acquireSlot() interface instead.
   *
   * @param taskType - Task type
   * @returns true = slot available, false = slots exhausted
   */
  hasAvailableSlot(taskType: QueueTaskType): boolean {
    // Trigger async loading (does not block the current call)
    this.ensureSettingsLoaded().catch(() => {});
    
    const isSniff = taskType === 'sniff';
    const maxSlots = isSniff ? this.maxConcurrentSniffTasks : this.maxConcurrentTasks;
    const currentSlots = isSniff ? this.runningSniff : this.runningNormal;
    
    return currentSlots < maxSlots;
  }

  /**
   * Get current slot usage (synchronous).
   */
  getSlotUsage(taskType: QueueTaskType): { current: number; max: number; available: boolean } {
    const isSniff = taskType === 'sniff';
    const max = isSniff ? this.maxConcurrentSniffTasks : this.maxConcurrentTasks;
    const current = isSniff ? this.runningSniff : this.runningNormal;
    
    return { current, max, available: current < max };
  }

  /**
   * Check whether the specified task already holds a normal slot.
   */
  hasActiveSlot(taskType: QueueTaskType, taskId: number): boolean {
    const key = `${taskType}-${taskId}`;
    return this.activeSlots.has(key);
  }

  /**
   * Check whether the specified task already holds a scraping slot.
   */
  hasActiveScrapingSlot(taskType: QueueTaskType, taskId: number): boolean {
    const key = `${taskType}-${taskId}`;
    return this.activeScrapingSlots.has(key);
  }

  /**
   * Acquire a slot (blocks when full, with timeout protection).
   *
   * Note: When the DAG system is enabled, this method delegates to the
   * synchronous SlotPool.acquire. The async interface is retained for
   * backward compatibility but returns immediately.
   *
   * @param taskType - Task type
   * @param taskId - Task ID
   * @param timeoutMs - Timeout in ms (default 120s); resolves false on timeout
   * @returns true = slot acquired, false = cancelled or timed out
   */
  async acquireSlot(taskType: QueueTaskType, taskId: number, timeoutMs: number = TaskQueueManager.ACQUIRE_SLOT_TIMEOUT_MS): Promise<boolean> {
    // When the DAG system is enabled, use the new SlotPool
    if (dagConfig.enabled && slotPool.initialized) {
      const slotType = SLOT_TYPE_MAP[taskType];
      const holderId = `${taskType}-${taskId}`;

      // Check if already held
      if (slotPool.hasHolder(slotType as any, holderId)) {
        return true;
      }

      // Synchronously acquire slot
      const acquired = slotPool.acquire(slotType as any, holderId);
      if (acquired) {
        // Synchronously update local counters (for legacy compatibility)
        const isSniff = taskType === 'sniff';
        if (isSniff) this.runningSniff++;
        else this.runningNormal++;
        this.activeSlots.add(holderId);
      }
      return acquired;
    }

    // Legacy logic (when DAG is not enabled)
    await this.ensureSettingsLoaded();
    this.registerEventListeners();

    const key = `${taskType}-${taskId}`;
    if (this.activeSlots.has(key)) {
      return true;
    }

    const isSniff = taskType === 'sniff';
    const maxSlots = isSniff ? this.maxConcurrentSniffTasks : this.maxConcurrentTasks;
    const currentSlots = isSniff ? this.runningSniff : this.runningNormal;

    if (currentSlots < maxSlots) {
      this.activeSlots.add(key);
      if (isSniff) this.runningSniff++;
      else this.runningNormal++;
      console.log(
        logT('log.taskQueue.slotAllocated', {
          key,
          normal: this.runningNormal,
          maxNormal: this.maxConcurrentTasks,
          sniff: this.runningSniff,
          maxSniff: this.maxConcurrentSniffTasks,
        }),
      );
      return true;
    }

    console.log(
      logT('log.taskQueue.slotFull', { key, position: this.pendingAcquires.length + 1 }),
    );
    return new Promise<boolean>((resolve) => {
      const enqueuedAt = Date.now();
      // Timeout protection: prevents indefinite blocking due to slot leaks
      const timeoutTimer = setTimeout(() => {
        const idx = this.pendingAcquires.findIndex(
          (a) => a.taskType === taskType && a.taskId === taskId,
        );
        if (idx >= 0) {
          this.pendingAcquires.splice(idx, 1);
          console.warn(
            `[TaskQueue] Slot acquire timed out: key=${key}, giving up after ${timeoutMs}ms (possible slot leak)`,
          );
          resolve(false);
        }
      }, timeoutMs);

      this.pendingAcquires.push({ taskType, taskId, resolve, enqueuedAt, timeoutTimer });
    });
  }

  releaseSlot(taskType: QueueTaskType, taskId: number): void {
    const key = `${taskType}-${taskId}`;

    if (dagConfig.enabled && slotPool.initialized) {
      const slotType = SLOT_TYPE_MAP[taskType];
      slotPool.release(slotType as any, key);

      if (this.activeSlots.has(key)) {
        this.activeSlots.delete(key);
        const isSniff = taskType === 'sniff';
        if (isSniff) {
          this.runningSniff = Math.max(0, this.runningSniff - 1);
        } else {
          this.runningNormal = Math.max(0, this.runningNormal - 1);
        }
      }
      return;
    }

    // Legacy logic
    if (!this.activeSlots.has(key)) {
      return;
    }

    this.activeSlots.delete(key);
    const isSniff = taskType === 'sniff';
    if (isSniff) {
      this.runningSniff = Math.max(0, this.runningSniff - 1);
    } else {
      this.runningNormal = Math.max(0, this.runningNormal - 1);
    }

    console.log(
      logT('log.taskQueue.slotReleased', {
        key,
        normal: this.runningNormal,
        maxNormal: this.maxConcurrentTasks,
        sniff: this.runningSniff,
        maxSniff: this.maxConcurrentSniffTasks,
      }),
    );

    this.tryStartNext();

    this.debounceStartDownload(taskType);
  }

  private async startPendingDownload(taskType: QueueTaskType, releasedTaskId: number): Promise<void> {
    if (taskType !== 'gallery' && taskType !== 'video') return;

    try {
      const { default: prisma } = await import('@/lib/db/prisma');

      if (taskType === 'gallery') {
        let startedCount = 0;
        while (this.runningNormal < this.maxConcurrentTasks) {
          const pendingGallery = await prisma.gallery.findFirst({
            where: { status: 'download_pending' },
            orderBy: { updatedAt: 'asc' },
          });

          if (!pendingGallery) break;

          if (this.runningNormal >= this.maxConcurrentTasks) break;

          console.log(`[TaskQueue] Found download_pending gallery #${pendingGallery.id}, attempting to start download`);

          const acquired = await this.acquireSlot('gallery', pendingGallery.id);
          if (!acquired) break;

          const { getGalleryDownloader } = await import('@/lib/downloader/gallery');
          await prisma.gallery.update({
            where: { id: pendingGallery.id },
            data: { status: 'downloading' },
          });
          getGalleryDownloader()
            .downloadGallery(pendingGallery.id)
            .catch((err: unknown) => {
              console.error(`[TaskQueue] download_pending gallery #${pendingGallery.id} download failed:`, err);
            });
          startedCount++;
        }

        if (startedCount > 0) {
          console.log(`[TaskQueue] Started ${startedCount} download_pending task(s) in this batch`);
        }
      }
    } catch (err) {
      console.error('[TaskQueue] Failed to start download_pending tasks:', err);
    }
  }

  private async startPendingScrape(taskType: QueueTaskType, releasedTaskId: number): Promise<void> {
    if (taskType !== 'gallery') return;

    try {
      const { default: prisma } = await import('@/lib/db/prisma');

      let startedCount = 0;
      while (this.runningScraping < this.maxScrapingTasks) {
        const pendingGallery = await prisma.gallery.findFirst({
          where: { status: 'scrape_pending' },
          orderBy: { updatedAt: 'asc' },
        });

        if (!pendingGallery) break;

        if (this.runningScraping >= this.maxScrapingTasks) break;

        console.log(`[TaskQueue] Found scrape_pending gallery #${pendingGallery.id}, attempting to start scraping`);

        const acquired = await this.acquireScrapingSlot('gallery', pendingGallery.id);
        if (!acquired) break;

        const { getGalleryProvider } = await import('@/lib/tasks/gallery-handler');
        const provider = getGalleryProvider(pendingGallery.sourceUrl);

        if (provider) {
          await prisma.gallery.update({
            where: { id: pendingGallery.id },
            data: { status: 'scraping' },
          });

          const { scrapeGalleryAsync } = await import('@/lib/tasks/gallery-handler');
          scrapeGalleryAsync(pendingGallery.id, pendingGallery.sourceUrl, provider).catch((err: unknown) => {
            console.error(`[TaskQueue] scrape_pending gallery #${pendingGallery.id} scraping failed:`, err);
          });
          startedCount++;
        } else {
          this.releaseScrapingSlot('gallery', pendingGallery.id);
          await prisma.gallery.update({
            where: { id: pendingGallery.id },
            data: { status: 'failed', errorMsg: 'Unable to identify site provider' },
          }).catch(() => {});
        }
      }

      if (startedCount > 0) {
        console.log(`[TaskQueue] Started ${startedCount} scrape_pending task(s) in this batch`);
      }
    } catch (err) {
      console.error('[TaskQueue] Failed to start scrape_pending tasks:', err);
    }
  }

  private debounceStartDownload(taskType: QueueTaskType): void {
    if (taskType !== 'gallery' && taskType !== 'video') return;
    if (this.downloadDebounceTimer) clearTimeout(this.downloadDebounceTimer);
    this.downloadDebounceTimer = setTimeout(() => {
      this.downloadDebounceTimer = null;
      this.startPendingDownload(taskType, 0).catch(() => {});
    }, TaskQueueManager.PENDING_DEBOUNCE_MS);
  }

  private debounceStartScrape(taskType: QueueTaskType): void {
    if (taskType !== 'gallery') return;
    if (this.scrapeDebounceTimer) clearTimeout(this.scrapeDebounceTimer);
    this.scrapeDebounceTimer = setTimeout(() => {
      this.scrapeDebounceTimer = null;
      this.startPendingScrape(taskType, 0).catch(() => {});
    }, TaskQueueManager.PENDING_DEBOUNCE_MS);
  }

  cancelAcquire(taskType: QueueTaskType, taskId: number): boolean {
    const idx = this.pendingAcquires.findIndex(
      (a) => a.taskType === taskType && a.taskId === taskId,
    );
    if (idx >= 0) {
      const [acquire] = this.pendingAcquires.splice(idx, 1);
      if (acquire.timeoutTimer) clearTimeout(acquire.timeoutTimer);
      acquire.resolve(false);
      console.log(logT('log.taskQueue.pendingCancel', { type: taskType, id: taskId }));
      return true;
    }
    return false;
  }

  private tryStartNext(): void {
    while (this.pendingAcquires.length > 0) {
      const idx = this.pendingAcquires.findIndex((a) => {
        if (a.taskType === 'sniff') {
          return this.runningSniff < this.maxConcurrentSniffTasks;
        } else {
          return this.runningNormal < this.maxConcurrentTasks;
        }
      });

      if (idx < 0) break;

      const acquire = this.pendingAcquires.splice(idx, 1)[0];
      if (acquire.timeoutTimer) clearTimeout(acquire.timeoutTimer);
      const key = `${acquire.taskType}-${acquire.taskId}`;
      this.activeSlots.add(key);
      if (acquire.taskType === 'sniff') this.runningSniff++;
      else this.runningNormal++;

      console.log(
        logT('log.taskQueue.pendingGranted', {
          key,
          normal: this.runningNormal,
          maxNormal: this.maxConcurrentTasks,
          sniff: this.runningSniff,
          maxSniff: this.maxConcurrentSniffTasks,
        }),
      );
      acquire.resolve(true);
    }
  }

  async acquireScrapingSlot(taskType: QueueTaskType, taskId: number): Promise<boolean> {
    const key = `${taskType}-${taskId}`;

    // When the DAG system is enabled, use the new SlotPool
    if (dagConfig.enabled && slotPool.initialized) {
      // Check if already held
      if (slotPool.hasHolder('scraping', key)) {
        return true;
      }

      // Synchronously acquire slot
      const acquired = slotPool.acquire('scraping', key);
      if (acquired) {
        this.activeScrapingSlots.add(key);
        this.runningScraping++;
      }
      return acquired;
    }

    await this.ensureSettingsLoaded();

    if (this.activeScrapingSlots.has(key)) {
      return true;
    }

    if (this.runningScraping < this.maxScrapingTasks) {
      this.activeScrapingSlots.add(key);
      this.runningScraping++;
      console.log(
        logT('log.taskQueue.scrapingAllocated', { key, scraping: this.runningScraping, maxScraping: this.maxScrapingTasks }),
      );
      return true;
    }

    console.log(
      logT('log.taskQueue.scrapingFull', { key, position: this.pendingScrapingAcquires.length + 1 }),
    );
    return new Promise<boolean>((resolve) => {
      const enqueuedAt = Date.now();
      const timeoutTimer = setTimeout(() => {
        const idx = this.pendingScrapingAcquires.findIndex(
          (a) => a.taskType === taskType && a.taskId === taskId,
        );
        if (idx >= 0) {
          this.pendingScrapingAcquires.splice(idx, 1);
          console.warn(
            `[TaskQueue] Scraping slot acquire timed out: key=${key}, giving up after ${TaskQueueManager.ACQUIRE_SLOT_TIMEOUT_MS}ms`,
          );
          resolve(false);
        }
      }, TaskQueueManager.ACQUIRE_SLOT_TIMEOUT_MS);

      this.pendingScrapingAcquires.push({ taskType, taskId, resolve, enqueuedAt, timeoutTimer });
    });
  }

  releaseScrapingSlot(taskType: QueueTaskType, taskId: number): void {
    const key = `${taskType}-${taskId}`;

    // When the DAG system is enabled, use the new SlotPool
    if (dagConfig.enabled && slotPool.initialized) {
      slotPool.release('scraping', key);

      // Synchronously update local counters
      if (this.activeScrapingSlots.has(key)) {
        this.activeScrapingSlots.delete(key);
        this.runningScraping = Math.max(0, this.runningScraping - 1);
      }
      return;
    }

    // Legacy logic
    if (!this.activeScrapingSlots.has(key)) {
      return;
    }

    this.activeScrapingSlots.delete(key);
    this.runningScraping = Math.max(0, this.runningScraping - 1);

    console.log(
      logT('log.taskQueue.scrapingReleased', { key, scraping: this.runningScraping, maxScraping: this.maxScrapingTasks }),
    );

    this.tryStartNextScraping();

    this.debounceStartScrape(taskType);
  }

  cancelScrapingAcquire(taskType: QueueTaskType, taskId: number): boolean {
    const idx = this.pendingScrapingAcquires.findIndex(
      (a) => a.taskType === taskType && a.taskId === taskId,
    );
    if (idx >= 0) {
      const [acquire] = this.pendingScrapingAcquires.splice(idx, 1);
      if (acquire.timeoutTimer) clearTimeout(acquire.timeoutTimer);
      acquire.resolve(false);
      console.log(logT('log.taskQueue.scrapingCancel', { type: taskType, id: taskId }));
      return true;
    }
    return false;
  }

  private tryStartNextScraping(): void {
    while (this.pendingScrapingAcquires.length > 0) {
      if (this.runningScraping >= this.maxScrapingTasks) break;

      const acquire = this.pendingScrapingAcquires.shift()!;
      if (acquire.timeoutTimer) clearTimeout(acquire.timeoutTimer);
      const key = `${acquire.taskType}-${acquire.taskId}`;
      this.activeScrapingSlots.add(key);
      this.runningScraping++;

      console.log(
        logT('log.taskQueue.scrapingGranted', { key, scraping: this.runningScraping, maxScraping: this.maxScrapingTasks }),
      );
      acquire.resolve(true);
    }
  }

  async startupRecovery(): Promise<void> {
    await this.ensureSettingsLoaded();
    const dagEnabled = await dagConfig.isEnabled();
    if (dagEnabled) {
      console.log('[StartupRecovery] DAG system enabled, skipping automatic task recovery (tasks remain pending for scheduler dispatch)');
      return;
    }

    this.registerEventListeners();

    try {
      const { default: prisma } = await import('@/lib/db/prisma');

      const scrapePendingGalleries = await prisma.gallery.findMany({
        where: { status: 'scrape_pending' },
        orderBy: { updatedAt: 'asc' },
      });

      for (const gallery of scrapePendingGalleries) {
        if (this.runningScraping >= this.maxScrapingTasks) break;

        const acquired = await this.acquireScrapingSlot('gallery', gallery.id);
        if (acquired) {
          const { getGalleryProvider, scrapeGalleryAsync } = await import('@/lib/tasks/gallery-handler');
          const provider = getGalleryProvider(gallery.sourceUrl);

          if (provider) {
            await prisma.gallery.update({
              where: { id: gallery.id },
              data: { status: 'scraping' },
            });
            scrapeGalleryAsync(gallery.id, gallery.sourceUrl, provider).catch((err: unknown) => {
              console.error(`[StartupRecovery] scrape_pending gallery #${gallery.id} scraping failed:`, err);
            });
          } else {
            this.releaseScrapingSlot('gallery', gallery.id);
          }
        }
      }

      const downloadPendingGalleries = await prisma.gallery.findMany({
        where: { status: 'download_pending' },
        orderBy: { updatedAt: 'asc' },
      });

      for (const gallery of downloadPendingGalleries) {
        if (this.runningNormal >= this.maxConcurrentTasks) break;

        const acquired = await this.acquireSlot('gallery', gallery.id);
        if (acquired) {
          await prisma.gallery.update({
            where: { id: gallery.id },
            data: { status: 'downloading' },
          });
          const { getGalleryDownloader } = await import('@/lib/downloader/gallery');
          getGalleryDownloader()
            .downloadGallery(gallery.id)
            .catch((err: unknown) => {
              console.error(`[StartupRecovery] download_pending gallery #${gallery.id} download failed:`, err);
            });
        }
      }

      const recoveredCount = scrapePendingGalleries.length + downloadPendingGalleries.length;
      if (recoveredCount > 0) {
        console.log(
          logT('log.taskQueue.startupRecovery', { count: recoveredCount }),
        );
      }
    } catch (err) {
      console.error('[StartupRecovery] Startup recovery failed:', err);
    }
  }

  getDownloadConcurrency(): { tsSegmentConcurrent: number; galleryImageConcurrent: number } {
    return {
      tsSegmentConcurrent: this.tsSegmentConcurrent,
      galleryImageConcurrent: this.galleryImageConcurrent,
    };
  }

  /**
   * Update concurrency limit settings.
   *
   * After updating, immediately attempts to start queued tasks that may now
   * be executable due to the raised limits.
   *
   * @param maxConcurrent - Concurrency limit for normal tasks
   * @param maxSniffConcurrent - Concurrency limit for sniff tasks
   * @param tsSegmentConcurrent - Concurrency limit for TS segment downloads
   * @param galleryImageConcurrent - Concurrency limit for gallery image downloads
   */
  async updateSettings(
    maxConcurrent: number,
    maxSniffConcurrent: number,
    tsSegmentConcurrent?: number,
    galleryImageConcurrent?: number,
    maxScrapingTasks?: number,
  ): Promise<void> {
    this.maxConcurrentTasks = Math.max(1, maxConcurrent);
    this.maxConcurrentSniffTasks = Math.max(1, maxSniffConcurrent);
    if (tsSegmentConcurrent !== undefined) {
      this.tsSegmentConcurrent = Math.max(1, tsSegmentConcurrent);
    }
    if (galleryImageConcurrent !== undefined) {
      this.galleryImageConcurrent = Math.max(1, galleryImageConcurrent);
    }
    if (maxScrapingTasks !== undefined) {
      this.maxScrapingTasks = Math.max(1, maxScrapingTasks);
    }

    await Promise.all([
      prisma.appConfig.upsert({
        where: { key: CONFIG_KEY_MAX_CONCURRENT },
        create: { key: CONFIG_KEY_MAX_CONCURRENT, value: String(this.maxConcurrentTasks) },
        update: { value: String(this.maxConcurrentTasks) },
      }),
      prisma.appConfig.upsert({
        where: { key: CONFIG_KEY_SNIFF_MAX_CONCURRENT },
        create: { key: CONFIG_KEY_SNIFF_MAX_CONCURRENT, value: String(this.maxConcurrentSniffTasks) },
        update: { value: String(this.maxConcurrentSniffTasks) },
      }),
      prisma.appConfig.upsert({
        where: { key: CONFIG_KEY_TS_SEG_CONCURRENT },
        create: { key: CONFIG_KEY_TS_SEG_CONCURRENT, value: String(this.tsSegmentConcurrent) },
        update: { value: String(this.tsSegmentConcurrent) },
      }),
      prisma.appConfig.upsert({
        where: { key: CONFIG_KEY_GALLERY_IMG_CONCURRENT },
        create: { key: CONFIG_KEY_GALLERY_IMG_CONCURRENT, value: String(this.galleryImageConcurrent) },
        update: { value: String(this.galleryImageConcurrent) },
      }),
      prisma.appConfig.upsert({
        where: { key: CONFIG_KEY_MAX_SCRAPING },
        create: { key: CONFIG_KEY_MAX_SCRAPING, value: String(this.maxScrapingTasks) },
        update: { value: String(this.maxScrapingTasks) },
      }),
    ]);

    console.log(
      logT('log.taskQueue.configUpdated', {
        maxConcurrent: this.maxConcurrentTasks,
        maxScraping: this.maxScrapingTasks,
        maxSniff: this.maxConcurrentSniffTasks,
        tsSegment: this.tsSegmentConcurrent,
        galleryImage: this.galleryImageConcurrent,
      }),
    );

    this.tryStartNext();
    this.tryStartNextScraping();
  }

  getStats(): TaskQueueStats {
    return {
      runningNormal: this.runningNormal,
      runningSniff: this.runningSniff,
      runningScraping: this.runningScraping,
      queueLength: this.pendingAcquires.length,
      maxConcurrentTasks: this.maxConcurrentTasks,
      maxConcurrentSniffTasks: this.maxConcurrentSniffTasks,
      maxScrapingTasks: this.maxScrapingTasks,
      tsSegmentConcurrent: this.tsSegmentConcurrent,
      galleryImageConcurrent: this.galleryImageConcurrent,
      queueItems: this.pendingAcquires.map((a) => ({
        taskType: a.taskType,
        taskId: a.taskId,
      })),
    };
  }

  reset(): void {
    this.runningNormal = 0;
    this.runningSniff = 0;
    this.runningScraping = 0;
    this.activeSlots.clear();
    this.activeScrapingSlots.clear();
    for (const acquire of this.pendingAcquires) {
      if (acquire.timeoutTimer) clearTimeout(acquire.timeoutTimer);
      acquire.resolve(false);
    }
    for (const acquire of this.pendingScrapingAcquires) {
      if (acquire.timeoutTimer) clearTimeout(acquire.timeoutTimer);
      acquire.resolve(false);
    }
    this.pendingAcquires = [];
    this.pendingScrapingAcquires = [];
    if (this.downloadDebounceTimer) {
      clearTimeout(this.downloadDebounceTimer);
      this.downloadDebounceTimer = null;
    }
    if (this.scrapeDebounceTimer) {
      clearTimeout(this.scrapeDebounceTimer);
      this.scrapeDebounceTimer = null;
    }
    console.warn(logT('log.taskQueue.resetWarn'));
  }
}

export const taskQueueManager = getOrCreateGlobal(
  '__puchipix_task_queue_manager__',
  () => new TaskQueueManager(),
);
