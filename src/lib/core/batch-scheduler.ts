import { SchedulerStrategy, type SchedulerStrategyOptions } from './scheduler-strategy';

// Re-export for backward compatibility
export interface BatchSchedulerOptions extends SchedulerStrategyOptions {
  /** 日志回调 */
  onLog?: (message: string) => void;
}

/**
 * 大批量任务智能调度器（v2 — 委托 SchedulerStrategy）
 *
 * 保留原有 API 不变，内部委托 SchedulerStrategy 实现调度逻辑。
 *
 */
export class BatchScheduler {
  private readonly scheduler: SchedulerStrategy;
  private readonly onLog?: (message: string) => void;

  constructor(options?: BatchSchedulerOptions) {
    this.onLog = options?.onLog;
    this.scheduler = new SchedulerStrategy({
      ...options,
      logPrefix: '[BatchScheduler]',
    });
  }

  /**
   * 重置计数器（开始新一批任务时调用）
   */
  reset(): void {
    this.scheduler.reset();
  }

  /**
   * 在任务之间等待（基础间隔）
   *
   * 每个任务执行后调用，等待随机 5~15 秒。
   */
  async interTaskDelay(): Promise<void> {
    await this.scheduler.interTaskDelay();
  }

  /**
   * 检查是否需要休息，如需要则等待
   *
   * 在每个任务开始前调用：
   * - 短周期检查：每 shortCycle 个任务休息 10~30 秒
   * - 长周期检查：每 longCycle 个任务休息 20~40 分钟
   *
   * @param checkFn - 可选的检查函数，返回 false 时提前中断等待
   */
  async waitIfNeeded(checkFn?: () => boolean): Promise<void> {
    await this.scheduler.waitIfNeeded(checkFn);
  }

  /**
   * 标记一个任务已完成
   */
  markCompleted(): void {
    this.scheduler.markCompleted();
  }

  /**
   * 获取当前已处理任务数
   */
  getProcessedCount(): number {
    return this.scheduler.getProcessedCount();
  }

  /**
   * 获取总处理数
   */
  getTotalCount(): number {
    return this.scheduler.getTotalCount();
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
