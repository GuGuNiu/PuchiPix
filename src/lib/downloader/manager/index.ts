import * as fs from 'fs';
import * as path from 'path';
import prisma from '@/lib/db/prisma';
import type { DownloadTask, ProgressMessage } from '@/types';
import { fetchM3U8Content, parseM3U8 } from '../m3u8-parser';
import type { M3U8Segment, M3U8Playlist } from '../m3u8-parser';
import { mergeSegments, verifySegments, cleanupSegments } from '../merger';
import type { MergeResult } from '../merger';
import { transcodeTS, probeDuration, probeResolution } from '@/lib/transcoder';
import { eventBus } from '@/lib/core/infra/event-bus';
import { taskQueueManager } from '@/lib/core/orchestrator/task/queue-manager';
import { sanitizeFilename } from '@/lib/utils';

export interface ActiveDownload {
  taskId: number;
  status: 'active' | 'paused' | 'cancelled';
  segments: M3U8Segment[];
  completedSegments: Set<number>;
  failedSegments: Map<number, Error>;
  totalSegments: number;
  segDir: string;
  outputPath: string;
  startTime: number;
  lastProgressTime: number;
  referer?: string;
}

export interface QueueItem {
  taskId: number;
  segment: M3U8Segment;
  referer?: string;
}
import { SegmentQueue } from './segment-queue';

export class DownloadManager {
  private maxRetries: number;
  private downloadPath: string;
  private segmentsPath: string;
  private progressCallback: ((msg: ProgressMessage) => void) | null = null;
  private activeDownloads: Map<number, ActiveDownload> = new Map();
  private taskRetries: Map<number, number> = new Map();
  private static readonly MAX_TASK_RETRIES = 2;
  private segQueue: SegmentQueue;

  constructor(
    maxRetries: number = 5,
    downloadPath: string = './data/videos',
    segmentsPath: string = './data/segments',
  ) {
    this.maxRetries = maxRetries;
    this.downloadPath = path.resolve(downloadPath);
    this.segmentsPath = path.resolve(segmentsPath);

    this.segQueue = new SegmentQueue(this.maxRetries, this.activeDownloads, {
      getMaxConcurrent: () => taskQueueManager.getDownloadConcurrency().tsSegmentConcurrent,
      onProgress: (taskId, progress, segment, total, status, speed) => {
        this.emitProgress(taskId, progress, segment, total, status, speed);
      },
    });
  }

  setProgressCallback(cb: (msg: ProgressMessage) => void): void {
    this.progressCallback = cb;
  }

  private emitProgress(
    taskId: number,
    progress: number,
    segment: number,
    total: number,
    status: string,
    speed?: string,
  ): void {
    const rounded = Math.round(progress * 100) / 100;

    if (this.progressCallback) {
      this.progressCallback({
        type: 'progress',
        task_id: taskId,
        progress: rounded,
        speed,
        segment,
        total,
        status,
      });
    }

    eventBus.emit('task:progress', {
      taskId,
      progress: rounded,
      status,
      speed,
      segment,
      total,
    });
  }

  private selectBestVariant(variants: M3U8Playlist['variants']): string {
    if (variants.length === 0) return '';
    if (variants.length === 1) return variants[0].fullURI;
    const sorted = [...variants].sort((a, b) => b.bandwidth - a.bandwidth);
    return sorted[0].fullURI;
  }

  async startDownload(task: DownloadTask): Promise<void> {
    if (this.activeDownloads.has(task.ID)) {
      throw new Error(`Task ${task.ID} is already being downloaded`);
    }

    const m3u8URL = task.M3U8URL;
    if (!m3u8URL) {
      throw new Error('No M3U8 URL for task');
    }

    await prisma.downloadTask.update({
      where: { id: task.ID },
      data: { status: 'downloading', progress: 0, errorMsg: '' },
    });

    const videoTitle = task.VideoInfo?.Title || '';
    const safeTitle = sanitizeFilename(videoTitle);

    const segDir = path.join(this.segmentsPath, `task_${task.ID}`);
    const mp4OutputPath = path.join(this.downloadPath, `${safeTitle}.mp4`);
    const tsOutputPath = path.join(segDir, `${safeTitle}.ts`);

    if (!fs.existsSync(segDir)) {
      fs.mkdirSync(segDir, { recursive: true });
    }
    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }

