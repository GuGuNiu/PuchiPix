import { eventBus } from './event-bus';
import { getOrCreateGlobal } from './global-singleton';
import prisma from '@/lib/db/prisma';
import { logT } from '@/lib/i18n/server';

export type QueueTaskType = 'video' | 'gallery' | 'sniff';

const CONFIG_KEY_MAX_CONCURRENT = 'task_max_concurrent';
const CONFIG_KEY_SNIFF_MAX_CONCURRENT = 'sniff_max_concurrent';
const CONFIG_KEY_TS_SEGMENT_CONCURRENT = 'ts_segment_concurrent';
const CONFIG_KEY_GALLERY_IMAGE_CONCURRENT = 'gallery_image_concurrent';
const CONFIG_KEY_MAX_SCRAPING = 'task_max_scraping';

const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_SNIFF_MAX_CONCURRENT = 1;
const DEFAULT_TS_SEGMENT_CONCURRENT = 50;
const DEFAULT_GALLERY_IMAGE_CONCURRENT = 5;
const DEFAULT_MAX_SCRAPING = 5;

interface PendingAcquire {
  taskType: QueueTaskType;
  taskId: number;
  resolve: (acquired: boolean) => void;
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
  private tsSegmentConcurrent = DEFAULT_TS_SEGMENT_CONCURRENT;
  private galleryImageConcurrent = DEFAULT_GALLERY_IMAGE_CONCURRENT;
  private pendingAcquires: PendingAcquire[] = [];
  private pendingScrapingAcquires: PendingAcquire[] = [];
  /** 键格式为 `${taskType}-${taskId}` */
  private activeSlots = new Set<string>();
  /** 正在识别中的任务键集合 */
  private activeScrapingSlots = new Set<string>();
  private settingsLoaded = false;
  private listenersRegistered = false;

