import {
  sleep,
  randomDelay,
  gaussianDelay,
  BATCH_SHORT_CYCLE,
  BATCH_SHORT_REST_MIN,
  BATCH_SHORT_REST_MAX,
  BATCH_LONG_CYCLE,
  BATCH_LONG_REST_MIN,
  BATCH_LONG_REST_MAX,
  BATCH_TASK_DELAY_MIN,
  BATCH_TASK_DELAY_MAX,
} from './anti-crawler';

export interface SchedulerStrategyOptions {
  /** 短周期任务数（每处理 N 个任务后短休息） */
  shortCycle?: number;
  /** 短周期休息最小毫秒 */
  shortRestMin?: number;
  /** 短周期休息最大毫秒 */
  shortRestMax?: number;
  /** 长周期任务数 */
  longCycle?: number;
  /** 长周期休息最小毫秒 */
  longRestMin?: number;
  /** 长周期休息最大毫秒 */
  longRestMax?: number;
  /** 任务间最小间隔毫秒（uniform 模式） */
  taskDelayMin?: number;
  /** 任务间最大间隔毫秒（uniform 模式） */
  taskDelayMax?: number;
  /** 是否使用高斯分布生成任务间隔 */
  useGaussian?: boolean;
  /** 高斯分布均值毫秒 */
  gaussianMean?: number;
  /** 高斯分布标准差毫秒 */
  gaussianStdDev?: number;
  /** 日志前缀（如 "[OuoOrchestrator]"） */
  logPrefix?: string;
  /** 休息事件回调（用于 EventBus 发射冷却事件） */
  onRest?: (reason: string, durationMs: number) => void;
}

/**
 * 调度策略
 *
 * 负责任务间的时间间隔控制，包括：
 * - 普通任务间间隔
 * - 短周期休息
 * - 长周期休息
 * - 可中断 sleep
 *
 * 被 BatchScheduler 和 OrchestratorBase 共享使用。
 *
 */
export class SchedulerStrategy {
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
  private readonly useGaussian: boolean;
  private readonly gaussianMean: number;
  private readonly gaussianStdDev: number;
  private readonly logPrefix: string;
  private readonly onRest?: (reason: string, durationMs: number) => void;

  constructor(options?: SchedulerStrategyOptions) {
    this.shortCycle = options?.shortCycle ?? BATCH_SHORT_CYCLE;
    this.shortRestMin = options?.shortRestMin ?? BATCH_SHORT_REST_MIN;
    this.shortRestMax = options?.shortRestMax ?? BATCH_SHORT_REST_MAX;
    this.longCycle = options?.longCycle ?? BATCH_LONG_CYCLE;
    this.longRestMin = options?.longRestMin ?? BATCH_LONG_REST_MIN;
    this.longRestMax = options?.longRestMax ?? BATCH_LONG_REST_MAX;
    this.taskDelayMin = options?.taskDelayMin ?? BATCH_TASK_DELAY_MIN;
    this.taskDelayMax = options?.taskDelayMax ?? BATCH_TASK_DELAY_MAX;
    this.useGaussian = options?.useGaussian ?? false;
    this.gaussianMean = options?.gaussianMean ?? 60_000;
    this.gaussianStdDev = options?.gaussianStdDev ?? 15_000;
    this.logPrefix = options?.logPrefix ?? '[Scheduler]';
    this.onRest = options?.onRest;
  }

  /**
   * 重置计数器（开始新一批任务时调用）
   */
  reset(): void {
    this.processedCount = 0;
    this.totalCount = 0;
  }

  /**
   * 标记一个任务已完成
   */
  markCompleted(): void {
    this.processedCount++;
    this.totalCount++;
  }

  getProcessedCount(): number {
    return this.processedCount;
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  /**
   * 基础任务间间隔
   *
   * uniform 模式：随机 [taskDelayMin, taskDelayMax]
   * gaussian 模式：高斯分布 (mean, stdDev)
   */
  async interTaskDelay(): Promise<void> {
    let delay: number;
    if (this.useGaussian) {
      delay = gaussianDelay(this.gaussianMean, this.gaussianStdDev);
      const seconds = (delay / 1000).toFixed(0);
      console.log(`${this.logPrefix} 任务间隔 ${seconds}s`);
    } else {
      delay = randomDelay(this.taskDelayMin, this.taskDelayMax);
      const seconds = (delay / 1000).toFixed(1);
      console.log(`${this.logPrefix} 任务间隔 ${seconds}s`);
    }
    await sleep(delay);
  }

  /**
   * 检查是否需要休息，如需要则等待
   *
   * 优先级：长周期 > 短周期 > 普通间隔
   *
   * @param checkFn - 可选的检查函数，返回 false 时提前中断等待
   */
  async waitIfNeeded(checkFn?: () => boolean): Promise<void> {
    if (this.processedCount === 0) return;

    // 长周期检查
    if (this.processedCount % this.longCycle === 0) {
      const restMs = randomDelay(this.longRestMin, this.longRestMax);
      const minutes = (restMs / 60_000).toFixed(1);
      const reason = `长周期休息 ${minutes} 分钟（已完成 ${this.processedCount} 个任务）`;
      console.log(`${this.logPrefix} ${reason}`);
      this.onRest?.(reason, restMs);
      await this.interruptibleSleep(restMs, checkFn);
      return;
    }

    // 短周期检查
    if (this.processedCount % this.shortCycle === 0) {
      const restMs = randomDelay(this.shortRestMin, this.shortRestMax);
      const seconds = (restMs / 1000).toFixed(1);
      const reason = `短周期休息 ${seconds} 秒（已完成 ${this.processedCount} 个任务）`;
      console.log(`${this.logPrefix} ${reason}`);
      this.onRest?.(reason, restMs);
      await this.interruptibleSleep(restMs, checkFn);
      return;
    }

    // 普通任务间间隔
    if (this.useGaussian) {
      const delay = gaussianDelay(this.gaussianMean, this.gaussianStdDev);
      const seconds = (delay / 1000).toFixed(0);
      console.log(`${this.logPrefix} 任务间隔 ${seconds}s`);
      this.onRest?.(`任务间隔 ${seconds}s`, delay);
      await this.interruptibleSleep(delay, checkFn);
    } else {
      await this.interTaskDelay();
    }
  }

  /**
   * 可中断的 sleep
   *
   * 分段 sleep，每 5 秒检查一次 checkFn。
   * 如果 checkFn 返回 false，立即返回（不等待剩余时间）。
   *
   * @param ms - 总等待毫秒数
   * @param checkFn - 检查函数，返回 false 时中断等待
   */
  async interruptibleSleep(
    ms: number,
    checkFn?: () => boolean,
  ): Promise<void> {
    // 如果没有检查函数，直接 sleep
    if (!checkFn) {
      await sleep(ms);
      return;
    }

    const step = 5000;
    let elapsed = 0;

    while (elapsed < ms) {
      if (!checkFn()) return;
      const remaining = ms - elapsed;
      const sleepMs = Math.min(step, remaining);
      await sleep(sleepMs);
      elapsed += sleepMs;
    }
  }
}
