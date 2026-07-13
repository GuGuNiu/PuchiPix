/**
 * 模块：OUO 任务编排器
 *
 * 专门管理 ouo.io 短链接解析 + ZIP 下载任务的智能调度器。
 *
 * 设计目标：
 * 1. 自动化调度：按队列顺序处理 OUO 下载任务，无需人工干预
 * 2. 反机器人行为：模拟人类浏览模式，任务间随机间隔、周期性长休息
 * 3. IP 限速保护：检测到 ouo.io /shorten 重定向时自动进入冷却期
 * 4. 生命周期管理：通过 LifecycleManager 统一启动和关闭
 * 5. 事件驱动：通过 EventBus 发布实时状态，前端可监控进度
 *
 * 调度策略（比 BatchScheduler 更保守，因 ouo.io IP 限速严格）：
 * - 任务间间隔：30~90 秒（高斯分布，均值 60s）
 * - 短周期：每处理 3 个任务后，休息 5~10 分钟
 * - 长周期：每处理 8 个任务后，休息 20~40 分钟
 * - IP 限速冷却：10~15 分钟（检测到 /shorten 重定向时触发）
 * - 最大重试：每个任务最多重试 2 次（不含首次），重试间隔 60~120 秒
 *
 * @author PuchiPix Team
 * @date 2026-07-12
 */

import { eventBus } from './event-bus';
import {
  sleep,
  gaussianDelay,
  randomDelay,
} from './anti-crawler';
import type { ZipDownloadResult } from '@/lib/downloader/zip-downloader';

// ============================================================
// 类型定义
// ============================================================

export type OuoTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'cancelled';

export interface OuoTask {
  /** 图库 ID */
  galleryId: number;
  /** ouo.io 短链接 URL */
  ouoUrl: string;
  /** 手动传入的下载 URL（覆盖数据库中的 URL） */
  manualUrl?: string;
  /** 任务状态 */
  status: OuoTaskStatus;
  /** 入队时间戳 */
  enqueuedAt: number;
  /** 开始处理时间戳 */
  startedAt?: number;
  /** 完成时间戳 */
  completedAt?: number;
  /** 错误信息 */
  error?: string;
  /** 下载结果 */
  result?: ZipDownloadResult;
  /** 已重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
}

export interface OuoOrchestratorStatus {
  /** 是否正在运行 */
  running: boolean;
  /** 是否暂停 */
  paused: boolean;
  /** 是否处于 IP 限速冷却期 */
  rateLimited: boolean;
  /** 队列长度（待处理任务数） */
  queueLength: number;
  /** 已处理任务总数 */
  processedCount: number;
  /** 成功任务数 */
  succeededCount: number;
  /** 失败任务数 */
  failedCount: number;
  /** 当前正在处理的任务 */
  currentTask: {
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    retryCount: number;
    startedAt: number;
  } | null;
  /** 冷却结束时间（rateLimited 为 true 时有效） */
  cooldownEndsAt: number | null;
  /** 下一个任务预计开始时间 */
  nextTaskAt: number | null;
  /** 队列中所有任务的概要 */
  queue: Array<{
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    enqueuedAt: number;
    retryCount: number;
  }>;
}

// ============================================================
// 调度常量（ouo.io 专用，比通用 BatchScheduler 更保守）
// ============================================================

/** 任务间间隔（高斯分布均值，毫秒） */
const OUO_TASK_INTERVAL_MEAN = 60_000;
/** 任务间间隔（高斯分布标准差，毫秒） */
const OUO_TASK_INTERVAL_STDDEV = 15_000;

/** 短周期：每处理 N 个任务后短休息 */
const OUO_SHORT_CYCLE = 3;
/** 短周期休息时间范围（毫秒，5~10 分钟） */
const OUO_SHORT_REST_MIN = 5 * 60_000;
const OUO_SHORT_REST_MAX = 10 * 60_000;

/** 长周期：每处理 N 个任务后长休息 */
const OUO_LONG_CYCLE = 8;
/** 长周期休息时间范围（毫秒，20~40 分钟） */
const OUO_LONG_REST_MIN = 20 * 60_000;
const OUO_LONG_REST_MAX = 40 * 60_000;

