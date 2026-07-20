import {
  type BaseTask,
  type BaseTaskStatus,
  OrchestratorBase,
  type OrchestratorStatus,
} from './orchestrator-base';
import { eventBus } from '../infra/event-bus';
import { getOrCreateGlobal } from '../infra/global-singleton';
import type { ZipDownloadResult } from '@/lib/downloader/zip';

export type OuoTaskStatus = BaseTaskStatus;

export interface OuoTask extends BaseTask {

  galleryId: number;

  ouoUrl: string;

  manualUrl?: string;

  result?: ZipDownloadResult;
}

export interface OuoOrchestratorStatus extends OrchestratorStatus {

  currentTask: {
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    retryCount: number;
    startedAt: number;
  } | null;

  queue: Array<{
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    enqueuedAt: number;
    retryCount: number;
  }>;
}

const OUO_TASK_INTERVAL_MEAN = 60_000;

const OUO_TASK_INTERVAL_STDDEV = 15_000;

const OUO_SHORT_CYCLE = 3;

const OUO_SHORT_REST_MIN = 5 * 60_000;
const OUO_SHORT_REST_MAX = 10 * 60_000;

const OUO_LONG_CYCLE = 8;

const OUO_LONG_REST_MIN = 20 * 60_000;
const OUO_LONG_REST_MAX = 40 * 60_000;

const OUO_RATE_LIMIT_COOLDOWN_MIN = 10 * 60_000;
const OUO_RATE_LIMIT_COOLDOWN_MAX = 15 * 60_000;

const OUO_RETRY_DELAY_MIN = 60_000;
const OUO_RETRY_DELAY_MAX = 120_000;

const DEFAULT_MAX_RETRIES = 2;

const RATE_LIMIT_KEYWORDS = ['shorten', 'IP', '', 'rate limit'];

class OuoTaskOrchestrator extends OrchestratorBase<OuoTask> {
  constructor() {
    super({
      name: 'OuoOrchestrator',
      globalKey: '__puchipix_ouo_orchestrator__',
      defaultMaxRetries: DEFAULT_MAX_RETRIES,
      rateLimitKeywords: RATE_LIMIT_KEYWORDS,
      rateLimitCooldownMin: OUO_RATE_LIMIT_COOLDOWN_MIN,
      rateLimitCooldownMax: OUO_RATE_LIMIT_COOLDOWN_MAX,
      retryDelayMin: OUO_RETRY_DELAY_MIN,
      retryDelayMax: OUO_RETRY_DELAY_MAX,
      schedulerOptions: {
        shortCycle: OUO_SHORT_CYCLE,
        shortRestMin: OUO_SHORT_REST_MIN,
        shortRestMax: OUO_SHORT_REST_MAX,
        longCycle: OUO_LONG_CYCLE,
        longRestMin: OUO_LONG_REST_MIN,
        longRestMax: OUO_LONG_REST_MAX,
        useGaussian: true,
        gaussianMean: OUO_TASK_INTERVAL_MEAN,
        gaussianStdDev: OUO_TASK_INTERVAL_STDDEV,
      },
    });
  }

  enqueueOuo(
    galleryId: number,
    ouoUrl: string,
    manualUrl?: string,
    maxRetries?: number,
  ): number {
    const task: OuoTask = {
      galleryId,
      ouoUrl,
      manualUrl,
      status: 'pending',
      enqueuedAt: Date.now(),
      retryCount: 0,
      maxRetries: maxRetries ?? DEFAULT_MAX_RETRIES,
    };
    return this.enqueue(task);
  }

  enqueueBatch(
    tasks: Array<{
      galleryId: number;
      ouoUrl: string;
      manualUrl?: string;
      maxRetries?: number;
    }>,
  ): number {
    let count = 0;
    let rejected = 0;
    for (const t of tasks) {
      const position = this.enqueueOuo(t.galleryId, t.ouoUrl, t.manualUrl, t.maxRetries);
      if (position === -1) {
        rejected++;

        break;
      }
      count++;
    }
    if (rejected > 0) {
      this.logger.warn(
        `OuoOrchestrator: ${count}/${tasks.length} processed, ${rejected} rejected`,
      );
    }
    return count;
  }

  getStatus(): OuoOrchestratorStatus {
    const base = this.getBaseStatus();
    return {
      ...base,
      currentTask: this.currentTask
        ? {
            galleryId: this.currentTask.galleryId,
            ouoUrl: this.currentTask.ouoUrl,
            status: this.currentTask.status,
            retryCount: this.currentTask.retryCount,
            startedAt: this.currentTask.startedAt!,
          }
        : null,
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

  protected async processTask(task: OuoTask): Promise<boolean> {

    const { downloadAndExtractZip } = await import('@/lib/downloader/zip');

    const result = await downloadAndExtractZip(task.galleryId, task.manualUrl);
    task.result = result;

    if (result.success) {
      return true;
    }

    task.error = result.error || '';
    return false;
  }

  protected getTaskId(task: OuoTask): string | number {
    return task.galleryId;
  }

  protected isSameTask(a: OuoTask, b: OuoTask): boolean {
    return a.galleryId === b.galleryId;
  }

  protected emitTaskQueued(task: OuoTask, position: number): void {
    eventBus.emit('ouo:taskQueued', {
      galleryId: task.galleryId,
      ouoUrl: task.ouoUrl,
      queuePosition: position,
    });
  }

  protected emitTaskStarted(task: OuoTask): void {
    eventBus.emit('ouo:taskStarted', {
      galleryId: task.galleryId,
      ouoUrl: task.ouoUrl,
      processedCount: this.processedCount + 1,
    });
  }

  protected emitTaskCompleted(task: OuoTask): void {
    eventBus.emit('ouo:taskCompleted', {
      galleryId: task.galleryId,
      success: true,
      zipFileName: task.result?.zipFileName,
      contentVerified: task.result?.contentVerified,
    });
  }

  protected emitTaskFailed(task: OuoTask, error: string, willRetry: boolean): void {
    eventBus.emit('ouo:taskFailed', {
      galleryId: task.galleryId,
      error,
      willRetry,
    });
  }

  protected emitRateLimited(task: OuoTask, cooldownMs: number): void {
    eventBus.emit('ouo:rateLimited', {
      galleryId: task.galleryId,
      cooldownMs,
    });
  }

  protected emitCooldown(reason: string, durationMs: number): void {
    eventBus.emit('ouo:cooldown', {
      reason,
      durationMs,
      nextTaskAt: this.nextTaskAt,
    });
  }

  protected emitQueueEmpty(): void {
    eventBus.emit('ouo:queueEmpty', {
      totalProcessed: this.processedCount,
      totalSucceeded: this.succeededCount,
      totalFailed: this.failedCount,
    });
  }

  protected emitStatus(): void {
    const status = this.getBaseStatus();
    eventBus.emit('ouo:orchestratorStatus', {
      running: status.running,
      paused: status.paused,
      queueLength: status.queueLength,
      processedCount: status.processedCount,
      rateLimited: status.rateLimited,
      rejectedEnqueueCount: status.rejectedEnqueueCount,
      maxQueueSize: status.maxQueueSize,
    });
  }
}

const OUO_ORCHESTRATOR_KEY = '__puchipix_ouo_orchestrator__';

export function getOuoOrchestrator(): OuoTaskOrchestrator {
  return getOrCreateGlobal(OUO_ORCHESTRATOR_KEY, () => new OuoTaskOrchestrator());
}