  /**
   * 从数据库加载配置，若不存在则使用默认值并预写入数据库
   */
  private async ensureSettingsLoaded(): Promise<void> {
    if (this.settingsLoaded) return;
    this.settingsLoaded = true;
    try {
      const configs = await prisma.appConfig.findMany({
        where: {
          key: { in: [CONFIG_KEY_MAX_CONCURRENT, CONFIG_KEY_SNIFF_MAX_CONCURRENT, CONFIG_KEY_TS_SEGMENT_CONCURRENT, CONFIG_KEY_GALLERY_IMAGE_CONCURRENT, CONFIG_KEY_MAX_SCRAPING] },
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
      this.tsSegmentConcurrent = readOrDefault(CONFIG_KEY_TS_SEGMENT_CONCURRENT, DEFAULT_TS_SEGMENT_CONCURRENT);
      this.galleryImageConcurrent = readOrDefault(CONFIG_KEY_GALLERY_IMAGE_CONCURRENT, DEFAULT_GALLERY_IMAGE_CONCURRENT);
      this.maxScrapingTasks = readOrDefault(CONFIG_KEY_MAX_SCRAPING, DEFAULT_MAX_SCRAPING);

      // 将缺失的默认配置预写入数据库
      if (missingKeys.length > 0) {
        const defaults: Record<string, number> = {
          [CONFIG_KEY_MAX_CONCURRENT]: DEFAULT_MAX_CONCURRENT,
          [CONFIG_KEY_SNIFF_MAX_CONCURRENT]: DEFAULT_SNIFF_MAX_CONCURRENT,
          [CONFIG_KEY_TS_SEGMENT_CONCURRENT]: DEFAULT_TS_SEGMENT_CONCURRENT,
          [CONFIG_KEY_GALLERY_IMAGE_CONCURRENT]: DEFAULT_GALLERY_IMAGE_CONCURRENT,
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
   * 获取槽位（若已满则阻塞等待）
   *
   * @param taskType - 任务类型
   * @param taskId - 任务 ID
   * @returns true=成功获取槽位，false=被取消
   */
  async acquireSlot(taskType: QueueTaskType, taskId: number): Promise<boolean> {
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
      this.pendingAcquires.push({ taskType, taskId, resolve });
    });
  }

  /**
   * 释放槽位
   *
   * 由 EventBus 终态事件自动触发，也可手动调用。
   * 释放后自动尝试启动队列中的下一个任务。
   *
   * @param taskType - 任务类型
   * @param taskId - 任务 ID
   */
  releaseSlot(taskType: QueueTaskType, taskId: number): void {
    const key = `${taskType}-${taskId}`;
    if (!this.activeSlots.has(key)) {
      // 排队中被取消的任务不持有槽位，无需释放
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
  }

  /**
   * 取消排队中的任务（用户取消尚未开始的任务时调用）
   *
   * @param taskType - 任务类型
   * @param taskId - 任务 ID
   * @returns 是否成功取消
   */
  cancelAcquire(taskType: QueueTaskType, taskId: number): boolean {
    const idx = this.pendingAcquires.findIndex(
      (a) => a.taskType === taskType && a.taskId === taskId,
    );
    if (idx >= 0) {
      const [acquire] = this.pendingAcquires.splice(idx, 1);
      acquire.resolve(false);
      console.log(logT('log.taskQueue.pendingCancel', { type: taskType, id: taskId }));
      return true;
    }
    return false;
  }

  /**
   * 尝试启动队列中下一个可执行的任务
   */
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

  /**
   * 获取识别阶段槽位
   *
   * 识别阶段（scraping）有独立的并发上限，与下载阶段分离。
   * 当识别中任务数达到 maxScrapingTasks 时，新任务排队等待。
   *
   * @param taskType - 任务类型
   * @param taskId - 任务 ID
   * @returns true=成功获取槽位，false=被取消
   */
  async acquireScrapingSlot(taskType: QueueTaskType, taskId: number): Promise<boolean> {
    await this.ensureSettingsLoaded();

    const key = `${taskType}-${taskId}`;
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
      this.pendingScrapingAcquires.push({ taskType, taskId, resolve });
    });
  }

  /**
   * 释放识别阶段槽位
   *
   * 识别完成后调用，释放槽位并启动队列中下一个等待识别的任务。
   *
   * @param taskType - 任务类型
   * @param taskId - 任务 ID
   */
  releaseScrapingSlot(taskType: QueueTaskType, taskId: number): void {
    const key = `${taskType}-${taskId}`;
    if (!this.activeScrapingSlots.has(key)) {
      return;
    }

    this.activeScrapingSlots.delete(key);
    this.runningScraping = Math.max(0, this.runningScraping - 1);

    console.log(
      logT('log.taskQueue.scrapingReleased', { key, scraping: this.runningScraping, maxScraping: this.maxScrapingTasks }),
    );

    this.tryStartNextScraping();
  }

  /**
   * 取消排队中的识别任务
   */
  cancelScrapingAcquire(taskType: QueueTaskType, taskId: number): boolean {
    const idx = this.pendingScrapingAcquires.findIndex(
      (a) => a.taskType === taskType && a.taskId === taskId,
    );
    if (idx >= 0) {
      const [acquire] = this.pendingScrapingAcquires.splice(idx, 1);
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
      const key = `${acquire.taskType}-${acquire.taskId}`;
      this.activeScrapingSlots.add(key);
      this.runningScraping++;

      console.log(
        logT('log.taskQueue.scrapingGranted', { key, scraping: this.runningScraping, maxScraping: this.maxScrapingTasks }),
      );
      acquire.resolve(true);
    }
  }

  /**
   * 获取下载级并发配置（同步读取，已加载的配置值）
   */
  getDownloadConcurrency(): { tsSegmentConcurrent: number; galleryImageConcurrent: number } {
    return {
      tsSegmentConcurrent: this.tsSegmentConcurrent,
      galleryImageConcurrent: this.galleryImageConcurrent,
    };
  }

  /**
   * 更新并发上限设置
   *
   * 更新后立即尝试启动队列中可能因上限提高而可执行的任务。
   *
   * @param maxConcurrent - 普通任务并发上限
   * @param maxSniffConcurrent - 嗅探任务并发上限
   * @param tsSegmentConcurrent - TS 分片下载并发上限
   * @param galleryImageConcurrent - 图库图片下载并发上限
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
        where: { key: CONFIG_KEY_TS_SEGMENT_CONCURRENT },
        create: { key: CONFIG_KEY_TS_SEGMENT_CONCURRENT, value: String(this.tsSegmentConcurrent) },
        update: { value: String(this.tsSegmentConcurrent) },
      }),
      prisma.appConfig.upsert({
        where: { key: CONFIG_KEY_GALLERY_IMAGE_CONCURRENT },
        create: { key: CONFIG_KEY_GALLERY_IMAGE_CONCURRENT, value: String(this.galleryImageConcurrent) },
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

  /** 仅用于异常恢复，会丢弃所有排队中的任务 */
  reset(): void {
    this.runningNormal = 0;
    this.runningSniff = 0;
    this.runningScraping = 0;
    this.activeSlots.clear();
    this.activeScrapingSlots.clear();
    for (const acquire of this.pendingAcquires) {
      acquire.resolve(false);
    }
    for (const acquire of this.pendingScrapingAcquires) {
      acquire.resolve(false);
    }
    this.pendingAcquires = [];
    this.pendingScrapingAcquires = [];
    console.warn(logT('log.taskQueue.resetWarn'));
  }
}

/**
 * HMR 安全的全局单例导出
 */
export const taskQueueManager = getOrCreateGlobal(
  '__puchipix_task_queue_manager__',
  () => new TaskQueueManager(),
);
