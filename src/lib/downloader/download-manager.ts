import * as fs from 'fs';
import * as path from 'path';
import prisma from '@/lib/db/prisma';
import type { DownloadTask, ProgressMessage } from '@/types';
import { fetchM3U8Content, parseM3U8 } from './m3u8-parser';
import type { M3U8Segment, M3U8Playlist } from './m3u8-parser';
import { downloadSegment, generateTSID } from './segment-downloader';
import type { SegmentTask } from './segment-downloader';
import { mergeSegments, verifySegments, cleanupSegments } from './merger';
import type { MergeResult } from './merger';
import { transcodeTS, probeDuration, probeResolution } from '@/lib/transcoder/ffmpeg';
import { eventBus } from '@/lib/core/event-bus';
import { taskQueueManager } from '@/lib/core/task-queue-manager';

interface ActiveDownload {
  /** 任务 ID */
  taskId: number;
  /** 当前状态：活跃/暂停/取消 */
  status: 'active' | 'paused' | 'cancelled';
  /** 全部分片列表（来自 M3U8 解析） */
  segments: M3U8Segment[];
  /** 已成功下载的分片序号集合 */
  completedSegments: Set<number>;
  /** 下载失败的分片序号 → 错误信息 */
  failedSegments: Map<number, Error>;
  /** 分片总数 */
  totalSegments: number;
  /** 分片文件保存目录 */
  segDir: string;
  /** 最终输出文件路径 */
  outputPath: string;
  /** 下载开始时间戳（毫秒） */
  startTime: number;
  /** 上次进度推送时间戳（毫秒），用于节流 */
  lastProgressTime: number;
  /** Referer 头（来自视频页面 URL，用于 CDN 防盗链） */
  referer?: string;
}

/**
 * 下载队列项：将分片加入待下载队列。
 */
interface QueueItem {
  /** 任务 ID */
  taskId: number;
  /** 分片元数据 */
  segment: M3U8Segment;
  /** Referer 头 */
  referer?: string;
}

/**
 * 将视频标题转换为安全的文件名。
 *
 * @param title - 视频标题（可能包含特殊字符）
 * @returns 安全的文件名字符串
 */
