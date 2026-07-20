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
} from '../stealth/anti-crawler';
import { loggers } from '../infra/logger';

const logger = loggers.schedulerStrategy();

export interface SchedulerStrategyOptions {
  shortCycle?: number;
  shortRestMin?: number;
  shortRestMax?: number;
  longCycle?: number;
  longRestMin?: number;
  longRestMax?: number;
  taskDelayMin?: number;
  taskDelayMax?: number;
  useGaussian?: boolean;
  gaussianMean?: number;
  gaussianStdDev?: number;
  logPrefix?: string;
  /** Rest event callback (used by EventBus to emit pause events) */
  onRest?: (reason: string, durationMs: number) => void;
}

/**
 * Scheduler strategy for batch task processing.
 *
 * Supports short-cycle and long-cycle rest periods with configurable delays.
 * Shared by BatchScheduler and OrchestratorBase.
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
   * Reset the processed and total counters.
   */
  reset(): void {
    this.processedCount = 0;
    this.totalCount = 0;
  }

  /**
   * Mark a task as completed.
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
   * Apply inter-task delay.
   * In uniform mode: random [taskDelayMin, taskDelayMax].
   * In Gaussian mode: Gaussian distribution around the mean.
   */
  async interTaskDelay(): Promise<void> {
    let delay: number;
    if (this.useGaussian) {
      delay = gaussianDelay(this.gaussianMean, this.gaussianStdDev);
      const seconds = (delay / 1000).toFixed(0);
      logger.info(`${this.logPrefix} Inter-task delay: ${seconds}s`);
    } else {
      delay = randomDelay(this.taskDelayMin, this.taskDelayMax);
      const seconds = (delay / 1000).toFixed(1);
      logger.info(`${this.logPrefix} Inter-task delay: ${seconds}s`);
    }
    await sleep(delay);
  }

  /**
   * Wait if a rest period is needed (based on cycle counts).
   * Short rest: every shortCycle tasks.
   * Long rest: every longCycle tasks.
   */
  async waitIfNeeded(checkFn?: () => boolean): Promise<void> {
    if (this.processedCount === 0) return;

    if (this.processedCount % this.longCycle === 0) {
      const restMs = randomDelay(this.longRestMin, this.longRestMax);
      const minutes = (restMs / 60_000).toFixed(1);
      const reason = `Long cycle rest: ${minutes} min (${this.processedCount} tasks completed)`;
      logger.info(`${this.logPrefix} ${reason}`);
      this.onRest?.(reason, restMs);
      await this.interruptibleSleep(restMs, checkFn);
      return;
    }

    if (this.processedCount % this.shortCycle === 0) {
      const restMs = randomDelay(this.shortRestMin, this.shortRestMax);
      const seconds = (restMs / 1000).toFixed(1);
      const reason = `Short cycle rest: ${seconds}s (${this.processedCount} tasks completed)`;
      logger.info(`${this.logPrefix} ${reason}`);
      this.onRest?.(reason, restMs);
      await this.interruptibleSleep(restMs, checkFn);
      return;
    }

    if (this.useGaussian) {
      const delay = gaussianDelay(this.gaussianMean, this.gaussianStdDev);
      const seconds = (delay / 1000).toFixed(0);
      logger.info(`${this.logPrefix} Inter-task delay: ${seconds}s`);
      this.onRest?.(`Inter-task delay: ${seconds}s`, delay);
      await this.interruptibleSleep(delay, checkFn);
    } else {
      await this.interTaskDelay();
    }
  }

  /**
   * Sleep for the given duration, but allow early exit via checkFn.
   * If checkFn returns false, immediately return (don't wait for remaining time).
   */
  async interruptibleSleep(
    ms: number,
    checkFn?: () => boolean,
  ): Promise<void> {
    // If no check function, just sleep
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