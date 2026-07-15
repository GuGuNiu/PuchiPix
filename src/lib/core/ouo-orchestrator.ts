import {
  type BaseTask,
  type BaseTaskStatus,
  OrchestratorBase,
  type OrchestratorStatus,
} from './orchestrator-base';
import { eventBus } from './event-bus';
import { getOrCreateGlobal } from './global-singleton';
import type { ZipDownloadResult } from '@/lib/downloader/zip-downloader';


export type OuoTaskStatus = BaseTaskStatus;

export interface OuoTask extends BaseTask {
  /** 图库 ID */
  galleryId: number;
  /** ouo.io 短链接 URL */
  ouoUrl: string;
  /** 手动传入的下载 URL（覆盖数据库中的 URL） */
  manualUrl?: string;
  /** 下载结果 */
  result?: ZipDownloadResult;
}

export interface OuoOrchestratorStatus extends OrchestratorStatus {
  /** 当前正在处理的任务 */
  currentTask: {
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    retryCount: number;
    startedAt: number;
  } | null;
  /** 队列中所有任务的概要 */
  queue: Array<{
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    enqueuedAt: number;
    retryCount: number;
  }>;
}


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

  // ─── 公共 API（OUO 特有签名） ───

  /**
   * 将 OUO 下载任务加入队列
   *
   * 如果队列中已存在相同 galleryId 的待处理任务，则更新其 URL 而非重复入队。
   */
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

  /**
   * 批量入队
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
      this.enqueueOuo(t.galleryId, t.ouoUrl, t.manualUrl, t.maxRetries);
      count++;
    }
    return count;
  }

  /**
   * 获取编排器状态（包含 OUO 特有字段）
   */
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

  // ─── 抽象方法实现 ───

  /** 处理单个 OUO 任务 — 调用 ZIP 下载器 */
  protected async processTask(task: OuoTask): Promise<boolean> {
    // 延迟导入避免循环依赖
    const { downloadAndExtractZip } = await import('@/lib/downloader/zip-downloader');

    const result = await downloadAndExtractZip(task.galleryId, task.manualUrl);
    task.result = result;

    if (result.success) {
      return true;
    }

    task.error = result.error || '下载失败';
    return false;
  }

  /** 获取任务唯一标识 */
  protected getTaskId(task: OuoTask): string | number {
    return task.galleryId;
  }

  /** 判断两个任务是否为同一任务 */
  protected isSameTask(a: OuoTask, b: OuoTask): boolean {
    return a.galleryId === b.galleryId;
  }

  // ─── 事件发射 ───

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
    });
  }
}


const OUO_ORCHESTRATOR_KEY = '__puchipix_ouo_orchestrator__';

/**
 * HMR 安全的全局单例获取。
 */
export function getOuoOrchestrator(): OuoTaskOrchestrator {
  return getOrCreateGlobal(OUO_ORCHESTRATOR_KEY, () => new OuoTaskOrchestrator());
}
