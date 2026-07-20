import prisma from '@/lib/db/prisma';
import type { M3U8Segment } from '../m3u8-parser';
import { downloadSegment, generateTSID } from '../segment-downloader';
import type { ActiveDownload, QueueItem } from './index';

export interface SegmentQueueDeps {
  getMaxConcurrent: () => number;
  /** ProgressCallback */
  onProgress: (
    taskId: number,
    progress: number,
    segment: number,
    total: number,
    status: string,
    speed?: string,
  ) => void;
}

export class SegmentQueue {
  private queue: QueueItem[] = [];
  private currentConcurrent: number = 0;
  private stopped: boolean = false;

  constructor(
    private maxRetries: number,
    private activeDownloads: Map<number, ActiveDownload>,
    private deps: SegmentQueueDeps,
  ) {}

  /** ToQueueAddsegment */
  push(item: QueueItem): void {
    this.queue.push(item);
  }

  removeByTask(taskId: number): void {
    this.queue = this.queue.filter((q) => q.taskId !== taskId);
  }

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
          `尝试 ${result.attempts} 次: ${result.error.message}`,
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
   * AwaitallsegmentDownloadComplete。
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
