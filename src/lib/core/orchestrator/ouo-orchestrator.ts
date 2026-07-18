﻿import {
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
  /** 鍥惧簱 ID */
  galleryId: number;
  /** ouo.io 鐭摼鎺?URL */
  ouoUrl: string;
  /** 鎵嬪姩浼犲叆鐨勪笅杞?URL锛堣鐩栨暟鎹簱涓殑 URL锛?*/
  manualUrl?: string;
  /** 涓嬭浇缁撴灉 */
  result?: ZipDownloadResult;
}

export interface OuoOrchestratorStatus extends OrchestratorStatus {
  /** 褰撳墠姝ｅ湪澶勭悊鐨勪换鍔?*/
  currentTask: {
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    retryCount: number;
    startedAt: number;
  } | null;
  /** 闃熷垪涓墍鏈変换鍔＄殑姒傝 */
  queue: Array<{
    galleryId: number;
    ouoUrl: string;
    status: OuoTaskStatus;
    enqueuedAt: number;
    retryCount: number;
  }>;
}


/** 浠诲姟闂撮棿闅旓紙楂樻柉鍒嗗竷鍧囧€硷紝姣锛?*/
const OUO_TASK_INTERVAL_MEAN = 60_000;
/** 浠诲姟闂撮棿闅旓紙楂樻柉鍒嗗竷鏍囧噯宸紝姣锛?*/
const OUO_TASK_INTERVAL_STDDEV = 15_000;

/** 鐭懆鏈燂細姣忓鐞?N 涓换鍔″悗鐭紤鎭?*/
const OUO_SHORT_CYCLE = 3;
/** 鐭懆鏈熶紤鎭椂闂磋寖鍥达紙姣锛?~10 鍒嗛挓锛?*/
const OUO_SHORT_REST_MIN = 5 * 60_000;
const OUO_SHORT_REST_MAX = 10 * 60_000;

/** 闀垮懆鏈燂細姣忓鐞?N 涓换鍔″悗闀夸紤鎭?*/
const OUO_LONG_CYCLE = 8;
/** 闀垮懆鏈熶紤鎭椂闂磋寖鍥达紙姣锛?0~40 鍒嗛挓锛?*/
const OUO_LONG_REST_MIN = 20 * 60_000;
const OUO_LONG_REST_MAX = 40 * 60_000;

/** IP 闄愰€熷喎鍗存椂闂磋寖鍥达紙姣锛?0~15 鍒嗛挓锛?*/
const OUO_RATE_LIMIT_COOLDOWN_MIN = 10 * 60_000;
const OUO_RATE_LIMIT_COOLDOWN_MAX = 15 * 60_000;

/** 浠诲姟澶辫触閲嶈瘯闂撮殧鑼冨洿锛堟绉掞紝60~120 绉掞級 */
const OUO_RETRY_DELAY_MIN = 60_000;
const OUO_RETRY_DELAY_MAX = 120_000;

/** 姣忎釜浠诲姟榛樿鏈€澶ч噸璇曟鏁?*/
const DEFAULT_MAX_RETRIES = 2;

/** 妫€娴?IP 闄愰€熺殑閿欒鍏抽敭璇?*/
const RATE_LIMIT_KEYWORDS = ['shorten', 'IP 闄愰€?, '闄愰€?, 'rate limit'];


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

  // 鈹€鈹€鈹€ 鍏叡 API锛圤UO 鐗规湁绛惧悕锛?鈹€鈹€鈹€

  /**
   * 灏?OUO 涓嬭浇浠诲姟鍔犲叆闃熷垪
   *
   * 濡傛灉闃熷垪涓凡瀛樺湪鐩稿悓 galleryId 鐨勫緟澶勭悊浠诲姟锛屽垯鏇存柊鍏?URL 鑰岄潪閲嶅鍏ラ槦銆?
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
   * 鎵归噺鍏ラ槦
   *
   * 褰撻槦鍒楀凡婊℃椂鑷姩鍋滄鍏ラ槦锛岃繑鍥炲疄闄呭叆闃熸暟閲忋€?
   * 璋冪敤鏂瑰彲鏍规嵁杩斿洖鍊煎垽鏂槸鍚﹂渶瑕佸垎鎵瑰鐞嗐€?
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
    let rejected = 0;
    for (const t of tasks) {
      const position = this.enqueueOuo(t.galleryId, t.ouoUrl, t.manualUrl, t.maxRetries);
      if (position === -1) {
        rejected++;
        // 闃熷垪宸叉弧锛屽仠姝㈢户缁叆闃?
        break;
      }
      count++;
    }
    if (rejected > 0) {
      console.warn(
        `[OuoOrchestrator] 鎵归噺鍏ラ槦鑳屽帇: 瀹為檯鍏ラ槦 ${count}/${tasks.length}锛屽洜闃熷垪宸叉弧鎷掔粷 ${rejected} 涓猔,
      );
    }
    return count;
  }

  /**
   * 鑾峰彇缂栨帓鍣ㄧ姸鎬侊紙鍖呭惈 OUO 鐗规湁瀛楁锛?
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

  // 鈹€鈹€鈹€ 鎶借薄鏂规硶瀹炵幇 鈹€鈹€鈹€

  /** 澶勭悊鍗曚釜 OUO 浠诲姟 鈥?璋冪敤 ZIP 涓嬭浇鍣?*/
  protected async processTask(task: OuoTask): Promise<boolean> {
    // 寤惰繜瀵煎叆閬垮厤寰幆渚濊禆
    const { downloadAndExtractZip } = await import('@/lib/downloader/zip');

    const result = await downloadAndExtractZip(task.galleryId, task.manualUrl);
    task.result = result;

    if (result.success) {
      return true;
    }

    task.error = result.error || '涓嬭浇澶辫触';
    return false;
  }

  /** 鑾峰彇浠诲姟鍞竴鏍囪瘑 */
  protected getTaskId(task: OuoTask): string | number {
    return task.galleryId;
  }

  /** 鍒ゆ柇涓や釜浠诲姟鏄惁涓哄悓涓€浠诲姟 */
  protected isSameTask(a: OuoTask, b: OuoTask): boolean {
    return a.galleryId === b.galleryId;
  }

  // 鈹€鈹€鈹€ 浜嬩欢鍙戝皠 鈹€鈹€鈹€

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

/**
 * HMR 瀹夊叏鐨勫叏灞€鍗曚緥鑾峰彇銆?
 */
export function getOuoOrchestrator(): OuoTaskOrchestrator {
  return getOrCreateGlobal(OUO_ORCHESTRATOR_KEY, () => new OuoTaskOrchestrator());
}