/** IP 限速冷却时间范围（毫秒，10~15 分钟） */
const OUO_RATE_LIMIT_COOLDOWN_MIN = 10 * 60_000;
const OUO_RATE_LIMIT_COOLDOWN_MAX = 15 * 60_000;

/** 任务失败重试间隔范围（毫秒，60~120 秒） */
const OUO_RETRY_DELAY_MIN = 60_000;
const OUO_RETRY_DELAY_MAX = 120_000;

/** 每个任务默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 2;

/** 检测 IP 限速的错误关键词 */
const RATE_LIMIT_KEYWORDS = ['shorten', 'IP 限速', '限速', 'rate limit'];

// ============================================================
// OuoTaskOrchestrator 实现
// ============================================================

class OuoTaskOrchestrator {
  /** 任务队列 */
  private queue: OuoTask[] = [];
  /** 当前正在处理的任务 */
  private currentTask: OuoTask | null = null;
  /** 已处理任务总数 */
  private processedCount = 0;
  /** 成功任务数 */
  private succeededCount = 0;
  /** 失败任务数 */
  private failedCount = 0;
  /** 是否正在运行 */
  private running = false;
  /** 是否暂停 */
  private paused = false;
  /** IP 限速冷却结束时间戳（0 表示未限速） */
  private rateLimitedUntil = 0;
  /** 下一个任务预计开始时间戳 */
  private nextTaskAt = 0;
  /** 处理循环的 AbortController */
  private abortController: AbortController | null = null;
  /** 历史已完成任务记录（最多保留 100 条） */
  private history: OuoTask[] = [];

  /**
   * 将 OUO 下载任务加入队列
   *
   * 如果队列中已存在相同 galleryId 的待处理任务，则更新其 URL 而非重复入队。
   *
   * @param galleryId - 图库 ID
   * @param ouoUrl - ouo.io 短链接 URL
   * @param manualUrl - 手动传入的下载 URL（可选）
   * @param maxRetries - 最大重试次数（默认 2）
   * @returns 队列位置（从 1 开始），如果已存在则返回原位置
   */
  enqueue(
    galleryId: number,
    ouoUrl: string,
    manualUrl?: string,
    maxRetries?: number,
  ): number {
    // 检查是否已在队列中
    const existing = this.queue.find(
      (t) => t.galleryId === galleryId && t.status === 'pending',
    );

    if (existing) {
      existing.ouoUrl = ouoUrl;
      if (manualUrl) existing.manualUrl = manualUrl;
      return this.queue.indexOf(existing) + 1;
    }

    // 检查当前正在处理的任务是否是同一个
    if (this.currentTask?.galleryId === galleryId) {
      return 0;
    }

    const task: OuoTask = {
      galleryId,
      ouoUrl,
      manualUrl,
      status: 'pending',
      enqueuedAt: Date.now(),
      retryCount: 0,
      maxRetries: maxRetries ?? DEFAULT_MAX_RETRIES,
    };

    this.queue.push(task);

    const position = this.queue.length;

    eventBus.emit('ouo:taskQueued', {
      galleryId,
      ouoUrl,
      queuePosition: position,
    });

    console.log(
      `[OuoOrchestrator] 任务入队: gallery #${galleryId}, 位置 ${position}, URL: ${ouoUrl.substring(0, 60)}`,
    );

    // 如果编排器正在运行但处理循环已退出（队列为空时），重新启动
    if (this.running && !this.paused && !this.abortController) {
      this.startProcessingLoop();
    }

    return position;
  }

  /**
   * 批量入队
   *
   * @param tasks - 任务列表
   * @returns 入队数量
   */
  enqueueBatch(
    tasks: Array<{
      galleryId: number;
      ouoUrl: string;
      manualUrl?: string;
      maxRetries?: number;
    }>,
  ): number {
    let count = 0;
    for (const t of tasks) {
      this.enqueue(t.galleryId, t.ouoUrl, t.manualUrl, t.maxRetries);
      count++;
    }
    return count;
  }