    const referer = task.URL && !task.URL.endsWith('.m3u8') ? task.URL : '';

    try {
      console.log(`[Download] Task ${task.ID}: Fetching M3U8 playlist...`);
      const m3u8Content = await fetchM3U8Content(m3u8URL, referer);
      const playlist = parseM3U8(m3u8Content, m3u8URL);

      let segments: M3U8Segment[];

      if (playlist.isMaster && playlist.variants.length > 0) {
        const variantURL = this.selectBestVariant(playlist.variants);
        if (!variantURL) {
          throw new Error('No valid variant found in master playlist');
        }
        console.log(`[Download] Task ${task.ID}: Selected variant: ${variantURL}`);
        const variantContent = await fetchM3U8Content(variantURL, referer);
        const variantPlaylist = parseM3U8(variantContent, variantURL);
        segments = variantPlaylist.segments;
      } else {
        segments = playlist.segments;
      }

      if (segments.length === 0) {
        throw new Error('No segments found in M3U8 playlist');
      }
      console.log(`[Download] Task ${task.ID}: ${segments.length} segments to download`);

      const download: ActiveDownload = {
        taskId: task.ID,
        status: 'active',
        segments,
        completedSegments: new Set(),
        failedSegments: new Map(),
        totalSegments: segments.length,
        segDir,
        outputPath: mp4OutputPath,
        startTime: Date.now(),
        lastProgressTime: Date.now(),
        referer,
      };

      this.activeDownloads.set(task.ID, download);

      const firstScreenCount = Math.max(2, Math.ceil(segments.length * 0.1));
      const firstScreen = segments.slice(0, firstScreenCount);
      const remaining = segments.slice(firstScreenCount);

      for (const seg of firstScreen) {
        this.segQueue.push({ taskId: task.ID, segment: seg, referer });
      }

      this.segQueue.processQueue();

      this.segQueue.waitForSegments(task.ID, firstScreenCount).then(() => {
        if (download.status === 'cancelled' || download.status === 'paused') return;
        for (const seg of remaining) {
          this.segQueue.push({ taskId: task.ID, segment: seg, referer });
        }
        this.segQueue.processQueue();
      });

      await this.segQueue.waitForAllSegments(task.ID);

      if (download.status === 'cancelled') {
        console.log(`[Download] Task ${task.ID}: Download cancelled`);
        return;
      }

      const failedCount = download.failedSegments.size;
      const completedCount = download.completedSegments.size;
      console.log(
        `[Download] Task ${task.ID}: Download completed — success ${completedCount}/${download.totalSegments}` +
        (failedCount > 0 ? `, failed ${failedCount}` : ''),
      );

      if (failedCount > 0) {
        const failedDetails = Array.from(download.failedSegments.entries())
          .map(([idx, err]) => `  Segment #${idx}: ${err.message}`)
          .join('\n');
        throw new Error(
          `Incomplete download, ${failedCount} segments failed out of ${download.totalSegments} total\n${failedDetails}`,
        );
      }

      const verification = verifySegments(segDir, download.totalSegments);
      if (!verification.valid) {
        const missingStr = verification.missing.length > 0
          ? `Missing segment indices: ${verification.missing.join(', ')}`
          : '';
        const emptyStr = verification.emptyFiles.length > 0
          ? `Empty files: ${verification.emptyFiles.join(', ')}`
          : '';
        throw new Error(
          `Segment verification failed — expected ${download.totalSegments}, actual ${verification.actualCount}` +
          (missingStr ? `\n${missingStr}` : '') +
          (emptyStr ? `\n${emptyStr}` : ''),
        );
      }

      console.log(
        `[Download] Task ${task.ID}: Segment verification passed — ${verification.actualCount} segments, ` +
        `total size ${(verification.totalSize / 1024 / 1024).toFixed(2)} MB`,
      );

      console.log(`[Download] Task ${task.ID}: Merging TS segments...`);
      this.emitProgress(task.ID, 95, completedCount, download.totalSegments, 'downloading');
      const mergeResult: MergeResult = await mergeSegments(segDir, tsOutputPath);
      console.log(
        `[Download] Task ${task.ID}: Merge completed — ${mergeResult.totalFiles} files, ` +
        `${(mergeResult.totalSize / 1024 / 1024).toFixed(2)} MB`,
      );

      console.log(`[Download] Task ${task.ID}: Transcoding to MP4...`);
      this.emitProgress(task.ID, 97, completedCount, download.totalSegments, 'transcoding');
      await transcodeTS(segDir, mp4OutputPath);
      console.log(`[Download] Task ${task.ID}: MP4 transcoding completed — ${mp4OutputPath}`);

      try {
        if (fs.existsSync(tsOutputPath)) {
          fs.unlinkSync(tsOutputPath);
        }
      } catch {}

      console.log(`[Download] Task ${task.ID}: Probing video info...`);
      this.emitProgress(task.ID, 99, completedCount, download.totalSegments, 'transcoding');
      const durationSeconds = await probeDuration(mp4OutputPath).catch(() => 0);
      const resolution = await probeResolution(mp4OutputPath).catch(() => '');
      const fileSize = fs.statSync(mp4OutputPath).size;

      const durationMinutes = Math.round((durationSeconds / 60) * 10) / 10;

      console.log(
        `[Download] Task ${task.ID}: Video info — resolution ${resolution}, ` +
        `duration ${durationMinutes} min, size ${(fileSize / 1024 / 1024).toFixed(2)} MB`,
      );

      await prisma.videoInfo.upsert({
        where: { taskId: task.ID },
        create: {
          taskId: task.ID,
          title: task.VideoInfo?.Title || '',
          sourceUrl: task.URL || '',
          fileSize: BigInt(fileSize),
          duration: durationMinutes,
          tags: JSON.stringify(task.VideoInfo?.Tags || []),
          actors: JSON.stringify(task.VideoInfo?.Actors || []),
          categories: JSON.stringify(task.VideoInfo?.Categories || []),
          director: task.VideoInfo?.Director || '',
          resolution,
        },
        update: {
          sourceUrl: task.URL || '',
          fileSize: BigInt(fileSize),
          duration: durationMinutes,
          tags: JSON.stringify(task.VideoInfo?.Tags || []),
          actors: JSON.stringify(task.VideoInfo?.Actors || []),
          categories: JSON.stringify(task.VideoInfo?.Categories || []),
          director: task.VideoInfo?.Director || '',
          resolution,
        },
      });

      await prisma.downloadTask.update({
        where: { id: task.ID },
        data: {
          status: 'completed',
          progress: 100,
          filePath: mp4OutputPath,
          format: 'mp4',
        },
      });

      await cleanupSegments(segDir).catch(() => {
        console.warn(`[Download] Task ${task.ID}: Failed to clean up temp files (non-fatal)`);
      });

      this.emitProgress(task.ID, 100, download.totalSegments, download.totalSegments, 'completed');
      eventBus.emit('task:completed', { taskId: task.ID, title: task.VideoInfo?.Title });
      console.log(`[Download] Task ${task.ID}: Download task completed`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Download] Task ${task.ID}: Download failed — ${errMsg}`);

      this.segQueue.removeByTask(task.ID);

      const retryCount = this.taskRetries.get(task.ID) || 0;
      const maxRetries = DownloadManager.MAX_TASK_RETRIES;
      const canRetry =
        retryCount < maxRetries &&
        !errMsg.includes('cancelled');

      if (canRetry) {
        this.taskRetries.set(task.ID, retryCount + 1);
        const delayMs = (retryCount + 1) * 10000;
        const dl = this.activeDownloads.get(task.ID);
        const totalSegs = dl?.totalSegments || 0;

        console.log(
          `[Download] Task ${task.ID}: Auto-retry in ${delayMs / 1000}s ` +
          `(${retryCount + 1}/${maxRetries})...`,
        );

        await prisma.downloadTask.update({
          where: { id: task.ID },
          data: {
            status: 'pending',
            progress: 0,
            errorMsg: `Auto-retrying (${retryCount + 1}/${maxRetries})...`,
          },
        });

        eventBus.emit('task:progress', {
          taskId: task.ID,
          progress: 0,
          status: 'pending',
          segment: 0,
          total: totalSegs,
        });

        setTimeout(() => {
          prisma.downloadTask
            .findUnique({ where: { id: task.ID } })
            .then((t: { status: string } | null) => {
              if (!t || t.status === 'cancelled' || t.status === 'paused') {
                this.taskRetries.delete(task.ID);
                console.log(
                  `[Download] Task ${task.ID}: Status detected as ${t?.status || 'null'} before retry, cancelling retry`,
                );
                return;
              }
              console.log(`[Download] Task ${task.ID}: Starting auto-retry...`);
              this.taskRetries.delete(task.ID);
              this.startDownload(task).catch((e) => {
                console.error(`[Download] Task ${task.ID}: Auto-retry failed —`, e);
              });
            })
            .catch(() => {
              this.taskRetries.delete(task.ID);
            });
        }, delayMs);

        return;
      }

      this.taskRetries.delete(task.ID);
      eventBus.emit('task:failed', { taskId: task.ID, error: errMsg });

      await prisma.downloadTask.update({
        where: { id: task.ID },
        data: { status: 'failed', errorMsg: errMsg },
      });

      this.emitProgress(task.ID, 0, 0, 0, 'failed');
    } finally {
      this.activeDownloads.delete(task.ID);
    }
  }

  pauseDownload(taskId: number): void {
    const download = this.activeDownloads.get(taskId);
    if (!download) {
      throw new Error(`Task ${taskId} is not active`);
    }
    download.status = 'paused';

    this.segQueue.removeByTask(taskId);

    prisma.downloadTask
      .update({
        where: { id: taskId },
        data: { status: 'paused' },
      })
      .catch(() => {});

    taskQueueManager.releaseSlot('video', taskId);

    const progress = (download.completedSegments.size / download.totalSegments) * 100;
    this.emitProgress(
      taskId,
      progress,
      download.completedSegments.size,
      download.totalSegments,
      'paused',
    );
  }

  async resumeDownload(taskId: number): Promise<void> {
    const download = this.activeDownloads.get(taskId);
    if (!download) {
      throw new Error(`Task ${taskId} is not active`);
    }
    download.status = 'active';

    for (const seg of download.segments) {
      if (
        !download.completedSegments.has(seg.index) &&
        !this.segQueue.hasPending(taskId)
      ) {
        this.segQueue.push({ taskId, segment: seg, referer: download.referer });
      }
    }

    await prisma.downloadTask
      .update({
        where: { id: taskId },
        data: { status: 'downloading' },
      })
      .catch(() => {});

    this.segQueue.processQueue();

    const progress = (download.completedSegments.size / download.totalSegments) * 100;
    this.emitProgress(
      taskId,
      progress,
      download.completedSegments.size,
      download.totalSegments,
      'downloading',
    );
  }

  cancelDownload(taskId: number): void {
    const download = this.activeDownloads.get(taskId);
    if (download) {
      download.status = 'cancelled';
    }

    this.taskRetries.delete(taskId);
    this.segQueue.removeByTask(taskId);

    if (download) {
      cleanupSegments(download.segDir).catch(() => {});
    }

    prisma.downloadTask
      .update({
        where: { id: taskId },
        data: { status: 'cancelled' },
      })
      .catch(() => {});

    this.emitProgress(taskId, 0, 0, 0, 'cancelled');
    eventBus.emit('task:cancelled', { taskId });

    this.activeDownloads.delete(taskId);
  }

  isDownloading(taskId: number): boolean {
    return this.activeDownloads.has(taskId);
  }

  getQueueLength(): number {
    return this.segQueue.getQueueLength();
  }

  getConcurrentCount(): number {
    return this.segQueue.getConcurrentCount();
  }

  async stop(): Promise<void> {
    this.segQueue.stop();
    this.taskRetries.clear();

    const updates: Promise<unknown>[] = [];

    for (const [, download] of this.activeDownloads) {
      download.status = 'cancelled';
      cleanupSegments(download.segDir).catch(() => {});

      updates.push(
        prisma.downloadTask
          .update({
            where: { id: download.taskId },
            data: { status: 'cancelled', errorMsg: 'Service shutdown, task cancelled' },
          })
          .catch(() => {}),
      );
    }

    this.activeDownloads.clear();
    await Promise.all(updates);
  }
}