function sanitizeFilename(title: string): string {
  if (!title || title.trim() === '') {
    return 'video';
  }

  return title
    // 替换 Windows 禁止字符为下划线
    .replace(/[<>:"/\\|?*]/g, '_')
    // 合并连续的空格和下划线
    .replace(/[\s_]+/g, '_')
    // 去除首尾空格、点号、下划线
    .replace(/^[\s._]+|[\s._]+$/g, '')
    // 限制长度（UTF-8 安全截断，避免截断中文字符的中间字节）
    .slice(0, 100)
    // 如果截断后为空，返回默认值
    || 'video';
}

export class DownloadManager {
  /** 单个分片最大重试次数 */
  private maxRetries: number;
  /** 视频存储目录（最终 MP4 文件直接存放在此目录根目录下） */
  private downloadPath: string;
  /** 分片下载目录（TS 分片临时存放于此，转码后自动清理） */
  private segmentsPath: string;
  /** 进度回调函数（由外部设置，用于推送 WebSocket 消息） */
  private progressCallback: ((msg: ProgressMessage) => void) | null = null;
  /** 活跃下载任务映射 */
  private activeDownloads: Map<number, ActiveDownload> = new Map();
  /** 当前并发下载数 */
  private currentConcurrent: number = 0;
  /** 待下载分片队列 */
  private queue: QueueItem[] = [];
  /** 停止标志 */
  private stopped: boolean = false;
  /** 任务自动重试计数（内存态，不持久化） */
  private taskRetries: Map<number, number> = new Map();
  /** 最大任务级自动重试次数 */
  private static readonly MAX_TASK_RETRIES = 2;

  /**
   * 动态获取当前 TS 分片并发数（从任务设置读取）
   */
  private getMaxConcurrent(): number {
    return taskQueueManager.getDownloadConcurrency().tsSegmentConcurrent;
  }

  /**
   *
   * 目录结构：
   *   data/
   *     segments/       ← 分片下载文件夹（临时）
   *       task_1/       ← 按任务 ID 分子目录
   *         seg_xxx.ts
   *     videos/         ← 转换后视频存储文件夹
   *       标题.mp4      ← MP4 直接放在根目录
   *
   * @param maxRetries    - 单个分片最大重试次数（默认 5）
   * @param downloadPath  - 视频存储目录（默认 ./data/videos）
   * @param segmentsPath  - 分片下载目录（默认 ./data/segments）
   */
  constructor(
    maxRetries: number = 5,
    downloadPath: string = './data/videos',
    segmentsPath: string = './data/segments'
  ) {
    this.maxRetries = maxRetries;
    this.downloadPath = path.resolve(downloadPath);
    this.segmentsPath = path.resolve(segmentsPath);
  }

  /**
   * 设置进度回调函数。
   * 每次分片下载完成或状态变化时，通过此回调推送进度消息。
   *
   * @param cb - 回调函数，接收 ProgressMessage 对象
   */
  setProgressCallback(cb: (msg: ProgressMessage) => void): void {
    this.progressCallback = cb;
  }

  /**
   * 推送进度消息。
   *
   * 同时通过 progressCallback（遗留接口）和 EventBus 推送，
   * 确保 SSE 流能实时转发到前端。
   *
   * @param taskId   - 任务 ID
   * @param progress - 进度百分比（0~100）
   * @param segment  - 已完成的分片数
   * @param total    - 总分片数
   * @param status   - 当前状态描述
   * @param speed    - 可选的下载速度描述
   */
  private emitProgress(
    taskId: number,
    progress: number,
    segment: number,
    total: number,
    status: string,
    speed?: string
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

  /**
   * 从 Master Playlist 的多个变体中选择最高质量的。
   *
   * @param variants - 变体列表
   * @returns 最高质量变体的完整 URL，如果没有变体则返回空字符串
   */
  private selectBestVariant(variants: M3U8Playlist['variants']): string {
    if (variants.length === 0) return '';
    if (variants.length === 1) return variants[0].fullURI;

    // 按带宽降序排序，选择最高质量
    const sorted = [...variants].sort((a, b) => b.bandwidth - a.bandwidth);
    return sorted[0].fullURI;
  }

  /**
   * 启动下载任务。
   *
   * 完整流程：
   - 更新任务状态为 downloading。
   - 创建任务目录和分片子目录。
   - 获取 M3U8 内容，解析播放列表。
   - 如果是 Master Playlist，选择最高质量变体并获取其 Media Playlist。
   - 提取分片列表。
   - 提取 Referer（从原始页面 URL）。
   - 并发下载全部分片（首屏优先：先下载前 10% 分片）。
   - 等待全部分片下载完成。
   - 校验分片数量和完整性（必须 100% 成功才继续）。
   - 合并 TS 分片。
   - 转码为 MP4 格式。
   - 探测视频信息（时长、分辨率、文件大小）。
   - 更新数据库。
   - 清理临时分片文件。
   *
   * 如果任何步骤失败，标记任务为 failed 并中止。
   *
   * @param task - 下载任务对象
   * @throws 如果 M3U8 URL 为空或下载过程中发生不可恢复的错误
   */
  async startDownload(task: DownloadTask): Promise<void> {
    // 防止重复下载
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

    // 分片目录：data/segments/task_{id}/  （临时，转码后自动清理）
    // 视频目录：data/videos/              （MP4 直接放在此目录根目录下）
    const videoTitle = task.VideoInfo?.Title || '';
    const safeTitle = sanitizeFilename(videoTitle);

    // 分片下载目录 — 按任务 ID 分子目录
    const segDir = path.join(this.segmentsPath, `task_${task.ID}`);
    // 最终输出路径（MP4 直接放在 videos/ 根目录下，以视频标题命名）
    const mp4OutputPath = path.join(this.downloadPath, `${safeTitle}.mp4`);
    // 合并后的 TS 临时文件路径（放在分片目录中，合并后删除）
    const tsOutputPath = path.join(segDir, `${safeTitle}.ts`);

    // 创建分片目录（如果不存在）
    if (!fs.existsSync(segDir)) {
      fs.mkdirSync(segDir, { recursive: true });
    }
    if (!fs.existsSync(this.downloadPath)) {
      fs.mkdirSync(this.downloadPath, { recursive: true });
    }

    // 提取 Referer（如果原始 URL 不是 .m3u8，说明是视频页面 URL，用作 Referer）
    const referer = task.URL && !task.URL.endsWith('.m3u8') ? task.URL : '';

    try {
      console.log(`[Download] Task ${task.ID}: 正在获取 M3U8 播放列表...`);
      const m3u8Content = await fetchM3U8Content(m3u8URL, referer);
      const playlist = parseM3U8(m3u8Content, m3u8URL);

      let segments: M3U8Segment[];

      if (playlist.isMaster && playlist.variants.length > 0) {
        const variantURL = this.selectBestVariant(playlist.variants);
        if (!variantURL) {
          throw new Error('No valid variant found in master playlist');
        }
        console.log(`[Download] Task ${task.ID}: 选择了变体 ${variantURL}`);
        const variantContent = await fetchM3U8Content(variantURL, referer);
        const variantPlaylist = parseM3U8(variantContent, variantURL);
        segments = variantPlaylist.segments;
      } else {
        segments = playlist.segments;
      }

      if (segments.length === 0) {
        throw new Error('No segments found in M3U8 playlist');
      }
      console.log(`[Download] Task ${task.ID}: 共 ${segments.length} 个分片需要下载`);

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

      // 首屏优先：先下载前 10%（至少 2 个）分片，让用户尽快可以开始播放
      const firstScreenCount = Math.max(2, Math.ceil(segments.length * 0.1));
      const firstScreen = segments.slice(0, firstScreenCount);
      const remaining = segments.slice(firstScreenCount);

      // 将首屏分片加入队列
      for (const seg of firstScreen) {
        this.queue.push({ taskId: task.ID, segment: seg, referer });
      }

      this.processQueue();

      // 首屏分片完成后，加入剩余分片
      this.waitForSegments(task.ID, firstScreenCount).then(() => {
        if (download.status === 'cancelled' || download.status === 'paused') return;
        for (const seg of remaining) {
          this.queue.push({ taskId: task.ID, segment: seg, referer });
        }
        this.processQueue();
      });

      await this.waitForAllSegments(task.ID);

      if (download.status === 'cancelled') {
        console.log(`[Download] Task ${task.ID}: 下载已取消`);
        return;
      }

      // 关键校验：必须全部分片下载成功，任何一个失败都不允许合并
      const failedCount = download.failedSegments.size;
      const completedCount = download.completedSegments.size;
      console.log(
        `[Download] Task ${task.ID}: 下载完成 — 成功 ${completedCount}/${download.totalSegments}` +
        (failedCount > 0 ? `，失败 ${failedCount}` : '')
      );

      if (failedCount > 0) {
        // 有分片下载失败，收集失败详情
        const failedDetails = Array.from(download.failedSegments.entries())
          .map(([idx, err]) => `  分片 #${idx}: ${err.message}`)
          .join('\n');
        throw new Error(
          `下载不完整：${failedCount} 个分片下载失败（共 ${download.totalSegments} 个分片）\n${failedDetails}`
        );
      }

      const verification = verifySegments(segDir, download.totalSegments);
      if (!verification.valid) {
        const missingStr = verification.missing.length > 0
          ? `缺失分片序号: ${verification.missing.join(', ')}`
          : '';
        const emptyStr = verification.emptyFiles.length > 0
          ? `空文件: ${verification.emptyFiles.join(', ')}`
          : '';
        throw new Error(
          `分片校验失败 — 期望 ${download.totalSegments} 个，实际 ${verification.actualCount} 个` +
          (missingStr ? `\n${missingStr}` : '') +
          (emptyStr ? `\n${emptyStr}` : '')
        );
      }

      console.log(
        `[Download] Task ${task.ID}: 分片校验通过 — ${verification.actualCount} 个分片，` +
        `总大小 ${(verification.totalSize / 1024 / 1024).toFixed(2)} MB`
      );

      console.log(`[Download] Task ${task.ID}: 正在合并 TS 分片...`);
      this.emitProgress(task.ID, 95, completedCount, download.totalSegments, 'downloading');
      const mergeResult: MergeResult = await mergeSegments(segDir, tsOutputPath);
      console.log(
        `[Download] Task ${task.ID}: 合并完成 — ${mergeResult.totalFiles} 个文件，` +
        `${(mergeResult.totalSize / 1024 / 1024).toFixed(2)} MB`
      );

      console.log(`[Download] Task ${task.ID}: 正在转码为 MP4...`);
      this.emitProgress(task.ID, 97, completedCount, download.totalSegments, 'transcoding');
      await transcodeTS(segDir, mp4OutputPath);
      console.log(`[Download] Task ${task.ID}: MP4 转码完成 — ${mp4OutputPath}`);

      try {
        if (fs.existsSync(tsOutputPath)) {
          fs.unlinkSync(tsOutputPath);
        }
      } catch {
      }

      console.log(`[Download] Task ${task.ID}: 正在探测视频信息...`);
      this.emitProgress(task.ID, 99, completedCount, download.totalSegments, 'transcoding');
      const durationSeconds = await probeDuration(mp4OutputPath).catch(() => 0);
      const resolution = await probeResolution(mp4OutputPath).catch(() => '');
      const fileSize = fs.statSync(mp4OutputPath).size;

      // 将秒转换为分钟（保留一位小数）
      const durationMinutes = Math.round((durationSeconds / 60) * 10) / 10;

      console.log(
        `[Download] Task ${task.ID}: 视频信息 — 分辨率 ${resolution}, ` +
        `时长 ${durationMinutes} 分钟, 大小 ${(fileSize / 1024 / 1024).toFixed(2)} MB`
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
        console.warn(`[Download] Task ${task.ID}: 清理临时文件失败（非致命）`);
      });

      this.emitProgress(task.ID, 100, download.totalSegments, download.totalSegments, 'completed');
      eventBus.emit('task:completed', { taskId: task.ID, title: task.VideoInfo?.Title });
      console.log(`[Download] Task ${task.ID}: ✅ 下载任务全部完成`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Download] Task ${task.ID}: ❌ 下载失败 — ${errMsg}`);

      // 清理本任务的队列残留
      this.queue = this.queue.filter((q) => q.taskId !== task.ID);

      const retryCount = this.taskRetries.get(task.ID) || 0;
      const maxRetries = DownloadManager.MAX_TASK_RETRIES;
      const canRetry =
        retryCount < maxRetries &&
        !errMsg.includes('已取消') &&
        !errMsg.includes('cancelled');

      if (canRetry) {
        this.taskRetries.set(task.ID, retryCount + 1);
        const delayMs = (retryCount + 1) * 10000; // 10s, 20s
        const dl = this.activeDownloads.get(task.ID);
        const totalSegs = dl?.totalSegments || 0;

        console.log(
          `[Download] Task ${task.ID}: 将在 ${delayMs / 1000}s 后自动重试 ` +
          `(${retryCount + 1}/${maxRetries})...`,
        );

        await prisma.downloadTask.update({
          where: { id: task.ID },
          data: {
            status: 'pending',
            progress: 0,
            errorMsg: `自动重试中 (${retryCount + 1}/${maxRetries})...`,
          },
        });

        eventBus.emit('task:progress', {
          taskId: task.ID,
          progress: 0,
          status: 'pending',
          segment: 0,
          total: totalSegs,
        });

        // 延迟后自动重试（setTimeout 确保 finally 先清理 activeDownloads）
        setTimeout(() => {
          prisma.downloadTask
            .findUnique({ where: { id: task.ID } })
            .then((t: { status: string } | null) => {
              if (!t || t.status === 'cancelled' || t.status === 'paused') {
                this.taskRetries.delete(task.ID);
                console.log(
                  `[Download] Task ${task.ID}: 重试前检测到状态为 ${t?.status || 'null'}，取消重试`,
                );
                return;
              }
              console.log(`[Download] Task ${task.ID}: 开始自动重试...`);
              this.taskRetries.delete(task.ID);
              this.startDownload(task).catch((e) => {
                console.error(`[Download] Task ${task.ID}: 自动重试失败 —`, e);
              });
            })
            .catch(() => {
              this.taskRetries.delete(task.ID);
            });
        }, delayMs);

        return;
      }

      // 已达最大重试次数或不可重试，标记为失败
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


  /**
   * 处理下载队列：从队列中取出分片，在并发限制内启动下载。
   *
   * 算法：循环检查当前并发数是否低于最大值，如果是则从队列头部取出一个分片启动下载。
   * 每个分片下载完成后会递减并发计数器并再次调用此方法。
   */
  private processQueue(): void {
    if (this.stopped) return;

    while (this.currentConcurrent < this.getMaxConcurrent() && this.queue.length > 0) {
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
   * 下载单个分片。
   *
   * 调用 segment-downloader 的 downloadSegment 函数，
   * 传入最大重试次数，下载完成后更新进度。
   *
   * @param taskId   - 任务 ID
   * @param segment  - 分片元数据
   * @param referer  - 可选的 Referer 头
   */
  private async downloadOneSegment(
    taskId: number,
    segment: M3U8Segment,
    referer?: string
  ): Promise<void> {
    const download = this.activeDownloads.get(taskId);
    if (!download) {
      this.currentConcurrent--;
      this.processQueue();
      return;
    }

    // 生成分片唯一标识符
    const tsid = generateTSID(segment.uri, segment.index);

    try {
      // 执行分片下载（含重试逻辑）
      const result = await downloadSegment(
        {
          segment,
          destDir: download.segDir,
          tsid,
          referer: referer || download.referer,
        },
        this.maxRetries
      );

      if (result.error) {
        download.failedSegments.set(segment.index, result.error);
        console.error(
          `[Download] Task ${taskId}: 分片 #${segment.index} (${tsid}) 下载失败 ` +
          `（尝试 ${result.attempts} 次）: ${result.error.message}`
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
          .catch(() => {
          });
      }

      this.emitProgress(taskId, progress, completed, download.totalSegments, 'downloading', speed);

    } finally {
      this.currentConcurrent--;
      this.processQueue();
    }
  }

  /**
   * 等待指定数量的分片完成（成功或失败均算完成）。
   *
   * 用于首屏优先策略：等待前 N 个分片下载完成后再加入剩余分片。
   *
   * @param taskId - 任务 ID
   * @param count  - 需要完成的分片数量
   */
  private async waitForSegments(taskId: number, count: number): Promise<void> {
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
   *
   * 成功 + 失败的分片数达到总数，且队列中没有该任务的待处理项，
   * 且当前没有正在下载的分片时，才算全部完成。
   *
   * @param taskId - 任务 ID
   */
  private async waitForAllSegments(taskId: number): Promise<void> {
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
          const hasPending = this.queue.some((q) => q.taskId === taskId);
          // 只检查本任务是否还有队列待处理项，不检查全局 currentConcurrent
          // 否则多任务并发时，任务 A 要等任务 B 的分片下完才能进入合并阶段
          if (!hasPending) {
            resolve();
            return;
          }
        }
        setTimeout(check, 200);
      };
      check();
    });
  }


  /**
   * 暂停下载任务。
   *
   * - 将任务状态设置为 paused。
   * - 从队列中移除该任务的所有待处理分片。
   * - 更新数据库状态。
   *
   * @param taskId - 任务 ID
   * @throws 如果任务不在活跃列表中
   */
  pauseDownload(taskId: number): void {
    const download = this.activeDownloads.get(taskId);
    if (!download) {
      throw new Error(`Task ${taskId} is not active`);
    }
    download.status = 'paused';

    this.queue = this.queue.filter((q) => q.taskId !== taskId);

    prisma.downloadTask
      .update({
        where: { id: taskId },
        data: { status: 'paused' },
      })
      .catch(() => {});

    // 释放普通槽位，允许排队中的任务启动
    taskQueueManager.releaseSlot('video', taskId);

    const progress = download.completedSegments.size / download.totalSegments * 100;
    this.emitProgress(
      taskId,
      progress,
      download.completedSegments.size,
      download.totalSegments,
      'paused'
    );
  }

  /**
   * 恢复下载任务。
   *
   * - 将任务状态设置回 active。
   * - 将所有未成功下载的分片重新加入队列。
   * - 重启队列处理。
   *
   * @param taskId - 任务 ID
   * @throws 如果任务不在活跃列表中
   */
  async resumeDownload(taskId: number): Promise<void> {
    const download = this.activeDownloads.get(taskId);
    if (!download) {
      throw new Error(`Task ${taskId} is not active`);
    }
    download.status = 'active';

    for (const seg of download.segments) {
      if (
        !download.completedSegments.has(seg.index) &&
        !this.queue.some((q) => q.taskId === taskId && q.segment.index === seg.index)
      ) {
        this.queue.push({ taskId, segment: seg, referer: download.referer });
      }
    }

    await prisma.downloadTask
      .update({
        where: { id: taskId },
        data: { status: 'downloading' },
      })
      .catch(() => {});

    this.processQueue();

    const progress = download.completedSegments.size / download.totalSegments * 100;
    this.emitProgress(
      taskId,
      progress,
      download.completedSegments.size,
      download.totalSegments,
      'downloading'
    );
  }

  /**
   * 取消下载任务。
   *
   * - 将任务状态设置为 cancelled。
   * - 从队列中移除该任务的所有待处理分片。
   * - 清理临时分片文件。
   * - 更新数据库状态。
   *
   * @param taskId - 任务 ID
   */
  cancelDownload(taskId: number): void {
    const download = this.activeDownloads.get(taskId);
    if (download) {
      download.status = 'cancelled';
    }

    // 清理重试计数，防止取消后仍触发重试
    this.taskRetries.delete(taskId);
    this.queue = this.queue.filter((q) => q.taskId !== taskId);

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

  /**
   * 检查任务是否正在下载。
   * @param taskId - 任务 ID
   * @returns true 如果任务在活跃下载列表中
   */
  isDownloading(taskId: number): boolean {
    return this.activeDownloads.has(taskId);
  }

  /**
   * 获取当前队列长度。
   * @returns 待下载分片数量
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * 获取当前并发下载数。
   * @returns 正在下载的分片数量
   */
  getConcurrentCount(): number {
    return this.currentConcurrent;
  }


  /**
   * 停止所有下载任务。
   *
   * 用于服务关闭时的优雅退出。将所有活跃任务在内存中标记为 cancelled，
   * 清理临时分片文件，并将数据库中的状态持久化为 cancelled，
   * 防止重启后出现假运行状态。
   * （额外的 DB 重置由 instrumentation.ts 的 resetRunningTasksOnStartup 兜底）
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.queue = [];
    this.taskRetries.clear();

    const updates: Promise<unknown>[] = [];

    // 将所有活跃任务标记为取消，并清理文件
    for (const [, download] of this.activeDownloads) {
      download.status = 'cancelled';
      cleanupSegments(download.segDir).catch(() => {});

      // 将数据库中的状态持久化为 cancelled
      updates.push(
        prisma.downloadTask
          .update({
            where: { id: download.taskId },
            data: { status: 'cancelled', errorMsg: '服务关闭，任务已取消' },
          })
          .catch(() => {}),
      );
    }

    this.activeDownloads.clear();

    // 等待所有 DB 更新完成，确保优雅关闭时状态已持久化
    await Promise.all(updates);
  }
}
