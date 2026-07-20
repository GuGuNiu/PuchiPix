import { SchedulerStrategy, type SchedulerStrategyOptions } from './scheduler-strategy';
import { loggers } from '../infra/logger';

const logger = loggers.batchScheduler();

// Re-export for backward compatibility
export interface BatchSchedulerOptions extends SchedulerStrategyOptions {
  /** LogCallback */
  onLog?: (message: string) => void;
}


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

  
  reset(): void {
    this.scheduler.reset();
  }

  
  async interTaskDelay(): Promise<void> {
    await this.scheduler.interTaskDelay();
  }

  
  async waitIfNeeded(checkFn?: () => boolean): Promise<void> {
    await this.scheduler.waitIfNeeded(checkFn);
  }

  
  markCompleted(): void {
    this.scheduler.markCompleted();
  }

  
  getProcessedCount(): number {
    return this.scheduler.getProcessedCount();
  }

  
  getTotalCount(): number {
    return this.scheduler.getTotalCount();
  }
}

/**
 *
 *
 * @param urls - URL List
 * @param options - scheduleroption
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
      logger.error(`URL ${urls[i]} processing failed`, { error: err });
      results.push(null as T);
    }

    scheduler.markCompleted();
  }

  return results;
}
