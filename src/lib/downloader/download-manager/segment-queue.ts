import prisma from '@/lib/db/prisma';
import type { M3U8Segment } from '../m3u8-parser';
import { downloadSegment, generateTSID } from '../segment-downloader';
import type { ActiveDownload, QueueItem } from './types';

export interface SegmentQueueDeps {
  /** 获取最大并发数 */
  getMaxConcurrent: () => number;
  /** 进度回调 */
  onProgress: (
    taskId: number,
    progress: number,
    segment: number,
    total: number,
    status: string,
    speed?: string,
  ) => void;
}

/**
 * 分片下载队列管理器
 *
 * 负责分片的并发下载调度、进度跟踪和等待逻辑。
 * 从 DownloadManager 中提取，降低主类复杂度。
 */
export class SegmentQueue {
  private queue: QueueItem[] = [];
  private currentConcurrent: number = 0;
  private stopped: boolean = false;

  constructor(
    private maxRetries: number,
    private activeDownloads: Map<number, ActiveDownload>,
    private deps: SegmentQueueDeps,
  ) {}

  /** 向队列添加分片 */
  push(item: QueueItem): void {
    this.queue.push(item);
  }

  /** 从队列中移除指定任务的所有待处理分片 */
  removeByTask(taskId: number): void {
    this.queue = this.queue.filter((q) => q.taskId !== taskId);
  }

  /** 检查队列中是否有指定任务的待处理项 */
  hasPending(taskId: number): boolean {
    return this.queue.some((q) => q.taskId === taskId);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getConcurrentCount(): number {
    return this.currentConcurrent;
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  /**
   * 处理下载队列：从队列中取出分片，在并发限制内启动下载。
   */
  processQueue(): void {
    if (this.stopped) return;

    while (this.currentConcurrent < this.deps.getMaxConcurrent() && this.queue.length > 0) {
      const item = this.queue.shift()!;
      const download = this.activeDownloads.get(item.taskId);

      if (!download || download.status === 'cancelled' || download.status === 'paused') {
        continue;
      }

      this.currentConcurrent++;
      this.downloadOneSegment(item.taskId, item.segment, item.referer);
    }
  }

  /**
   * 下载单个分片
   */
  async downloadOneSegment(
    taskId: number,
    segment: M3U8Segment,
    referer?: string,
  ): Promise<void> {
    const download = this.activeDownloads.get(taskId);
    if (!download) {
      this.currentConcurrent--;
      this.processQueue();
      return;
    }

    const tsid = generateTSID(segment.uri, segment.index);

    try {
      const result = await downloadSegment(
        {
          segment,
          destDir: download.segDir,
          tsid,
          referer: referer || download.referer,
        },
        this.maxRetries,
      );

      if (result.error) {
        download.failedSegments.set(segment.index, result.error);
        console.error(
          `[Download] Task ${taskId}: 分片 #${segment.index} (${tsid}) 下载失败 ` +
          `（尝试 ${result.attempts} 次）: ${result.error.message}`,
        );
      } else {
        download.completedSegments.add(segment.index);
      }

      const completed = download.completedSegments.size;
      const failed = download.failedSegments.size;
      const progress = (completed / download.totalSegments) * 90;
      const now = Date.now();
      let speed: string | undefined;
      if (now - download.lastProgressTime > 500) {
        const elapsed = (now - download.startTime) / 1000;
        if (elapsed > 0 && completed > 0) {
          const segPerSec = completed / elapsed;
          speed = `${segPerSec.toFixed(1)} seg/s`;
        }
        download.lastProgressTime = now;
      }

      if (completed % 5 === 0 || completed + failed === download.totalSegments) {
        await prisma.downloadTask
          .update({
            where: { id: taskId },
            data: { progress },
          })
          .catch(() => {});
      }

      this.deps.onProgress(taskId, progress, completed, download.totalSegments, 'downloading', speed);
    } finally {
      this.currentConcurrent--;
      this.processQueue();
    }
  }

  /**
   * 等待指定数量的分片完成（成功或失败均算完成）。
   */
  async waitForSegments(taskId: number, count: number): Promise<void> {
    const download = this.activeDownloads.get(taskId);
    if (!download) return;

    return new Promise((resolve) => {
      const check = (): void => {
        if (download.status === 'cancelled') {
          resolve();
          return;
        }
        if (download.completedSegments.size + download.failedSegments.size >= count) {
          resolve();
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  /**
   * 等待全部分片下载完成。
   */
  async waitForAllSegments(taskId: number): Promise<void> {
    const download = this.activeDownloads.get(taskId);
    if (!download) return;

    return new Promise((resolve) => {
      const check = (): void => {
        if (download.status === 'cancelled') {
          resolve();
          return;
        }
        const totalDone = download.completedSegments.size + download.failedSegments.size;
        if (totalDone >= download.totalSegments) {
          if (!this.hasPending(taskId)) {
            resolve();
            return;
          }
        }
        setTimeout(check, 200);
      };
      check();
    });
  }
}
