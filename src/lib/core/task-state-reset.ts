/**
 * 任务状态重置模块
 *
 * 在服务启动时，将数据库中所有处于"运行中"状态的任务重置为"待处理"状态。
 *
 * ## 问题背景
 *
 * 当服务正常关闭、意外崩溃或被强制终止后重新启动时，数据库中仍会保留
 * 上次运行期间的"运行中"状态（如 downloading、scraping、transcoding、sniffing），
 * 但内存中的任务处理器（DownloadManager、GalleryDownloader 等）已全部重新初始化，
 * 这些任务实际上并未在执行 —— 形成假运行状态。
 *
 * ## 修复方案
 *
 * 在服务启动最早期（instrumentation.ts 的 register 阶段）将所有运行中状态
 * 批量重置为 pending（或 available），并写入中断原因到 errorMsg 字段，
 * 使用户可以通过界面手动重新启动这些任务。
 */

import prisma from '@/lib/db/prisma';
import { taskQueueManager } from './task-queue-manager';
import { logT } from '@/lib/i18n/server';

/** 中断原因文案 */
const INTERRUPT_REASON = '**服务重启，任务已中断**';

/** 重置结果统计 */
export interface ResetResult {
  videoTasks: number;
  galleries: number;
  galleryImages: number;
  galleryVideos: number;
  sniffTasks: number;
  galleryDownloadInfos: number;
  total: number;
}

/**
 * 重置所有"运行中"状态的任务为"待处理"状态。
 *
 * 涉及的模型和状态：
 *
 * | 模型 | 重置前状态 | 重置后状态 | errorMsg |
 * |------|-----------|-----------|----------|
 * | DownloadTask | downloading, scraping, transcoding | pending | INTERRUPT_REASON |
 * | DownloadTask | failed 且 m3u8Url 为空（爬取未完成） | pending | INTERRUPT_REASON |
 * | Gallery | downloading, scraping | pending | INTERRUPT_REASON |
 * | Gallery | failed 且 title 为空且无图片/视频（爬取未完成） | pending | INTERRUPT_REASON |
 * | GalleryImage | downloading | pending | — |
 * | GalleryVideo | downloading | pending | — |
 * | SniffTask | sniffing | pending | INTERRUPT_REASON |
 * | GalleryDownloadInfo | downloading | available | — |
 *
 * @returns 重置统计
 */
export async function resetRunningTasksOnStartup(): Promise<ResetResult> {
  console.log(logT('log.taskStateReset.started'));

  // 第 0 步：清理 TaskQueueManager 内存态，防止非正常关闭后 activeSlots 残留
  // 导致 acquireSlot() 误判槽位已持有（activeSlots.has(key) → true 直接放行）
  const stats = taskQueueManager.getStats();
  if (stats.runningNormal > 0 || stats.runningSniff > 0 || stats.runningScraping > 0) {
    console.warn(
      logT('log.taskStateReset.cleanupSlots', {
        normal: stats.runningNormal,
        sniff: stats.runningSniff,
        scraping: stats.runningScraping,
      }),
    );
    taskQueueManager.reset();
  }

  const [
    videoResult,
    videoFailedResult,
    galleryResult,
    galleryFailedResult,
    galleryImageResult,
    galleryVideoResult,
    sniffResult,
    downloadInfoResult,
  ] = await Promise.all([
    // 1. 视频任务：downloading / scraping / transcoding → pending
    prisma.downloadTask.updateMany({
      where: {
        status: { in: ['downloading', 'scraping', 'transcoding'] },
      },
      data: {
        status: 'pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    // 1b. 视频任务：failed 且无 M3U8 URL（爬取未完成被中断）→ pending
    prisma.downloadTask.updateMany({
      where: {
        status: 'failed',
        m3u8Url: '',
      },
      data: {
        status: 'pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    // 2. 图库任务：downloading / scraping → pending
    prisma.gallery.updateMany({
      where: {
        status: { in: ['downloading', 'scraping'] },
      },
      data: {
        status: 'pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    // 2b. 图库任务：failed 且无爬取数据（title 为空且无图片/视频）→ pending
    // 这些是爬取被中断或爬取结果为空但未写入 errorMsg 的任务
    prisma.gallery.updateMany({
      where: {
        status: 'failed',
        title: '',
        imageCount: 0,
        videoCount: 0,
      },
      data: {
        status: 'pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    // 3. 图库图片：downloading → pending
    prisma.galleryImage.updateMany({
      where: {
        status: 'downloading',
      },
      data: {
        status: 'pending',
      },
    }),

    // 4. 图库视频：downloading → pending
    prisma.galleryVideo.updateMany({
      where: {
        status: 'downloading',
      },
      data: {
        status: 'pending',
      },
    }),

    // 5. 嗅探任务：sniffing → pending
    prisma.sniffTask.updateMany({
      where: {
        status: 'sniffing',
      },
      data: {
        status: 'pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    // 6. 图库 ZIP 下载信息：downloading → available
    prisma.galleryDownloadInfo.updateMany({
      where: {
        status: 'downloading',
      },
      data: {
        status: 'available',
      },
    }),
  ]);

  const result: ResetResult = {
    videoTasks: videoResult.count + videoFailedResult.count,
    galleries: galleryResult.count + galleryFailedResult.count,
    galleryImages: galleryImageResult.count,
    galleryVideos: galleryVideoResult.count,
    sniffTasks: sniffResult.count,
    galleryDownloadInfos: downloadInfoResult.count,
    total:
      videoResult.count +
      videoFailedResult.count +
      galleryResult.count +
      galleryFailedResult.count +
      galleryImageResult.count +
      galleryVideoResult.count +
      sniffResult.count +
      downloadInfoResult.count,
  };

  if (result.total > 0) {
    console.log(
      logT('log.taskStateReset.completed', {
        videoTasks: result.videoTasks,
        galleries: result.galleries,
        galleryImages: result.galleryImages,
        galleryVideos: result.galleryVideos,
        sniffTasks: result.sniffTasks,
        galleryDownloadInfos: result.galleryDownloadInfos,
        total: result.total,
      }),
    );
  } else {
    console.log(logT('log.taskStateReset.noop'));
  }

  return result;
}
