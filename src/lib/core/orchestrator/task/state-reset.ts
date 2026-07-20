import prisma from '@/lib/db/prisma';
import { taskQueueManager } from './queue-manager';
import { logT } from '@/lib/i18n/server';
import { loggers } from '../../infra/logger';

const logger = loggers.taskStateReset();

export interface ResetResult {
  videoTasks: number;
  galleries: number;
  galleryImages: number;
  galleryVideos: number;
  sniffTasks: number;
  galleryDownloadInfos: number;
  total: number;
}

export async function resetRunningTasksOnStartup(): Promise<ResetResult> {
  logger.infoT('log.taskStateReset.started');

  const suspendReason = logT('log.taskStateReset.suspended');

  const stats = taskQueueManager.getStats();
  if (stats.runningNormal > 0 || stats.runningSniff > 0 || stats.runningScraping > 0) {
    logger.warn(
      logT('log.taskStateReset.cleanupSlots', {
        normal: stats.runningNormal,
        sniff: stats.runningSniff,
        scraping: stats.runningScraping,
      }),
    );
  }
  taskQueueManager.reset();

  const [
    videoRunning,
    videoFailedUnscraped,
    galleryScraping,
    galleryDownloading,
    galleryFailedUnscraped,
    galleryImage,
    galleryVideo,
    sniff,
    downloadInfo,
  ] = await Promise.all([
    prisma.downloadTask.updateMany({
      where: { status: { in: ['downloading', 'scraping', 'transcoding'] } },
      data: { status: 'paused', errorMsg: suspendReason },
    }),
    prisma.downloadTask.updateMany({
      where: { status: 'failed', m3u8Url: '' },
      data: { status: 'paused', errorMsg: suspendReason },
    }),
    prisma.gallery.updateMany({
      where: { status: { in: ['scraping'] } },
      data: { status: 'paused', errorMsg: suspendReason },
    }),
    prisma.gallery.updateMany({
      where: { status: { in: ['downloading'] } },
      data: { status: 'paused', errorMsg: suspendReason },
    }),
    prisma.gallery.updateMany({
      where: { status: 'failed', title: '', imageCount: 0, videoCount: 0 },
      data: { status: 'paused', errorMsg: suspendReason },
    }),
    prisma.galleryImage.updateMany({
      where: { status: 'downloading' },
      data: { status: 'pending' },
    }),
    prisma.galleryVideo.updateMany({
      where: { status: 'downloading' },
      data: { status: 'pending' },
    }),
    prisma.sniffTask.updateMany({
      where: { status: 'sniffing' },
      data: { status: 'paused', errorMsg: suspendReason },
    }),
    prisma.galleryDownloadInfo.updateMany({
      where: { status: 'downloading' },
      data: { status: 'available' },
    }),
  ]);

  const result: ResetResult = {
    videoTasks: videoRunning.count + videoFailedUnscraped.count,
    galleries: galleryScraping.count + galleryDownloading.count + galleryFailedUnscraped.count,
    galleryImages: galleryImage.count,
    galleryVideos: galleryVideo.count,
    sniffTasks: sniff.count,
    galleryDownloadInfos: downloadInfo.count,
    total:
      videoRunning.count +
      videoFailedUnscraped.count +
      galleryScraping.count +
      galleryDownloading.count +
      galleryFailedUnscraped.count +
      galleryImage.count +
      galleryVideo.count +
      sniff.count +
      downloadInfo.count,
  };

  if (result.total > 0) {
    logger.info(
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
    logger.infoT('log.taskStateReset.noop');
  }

  await taskQueueManager.startupRecovery();

  return result;
}
