/**
 * 模块：大批量任务智能调度器
 *
 * 为大批量爬取/下载任务提供智能调度策略，避免流量被站点识别：
 *
 * 调度策略：
 * - 短周期：每处理 BATCH_SHORT_CYCLE 个任务后，随机休息 10~30 秒
 * - 长周期：累计处理 BATCH_LONG_CYCLE 个任务后，随机休息 20~40 分钟
 * - 任务间：每个任务之间随机间隔 5~15 秒
 * - 所有间隔均为随机抖动，无任何固定模式
 *
 * 使用方式：
 *   const scheduler = new BatchScheduler();
 *   for (const url of urls) {
 *     await scheduler.waitIfNeeded();
 *     await processUrl(url);
 *     scheduler.markCompleted();
 *   }
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 */

import {
  sleep,
  randomDelay,
  BATCH_SHORT_CYCLE,
  BATCH_SHORT_REST_MIN,
  BATCH_SHORT_REST_MAX,
  BATCH_LONG_CYCLE,
  BATCH_LONG_REST_MIN,
  BATCH_LONG_REST_MAX,
  BATCH_TASK_DELAY_MIN,
  BATCH_TASK_DELAY_MAX,
} from './anti-crawler';

export interface BatchSchedulerOptions {
  /** 短周期任务数（默认 5） */
  shortCycle?: number;
  /** 短周期休息最小毫秒 */
  shortRestMin?: number;
  /** 短周期休息最大毫秒 */
  shortRestMax?: number;
  /** 长周期任务数（默认 15） */
  longCycle?: number;
  /** 长周期休息最小毫秒 */
  longRestMin?: number;
  /** 长周期休息最大毫秒 */
  longRestMax?: number;
  /** 任务间最小间隔毫秒 */
  taskDelayMin?: number;
  /** 任务间最大间隔毫秒 */
  taskDelayMax?: number;
  /** 日志回调 */
  onLog?: (message: string) => void;
}

/**
 * 大批量任务智能调度器
 *
 * @date 2026-07-11
 */
export class BatchScheduler {
  private processedCount = 0;
  private totalCount = 0;
  private readonly shortCycle: number;
  private readonly shortRestMin: number;
  private readonly shortRestMax: number;
  private readonly longCycle: number;
  private readonly longRestMin: number;
  private readonly longRestMax: number;
  private readonly taskDelayMin: number;
  private readonly taskDelayMax: number;
  private readonly onLog?: (message: string) => void;

  constructor(options?: BatchSchedulerOptions) {
    this.shortCycle = options?.shortCycle ?? BATCH_SHORT_CYCLE;
    this.shortRestMin = options?.shortRestMin ?? BATCH_SHORT_REST_MIN;
    this.shortRestMax = options?.shortRestMax ?? BATCH_SHORT_REST_MAX;
    this.longCycle = options?.longCycle ?? BATCH_LONG_CYCLE;
    this.longRestMin = options?.longRestMin ?? BATCH_LONG_REST_MIN;
    this.longRestMax = options?.longRestMax ?? BATCH_LONG_REST_MAX;
    this.taskDelayMin = options?.taskDelayMin ?? BATCH_TASK_DELAY_MIN;
    this.taskDelayMax = options?.taskDelayMax ?? BATCH_TASK_DELAY_MAX;
    this.onLog = options?.onLog;
  }

  /**
   * 重置计数器（开始新一批任务时调用）
   */
  reset(): void {
    this.processedCount = 0;
    this.totalCount = 0;
  }

  /**
   * 在任务之间等待（基础间隔）
   *
   * 每个任务执行后调用，等待随机 5~15 秒。
   */
  async interTaskDelay(): Promise<void> {
    const delay = randomDelay(this.taskDelayMin, this.taskDelayMax);
    this.log(`任务间隔 ${(delay / 1000).toFixed(1)}s`);
    await sleep(delay);
  }

  /**
   * 检查是否需要休息，如需要则等待
   *
   * 在每个任务开始前调用：
   * - 短周期检查：每 shortCycle 个任务休息 10~30 秒
   * - 长周期检查：每 longCycle 个任务休息 20~40 分钟
   *
   * @date 2026-07-11
   */
  async waitIfNeeded(): Promise<void> {
    if (this.processedCount === 0) return;

    // 长周期检查
    if (this.processedCount > 0 && this.processedCount % this.longCycle === 0) {
      const restTime = randomDelay(this.longRestMin, this.longRestMax);
      const minutes = (restTime / 60_000).toFixed(1);
      this.log(`长周期休息 ${minutes} 分钟（已完成 ${this.processedCount} 个任务）`);
      await sleep(restTime);
      return;
    }

    // 短周期检查
    if (this.processedCount > 0 && this.processedCount % this.shortCycle === 0) {
      const restTime = randomDelay(this.shortRestMin, this.shortRestMax);
      const seconds = (restTime / 1000).toFixed(1);
      this.log(`短周期休息 ${seconds} 秒（已完成 ${this.processedCount} 个任务）`);
      await sleep(restTime);
      return;
    }

    // 普通任务间间隔
    await this.interTaskDelay();
  }

  /**
   * 标记一个任务已完成
   */
  markCompleted(): void {
    this.processedCount++;
    this.totalCount++;
  }

  /**
   * 获取当前已处理任务数
   */
  getProcessedCount(): number {
    return this.processedCount;
  }

  /**
   * 获取总处理数
   */
  getTotalCount(): number {
    return this.totalCount;
  }

  private log(message: string): void {
    if (this.onLog) {
      this.onLog(message);
    } else {
      console.log(`[BatchScheduler] ${message}`);
    }
  }
}

/**
 * 批量处理 URL 列表的辅助函数
 *
 * 自动在任务间插入随机间隔和周期性休息。
 *
 * @param urls - URL 列表
 * @param processor - 单个 URL 的处理函数
 * @param options - 调度器选项
 * @returns 每个 URL 的处理结果
 *
 * @date 2026-07-11
 */
export async function batchProcess<T>(
  urls: string[],
  processor: (url: string, index: number) => Promise<T>,
  options?: BatchSchedulerOptions,
): Promise<T[]> {
  const scheduler = new BatchScheduler(options);
  const results: T[] = [];

  for (let i = 0; i < urls.length; i++) {
    await scheduler.waitIfNeeded();

    try {
      const result = await processor(urls[i], i);
      results.push(result);
    } catch (err) {
      console.error(`[BatchProcess] URL ${urls[i]} 处理失败:`, err);
      results.push(null as T);
    }

    scheduler.markCompleted();
  }

  return results;
}