  /**
   * 启动编排器
   *
   * 注册到 LifecycleManager 的 init hook 中调用。
   * 启动后自动开始处理队列（如果队列非空）。
   */
  start(): void {
    if (this.running) {
      console.log('[OuoOrchestrator] 已在运行中，跳过');
      return;
    }

    this.running = true;
    this.paused = false;
    console.log('[OuoOrchestrator] 编排器已启动');

    this.emitStatus();

    if (this.queue.length > 0) {
      this.startProcessingLoop();
    }
  }

  /**
   * 停止编排器
   *
   * 注册到 LifecycleManager 的 shutdown hook 中调用。
   * 会等待当前任务完成后退出。
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.abortController?.abort();
    console.log('[OuoOrchestrator] 编排器停止中...');

    // 等待当前任务完成（最多 15 秒，与 server.ts shutdown timeout 一致）
    if (this.currentTask) {
      console.log(
        `[OuoOrchestrator] 等待当前任务 #${this.currentTask.galleryId} 完成...`,
      );
      const waitStart = Date.now();
      while (this.currentTask && Date.now() - waitStart < 15000) {
        await sleep(500);
      }
    }

    // 取消所有待处理任务
    for (const task of this.queue) {
      if (task.status === 'pending') {
        task.status = 'cancelled';
      }
    }

    this.emitStatus();
    console.log('[OuoOrchestrator] 编排器已停止');
  }

  /**
   * 暂停编排器
   *
   * 暂停后不再从队列中取出新任务，但当前正在处理的任务会继续完成。
   */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    console.log('[OuoOrchestrator] 编排器已暂停');
    this.emitStatus();
  }

  /**
   * 恢复编排器
   */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    console.log('[OuoOrchestrator] 编排器已恢复');
    this.emitStatus();

    if (this.queue.length > 0 && !this.abortController) {
      this.startProcessingLoop();
    }
  }

  /**
   * 从队列中移除指定图库的任务
   */
  cancel(galleryId: number): boolean {
    const idx = this.queue.findIndex(
      (t) => t.galleryId === galleryId && t.status === 'pending',
    );
    if (idx >= 0) {
      this.queue[idx].status = 'cancelled';
      this.queue.splice(idx, 1);
      console.log(`[OuoOrchestrator] 任务已取消: gallery #${galleryId}`);
      return true;
    }
    return false;
  }

  /**
   * 清空队列
   */
  clearQueue(): number {
    const count = this.queue.filter((t) => t.status === 'pending').length;
    this.queue = [];
    console.log(`[OuoOrchestrator] 队列已清空（移除 ${count} 个待处理任务）`);
    return count;
  }

  /**
   * 获取编排器状态
   */
  getStatus(): OuoOrchestratorStatus {
    const now = Date.now();
    return {
      running: this.running,
      paused: this.paused,
      rateLimited: this.rateLimitedUntil > now,
      queueLength: this.queue.filter((t) => t.status === 'pending').length,
      processedCount: this.processedCount,
      succeededCount: this.succeededCount,
      failedCount: this.failedCount,
      currentTask: this.currentTask
        ? {
            galleryId: this.currentTask.galleryId,
            ouoUrl: this.currentTask.ouoUrl,
            status: this.currentTask.status,
            retryCount: this.currentTask.retryCount,
            startedAt: this.currentTask.startedAt!,
          }
        : null,
      cooldownEndsAt: this.rateLimitedUntil > now ? this.rateLimitedUntil : null,
      nextTaskAt: this.nextTaskAt > now ? this.nextTaskAt : null,
      queue: this.queue
        .filter((t) => t.status === 'pending')
        .map((t) => ({
          galleryId: t.galleryId,
          ouoUrl: t.ouoUrl,
          status: t.status,
          enqueuedAt: t.enqueuedAt,
          retryCount: t.retryCount,
        })),
    };
  }

  /**
   * 获取历史记录
   */
  getHistory(limit: number = 20): OuoTask[] {
    return this.history.slice(-limit).reverse();
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 启动处理循环
   *
   * 从队列中取出任务依次处理，直到队列空或编排器停止/暂停。
   */
  private startProcessingLoop(): void {
    if (this.abortController) return;

    this.abortController = new AbortController();
    this.processQueue(this.abortController.signal).catch((err) => {
      console.error('[OuoOrchestrator] 处理循环异常:', err);
    });
  }

  /**
   * 处理队列主循环
   *
   * @date 2026-07-12
   */
  private async processQueue(signal: AbortSignal): Promise<void> {
    while (this.running && !signal.aborted) {
      // 暂停时等待恢复
      if (this.paused) {
        await sleep(2000);
        continue;
      }

      // IP 限速冷却期
      const now = Date.now();
      if (this.rateLimitedUntil > now) {
        const waitMs = this.rateLimitedUntil - now;
        console.log(
          `[OuoOrchestrator] IP 限速冷却中，等待 ${Math.ceil(waitMs / 1000)}s...`,
        );
        await sleep(Math.min(waitMs, 5000));
        continue;
      }

      // 取出下一个待处理任务
      const task = this.queue.find((t) => t.status === 'pending');
      if (!task) {
        // 队列为空
        this.abortController = null;
        console.log(
          `[OuoOrchestrator] 队列已空（共处理 ${this.processedCount} 个任务，成功 ${this.succeededCount}，失败 ${this.failedCount}）`,
        );

        eventBus.emit('ouo:queueEmpty', {
          totalProcessed: this.processedCount,
          totalSucceeded: this.succeededCount,
          totalFailed: this.failedCount,
        });

        this.emitStatus();
        return;
      }

      await this.processTask(task, signal);

      // 任务处理完成后，检查是否需要休息
      if (this.running && !signal.aborted && !this.paused) {
        await this.waitBetweenTasks();
      }
    }

    this.abortController = null;
  }

  /**
   * 处理单个 OUO 任务
   *
   * @date 2026-07-12
   */
  private async processTask(task: OuoTask, signal: AbortSignal): Promise<void> {
    task.status = 'processing';
    task.startedAt = Date.now();
    this.currentTask = task;

    console.log(
      `[OuoOrchestrator] 开始处理: gallery #${task.galleryId} (第 ${this.processedCount + 1} 个任务)`,
    );

    eventBus.emit('ouo:taskStarted', {
      galleryId: task.galleryId,
      ouoUrl: task.ouoUrl,
      processedCount: this.processedCount + 1,
    });

    this.emitStatus();

    try {
      // 延迟导入避免循环依赖
      const { downloadAndExtractZip } = await import('@/lib/downloader/zip-downloader');

      const result = await downloadAndExtractZip(task.galleryId, task.manualUrl);

      task.result = result;
      task.completedAt = Date.now();

      if (result.success) {
        task.status = 'completed';
        this.succeededCount++;
        console.log(
          `[OuoOrchestrator] 任务成功: gallery #${task.galleryId}`,
        );

        eventBus.emit('ouo:taskCompleted', {
          galleryId: task.galleryId,
          success: true,
          zipFileName: result.zipFileName,
          contentVerified: result.contentVerified,
        });
      } else {
        // 下载失败，检查是否是 IP 限速
        const errorMsg = result.error || '下载失败';
        const isRateLimited = this.isRateLimitError(errorMsg);

        if (isRateLimited) {
          await this.handleRateLimit(task);
          return;
        }

        // 非限速错误，检查是否需要重试
        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          task.status = 'pending';
          const retryDelay = randomDelay(OUO_RETRY_DELAY_MIN, OUO_RETRY_DELAY_MAX);
          console.log(
            `[OuoOrchestrator] 任务失败，将重试（第 ${task.retryCount} 次）: gallery #${task.galleryId}, 等待 ${(retryDelay / 1000).toFixed(0)}s`,
          );

          eventBus.emit('ouo:taskFailed', {
            galleryId: task.galleryId,
            error: errorMsg,
            willRetry: true,
          });

          this.nextTaskAt = Date.now() + retryDelay;
          await sleep(retryDelay);
          return;
        }

        task.status = 'failed';
        task.error = errorMsg;
        this.failedCount++;
        console.error(
          `[OuoOrchestrator] 任务失败（已耗尽重试）: gallery #${task.galleryId}: ${errorMsg}`,
        );

        eventBus.emit('ouo:taskFailed', {
          galleryId: task.galleryId,
          error: errorMsg,
          willRetry: false,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      task.error = errorMsg;
      task.completedAt = Date.now();

      const isRateLimited = this.isRateLimitError(errorMsg);

      if (isRateLimited) {
        await this.handleRateLimit(task);
        return;
      }

      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = 'pending';
        task.error = undefined;
        const retryDelay = randomDelay(OUO_RETRY_DELAY_MIN, OUO_RETRY_DELAY_MAX);
        console.log(
          `[OuoOrchestrator] 任务异常，将重试（第 ${task.retryCount} 次）: gallery #${task.galleryId}, 等待 ${(retryDelay / 1000).toFixed(0)}s`,
        );

        eventBus.emit('ouo:taskFailed', {
          galleryId: task.galleryId,
          error: errorMsg,
          willRetry: true,
        });

        this.nextTaskAt = Date.now() + retryDelay;
        await sleep(retryDelay);
        return;
      }

      task.status = 'failed';
      this.failedCount++;
      console.error(
        `[OuoOrchestrator] 任务异常（已耗尽重试）: gallery #${task.galleryId}: ${errorMsg}`,
      );

      eventBus.emit('ouo:taskFailed', {
        galleryId: task.galleryId,
        error: errorMsg,
        willRetry: false,
      });
    } finally {
      if (task.status !== 'rate_limited') {
        this.processedCount++;
      }
      this.currentTask = null;

      // 从队列中移除已完成/已失败的任务
      const idx = this.queue.indexOf(task);
      if (idx >= 0) {
        if (task.status === 'completed' || task.status === 'failed') {
          this.queue.splice(idx, 1);
          // 添加到历史记录
          this.history.push({ ...task });
          if (this.history.length > 100) {
            this.history.shift();
          }
        }
      }

      this.emitStatus();
    }
  }

  /**
   * 处理 IP 限速
   *
   * 检测到 ouo.io /shorten 重定向时，进入 10~15 分钟冷却期。
   * 当前任务标记为 rate_limited，冷却结束后重新入队。
   *
   * @date 2026-07-12
   */
  private async handleRateLimit(task: OuoTask): Promise<void> {
    const cooldownMs = randomDelay(
      OUO_RATE_LIMIT_COOLDOWN_MIN,
      OUO_RATE_LIMIT_COOLDOWN_MAX,
    );
    this.rateLimitedUntil = Date.now() + cooldownMs;
    task.status = 'rate_limited';
    task.error = 'ouo.io IP 限速';

    console.warn(
      `[OuoOrchestrator] IP 限速触发: gallery #${task.galleryId}, 冷却 ${Math.ceil(cooldownMs / 60_000)} 分钟`,
    );

    eventBus.emit('ouo:rateLimited', {
      galleryId: task.galleryId,
      cooldownMs,
    });

    eventBus.emit('ouo:cooldown', {
      reason: 'IP 限速',
      durationMs: cooldownMs,
      nextTaskAt: this.rateLimitedUntil,
    });

    // 冷却结束后，将任务重新标记为 pending（使用可中断 sleep 以响应暂停/停止）
    await this.interruptibleSleep(cooldownMs);
    this.rateLimitedUntil = 0;

    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      task.status = 'pending';
      task.error = undefined;
      console.log(
        `[OuoOrchestrator] 冷却结束，任务重新入队: gallery #${task.galleryId} (重试第 ${task.retryCount} 次)`,
      );
    } else {
      task.status = 'failed';
      task.error = 'ouo.io IP 限速（已耗尽重试）';
      this.failedCount++;
      console.error(
        `[OuoOrchestrator] 冷却结束但已耗尽重试: gallery #${task.galleryId}`,
      );
    }
  }

  /**
   * 任务间智能等待
   *
   * 调度策略：
   * - 长周期：每 OUO_LONG_CYCLE 个任务后休息 20~40 分钟
   * - 短周期：每 OUO_SHORT_CYCLE 个任务后休息 5~10 分钟
   * - 普通间隔：高斯分布 30~90 秒
   *
   * @date 2026-07-12
   */
  private async waitBetweenTasks(): Promise<void> {
    // 长周期检查
    if (this.processedCount > 0 && this.processedCount % OUO_LONG_CYCLE === 0) {
      const restMs = randomDelay(OUO_LONG_REST_MIN, OUO_LONG_REST_MAX);
      const minutes = (restMs / 60_000).toFixed(1);
      console.log(
        `[OuoOrchestrator] 长周期休息 ${minutes} 分钟（已完成 ${this.processedCount} 个任务）`,
      );

      this.nextTaskAt = Date.now() + restMs;

      eventBus.emit('ouo:cooldown', {
        reason: `长周期休息（已完成 ${this.processedCount} 个任务）`,
        durationMs: restMs,
        nextTaskAt: this.nextTaskAt,
      });

      // 分段 sleep 以支持快速停止
      await this.interruptibleSleep(restMs);
      return;
    }

    // 短周期检查
    if (this.processedCount > 0 && this.processedCount % OUO_SHORT_CYCLE === 0) {
      const restMs = randomDelay(OUO_SHORT_REST_MIN, OUO_SHORT_REST_MAX);
      const minutes = (restMs / 60_000).toFixed(1);
      console.log(
        `[OuoOrchestrator] 短周期休息 ${minutes} 分钟（已完成 ${this.processedCount} 个任务）`,
      );

      this.nextTaskAt = Date.now() + restMs;

      eventBus.emit('ouo:cooldown', {
        reason: `短周期休息（已完成 ${this.processedCount} 个任务）`,
        durationMs: restMs,
        nextTaskAt: this.nextTaskAt,
      });

      await this.interruptibleSleep(restMs);
      return;
    }

    // 普通任务间间隔（高斯分布）
    const intervalMs = gaussianDelay(OUO_TASK_INTERVAL_MEAN, OUO_TASK_INTERVAL_STDDEV);
    const seconds = (intervalMs / 1000).toFixed(0);
    console.log(`[OuoOrchestrator] 任务间隔 ${seconds}s`);

    this.nextTaskAt = Date.now() + intervalMs;
    await this.interruptibleSleep(intervalMs);
  }

  /**
   * 可中断的 sleep
   *
   * 分段 sleep，每 5 秒检查一次是否需要停止。
   */
  private async interruptibleSleep(ms: number): Promise<void> {
    const elapsed = { value: 0 };
    const step = 5000;

    while (elapsed.value < ms) {
      if (!this.running || this.abortController?.signal.aborted) return;
      if (this.paused) {
        await sleep(2000);
        continue;
      }

      const remaining = ms - elapsed.value;
      const sleepMs = Math.min(step, remaining);
      await sleep(sleepMs);
      elapsed.value += sleepMs;
    }
  }

  /**
   * 检测错误信息是否表示 IP 限速
   */
  private isRateLimitError(errorMsg: string): boolean {
    const lower = errorMsg.toLowerCase();
    return RATE_LIMIT_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  }

  /**
   * 发布编排器状态事件
   */
  private emitStatus(): void {
    const status = this.getStatus();
    eventBus.emit('ouo:orchestratorStatus', {
      running: status.running,
      paused: status.paused,
      queueLength: status.queueLength,
      processedCount: status.processedCount,
      rateLimited: status.rateLimited,
    });
  }
}

// ============================================================
// 单例导出
// ============================================================

const OUO_ORCHESTRATOR_KEY = '__ouoOrchestratorInstance__';

export function getOuoOrchestrator(): OuoTaskOrchestrator {
  const g = globalThis as Record<string, unknown>;
  if (!g[OUO_ORCHESTRATOR_KEY]) {
    g[OUO_ORCHESTRATOR_KEY] = new OuoTaskOrchestrator();
  }
  return g[OUO_ORCHESTRATOR_KEY] as OuoTaskOrchestrator;
}
