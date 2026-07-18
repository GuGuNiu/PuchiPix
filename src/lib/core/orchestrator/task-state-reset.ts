import prisma from '@/lib/db/prisma';
import { taskQueueManager } from './task-queue-manager';
import { logT } from '@/lib/i18n/server';

const INTERRUPT_REASON = '**鏈嶅姟閲嶅惎锛屼换鍔″凡涓柇**';

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
 * Resets all "running" tasks to the "pending" state.
 *
 * Affected models and states:
 *
 * | Model | Pre-reset Status | Post-reset Status | errorMsg |
 * |------|-----------------|------------------|----------|
 * | DownloadTask | downloading, scraping, transcoding | pending | INTERRUPT_REASON |
 * | DownloadTask | failed with empty m3u8Url (scraping incomplete) | pending | INTERRUPT_REASON |
 * | Gallery | scraping | scrape_pending | INTERRUPT_REASON |
 * | Gallery | downloading | download_pending | INTERRUPT_REASON |
 * | Gallery | failed with empty title and no images/videos (scraping incomplete) | scrape_pending | INTERRUPT_REASON |
 * | GalleryImage | downloading | pending | 鈥?|
 * | GalleryVideo | downloading | pending | 鈥?|
 * | SniffTask | sniffing | pending | INTERRUPT_REASON |
 * | GalleryDownloadInfo | downloading | available | 鈥?|
 *
 * @returns Reset statistics
 */
export async function resetRunningTasksOnStartup(): Promise<ResetResult> {
  console.log(logT('log.taskStateReset.started'));

  // 寮哄埗閲嶇疆妲戒綅鐘舵€侊紝纭繚鍐呭瓨鐘舵€佷笌DB鐘舵€佷竴鑷?
  // 杩欐槸淇"鎻掓Ы瓒婄嫳"闂鐨勫叧閿細鏈嶅姟閲嶅惎鏃跺繀椤绘竻绌烘墍鏈夋Ы浣嶅崰鐢?
  const stats = taskQueueManager.getStats();
  if (stats.runningNormal > 0 || stats.runningSniff > 0 || stats.runningScraping > 0) {
    console.warn(
      logT('log.taskStateReset.cleanupSlots', {
        normal: stats.runningNormal,
        sniff: stats.runningSniff,
        scraping: stats.runningScraping,
      }),
    );
  }
  // 鏃犺妲戒綅璁℃暟鏄惁涓?锛岄兘鎵цreset浠ョ‘淇濈姸鎬佸共鍑€
  // 闃叉鍑虹幇DB鐘舵€佸凡閲嶇疆浣嗗唴瀛樻Ы浣嶆湭閲婃斁鐨勬儏鍐?
  taskQueueManager.reset();
  console.log('[TaskStateReset] 妲戒綅鐘舵€佸凡寮哄埗閲嶇疆');

  const [
    videoResult,
    videoFailedResult,
    galleryScrapingResult,
    galleryDownloadingResult,
    galleryFailedResult,
    galleryImageResult,
    galleryVideoResult,
    sniffResult,
    downloadInfoResult,
  ] = await Promise.all([
    prisma.downloadTask.updateMany({
      where: {
        status: { in: ['downloading', 'scraping', 'transcoding'] },
      },
      data: {
        status: 'pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

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

    prisma.gallery.updateMany({
      where: {
        status: { in: ['scraping'] },
      },
      data: {
        status: 'scrape_pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    prisma.gallery.updateMany({
      where: {
        status: { in: ['downloading'] },
      },
      data: {
        status: 'download_pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    prisma.gallery.updateMany({
      where: {
        status: 'failed',
        title: '',
        imageCount: 0,
        videoCount: 0,
      },
      data: {
        status: 'scrape_pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

    prisma.galleryImage.updateMany({
      where: {
        status: 'downloading',
      },
      data: {
        status: 'pending',
      },
    }),

    prisma.galleryVideo.updateMany({
      where: {
        status: 'downloading',
      },
      data: {
        status: 'pending',
      },
    }),

    prisma.sniffTask.updateMany({
      where: {
        status: 'sniffing',
      },
      data: {
        status: 'pending',
        errorMsg: INTERRUPT_REASON,
      },
    }),

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
    galleries: galleryScrapingResult.count + galleryDownloadingResult.count + galleryFailedResult.count,
    galleryImages: galleryImageResult.count,
    galleryVideos: galleryVideoResult.count,
    sniffTasks: sniffResult.count,
    galleryDownloadInfos: downloadInfoResult.count,
    total:
      videoResult.count +
      videoFailedResult.count +
      galleryScrapingResult.count +
      galleryDownloadingResult.count +
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

  await taskQueueManager.startupRecovery();

  return result;
}
