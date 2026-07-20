import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { ttlLock } from '@/lib/core/infra/ttl-lock';
import { getOrCreateGlobal } from '@/lib/core/infra/global-singleton';
import { backoffDelay, sleep } from '@/lib/core/stealth/anti-crawler';
import { ErrorCode, AppError } from '@/lib/core/error-codes';
import {
  getGalleryConcurrency,
  getGalleryRoot,
  buildGalleryFolderName,
  extractExtension,
  ensureDir,
  MAX_RETRIES,
} from './utils';
import { downloadFileWithDomainFallback } from '../domain-fallback';
import { downloadM3U8Video } from './m3u8-downloader';

export class GalleryDownloader {
  private downloading: Set<number> = new Set();
  private galleryRetries: Map<number, number> = new Map();
  private cancelled: Set<number> = new Set();
  private static readonly MAX_GALLERY_RETRIES = 1;

  
  cancelDownload(galleryId: number): void {
    this.cancelled.add(galleryId);
    this.galleryRetries.delete(galleryId);
  }

  /**
   * Stopallactive GraphlibraryDownload
   */
  stopAll(): void {
    for (const galleryId of this.downloading) {
      this.cancelled.add(galleryId);

      prisma.gallery
        .update({
          where: { id: galleryId },
          data: { status: 'cancelled', errorMsg: 'Service shutdown, task cancelled' },
        })
        .catch(() => {});
    }
    this.galleryRetries.clear();
    console.log(`[GalleryDownloader] Cancelled ${this.downloading.size} active downloads`);
  }

  /** CheckGraphlibraryisnoCancel */
  private isCancelled(galleryId: number): boolean {
    return this.cancelled.has(galleryId);
  }

  
  async downloadGallery(
    galleryId: number,
    concurrency: number = getGalleryConcurrency(),
  ): Promise<{
    success: number;
    failed: number;
    skipped: number;
    savePath: string;
  }> {
    if (this.downloading.has(galleryId)) {
      throw new AppError(ErrorCode.ERR_ALREADY_DOWNLOADING, `Gallery #${galleryId} is already downloading`);
    }

    const lockKey = `gallery:download:${galleryId}`;
    const lockHandle = await ttlLock.acquire(lockKey, {
      ttl: 600000,
      waitTimeout: 5000,
    });

    if (!lockHandle) {
      throw new AppError(ErrorCode.ERR_ALREADY_DOWNLOADING, `Gallery #${galleryId} is being downloaded by another process`);
    }

    this.downloading.add(galleryId);

    try {
      let result = await this._doDownload(galleryId, concurrency);

      if (this.isCancelled(galleryId)) {
        this.cancelled.delete(galleryId);
        return result;
      }

      const retryCount = this.galleryRetries.get(galleryId) || 0;
      if (
        result.failed > 0 &&
        retryCount < GalleryDownloader.MAX_GALLERY_RETRIES
      ) {
        this.galleryRetries.set(galleryId, retryCount + 1);
        const delayMs = 10000;

        console.log(
          `[GalleryDL] Gallery #${galleryId}: ${result.failed} files failed, ` +
          `auto-retry in ${delayMs / 1000}s...`,
        );

        await prisma.galleryImage.updateMany({
          where: { galleryId, status: 'failed' },
          data: { status: 'pending' },
        });
        await prisma.galleryVideo.updateMany({
          where: { galleryId, status: 'failed' },
          data: { status: 'pending' },
        });

        await sleep(delayMs);

        if (this.isCancelled(galleryId)) {
          this.cancelled.delete(galleryId);
          return result;
        }

        console.log(`[GalleryDL] Gallery #${galleryId}: starting auto-retry...`);
        result = await this._doDownload(galleryId, getGalleryConcurrency());
      }

      this.galleryRetries.delete(galleryId);
      return result;
    } finally {
      this.downloading.delete(galleryId);
      this.cancelled.delete(galleryId);
      ttlLock.releaseHandle(lockHandle);
    }
  }

  private async _doDownload(
    galleryId: number,
    concurrency: number,
  ): Promise<{
    success: number;
    failed: number;
    skipped: number;
    savePath: string;
  }> {
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: {
        images: { orderBy: { orderIndex: 'asc' } },
        videos: { orderBy: { id: 'asc' } },
      },
    });

    if (!gallery) {
      throw new Error(`Gallery #${galleryId} not found`);
    }

    if (gallery.status === 'scraping') {
      throw new Error(`Gallery #${galleryId} scrape not complete, wait for recognition to finish before downloading`);
    }

    const folderName = buildGalleryFolderName(
      gallery.id,
      gallery.title,
      gallery.protagonist,
      gallery.description,
    );
    const galleryPath = path.join(getGalleryRoot(), folderName);

    ensureDir(galleryPath);

    await prisma.gallery.update({
      where: { id: galleryId },
      data: { savePath: galleryPath, status: 'downloading' },
    });

    const downloadHeaders: Record<string, string> = {
      Referer: gallery.sourceUrl,
    };

    if (gallery.coverUrl) {
      const coverDir = path.join(galleryPath, 'cover');
      ensureDir(coverDir);
      const coverExt = extractExtension(gallery.coverUrl);
      const coverFilePath = path.join(coverDir, `cover${coverExt}`);

      if (!fs.existsSync(coverFilePath) || fs.statSync(coverFilePath).size === 0) {
        let coverDownloaded = false;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          coverDownloaded = (await downloadFileWithDomainFallback(gallery.coverUrl, coverFilePath, downloadHeaders)).success;
          if (coverDownloaded) break;
          if (retry < MAX_RETRIES - 1) {
            await sleep(backoffDelay(retry, 1000, 8000));
          }
        }
        if (coverDownloaded) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { coverLocalPath: coverFilePath },
          });
          console.log(`[GalleryDL] Gallery #${galleryId} cover downloaded: ${coverFilePath}`);
        } else {
          console.error(`[GalleryDL] Gallery #${galleryId} cover download failed: ${gallery.coverUrl}`);
        }
      } else {
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { coverLocalPath: coverFilePath },
        });
      }
    }

    let success = 0;
    let failed = 0;
    let skipped = 0;
    let totalDownloadedSize = BigInt(0);

    const totalFiles = gallery.images.length + gallery.videos.length;
    let completedFiles = 0;

    eventBus.emit('gallery:downloadStarted', { galleryId, total: totalFiles });

    const emitProgress = (): void => {
      completedFiles++;
      eventBus.emit('gallery:downloadProgress', {
        galleryId,
        completed: completedFiles,
        total: totalFiles,
        failed,
      });
    };

    const imageTasks = gallery.images.map((img: typeof gallery.images[number], index: number) => async () => {
      const ext = extractExtension(img.url);
      const fileName = `${index + 1}${ext}`;
      const filePath = path.join(galleryPath, fileName);

      if (img.status === 'downloaded' && fs.existsSync(filePath)) {
        skipped++;
        emitProgress();
        return;
      }

      let downloaded = false;
      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        downloaded = (await downloadFileWithDomainFallback(img.url, filePath, downloadHeaders)).success;
        if (downloaded) break;
        if (retry < MAX_RETRIES - 1) {
          await sleep(backoffDelay(retry, 1000, 8000));
        }
      }

      if (downloaded) {
        success++;
        const fileSize = BigInt(fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
        totalDownloadedSize += fileSize;
        await prisma.galleryImage.update({
          where: { id: img.id },
          data: { localPath: filePath, fileName, fileSize, status: 'downloaded', completedAt: new Date() },
        });
      } else {
        failed++;
        await prisma.galleryImage.update({
          where: { id: img.id },
          data: { status: 'failed' },
        });
      }
      if (completedFiles % 5 === 0 || completedFiles === totalFiles) {
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { downloadedSize: totalDownloadedSize },
        });
      }
      emitProgress();
    });

    const videoTasks = gallery.videos.map((video: typeof gallery.videos[number], i: number) => async () => {
      const isM3u8 = video.url.includes('.m3u8');
      const ext = isM3u8 ? '.mp4' : extractExtension(video.url);
      const originalName = (() => {
        try {
          const cleanUrl = video.url.split('?')[0].split('#')[0];
          const baseName = path.basename(cleanUrl);
          if (baseName && baseName.includes('.')) {
            if (isM3u8) {
              return baseName.replace(/\.\w+$/, ext);
            }
            return baseName;
          }
        } catch {}
        return `video_${i + 1}${ext}`;
      })();
      const fileName = originalName;
      const filePath = path.join(galleryPath, fileName);

      if (video.status === 'completed' && fs.existsSync(filePath)) {
        skipped++;
        emitProgress();
        return;
      }

      if (!video.url.includes('.m3u8')) {
        let downloaded = false;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          downloaded = (await downloadFileWithDomainFallback(video.url, filePath, downloadHeaders)).success;
          if (downloaded) break;
          if (retry < MAX_RETRIES - 1) {
            await sleep(backoffDelay(retry, 1000, 8000));
          }
        }

        if (downloaded) {
          success++;
          const fileSize = BigInt(fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
          totalDownloadedSize += fileSize;
          await prisma.galleryVideo.update({
            where: { id: video.id },
            data: { localPath: filePath, fileName, fileSize, status: 'completed', completedAt: new Date() },
          });
        } else {
          failed++;
          await prisma.galleryVideo.update({
            where: { id: video.id },
            data: { status: 'failed' },
          });
        }
      } else {
        await prisma.galleryVideo.update({
          where: { id: video.id },
          data: { status: 'downloading' },
        });

        const m3u8Downloaded = await downloadM3U8Video(
          video.url,
          filePath,
          gallery.sourceUrl,
        );

        if (m3u8Downloaded) {
          success++;
          const fileSize = BigInt(fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
          totalDownloadedSize += fileSize;
          await prisma.galleryVideo.update({
            where: { id: video.id },
            data: { localPath: filePath, fileName, fileSize, status: 'completed', completedAt: new Date() },
          });
        } else {
          failed++;
          await prisma.galleryVideo.update({
            where: { id: video.id },
            data: { status: 'failed' },
          });
        }
      }
      if (completedFiles % 5 === 0 || completedFiles === totalFiles) {
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { downloadedSize: totalDownloadedSize },
        });
      }
      emitProgress();
    });

    const allTasks = [...imageTasks, ...videoTasks];
    await this.runConcurrent(allTasks, concurrency, galleryId);

    const totalSizeResult = await prisma.galleryImage.aggregate({
      where: { galleryId, status: 'downloaded' },
      _sum: { fileSize: true },
    });
    const videoSizeResult = await prisma.galleryVideo.aggregate({
      where: { galleryId, status: 'completed' },
      _sum: { fileSize: true },
    });
    const finalTotalSize = (totalSizeResult._sum.fileSize || BigInt(0)) + (videoSizeResult._sum.fileSize || BigInt(0));

    const expectedImages = gallery.images.length;
    const expectedVideos = gallery.videos.length;

    let actualImages = 0;
    let actualVideos = 0;
    if (fs.existsSync(galleryPath)) {
      const files = fs.readdirSync(galleryPath);
      for (const f of files) {
        const ext = path.extname(f).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif'].includes(ext)) {
          actualImages++;
        } else if (['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v'].includes(ext)) {
          actualVideos++;
        }
      }
    }

    console.log(
      `[GalleryDL] Gallery #${galleryId} download stats: ` +
      `success=${success}, failed=${failed}, skipped=${skipped} | ` +
      `disk files: images=${actualImages}/${expectedImages}, videos=${actualVideos}/${expectedVideos}`,
    );

    let finalStatus: string;
    let finalErrorMsg = '';
    if (totalFiles === 0) {
      finalStatus = 'failed';
      finalErrorMsg = 'Scrape result is empty, no images or videos found';
      console.error(`[GalleryDL] Gallery #${galleryId} no downloadable files, scrape result is empty`);
    } else if (failed === 0 && actualImages >= expectedImages && actualVideos >= expectedVideos) {
      finalStatus = 'completed';
    } else if (success > 0) {
      finalStatus = 'partial';
      finalErrorMsg = `Partial download failed, ${failed} failed, disk images ${actualImages}/${expectedImages}, disk videos ${actualVideos}/${expectedVideos}`;
      console.error(
        `[GalleryDL] Gallery #${galleryId} partial download failed: ` +
        `failed=${failed}, disk images=${actualImages}/${expectedImages}, disk videos=${actualVideos}/${expectedVideos}`,
      );
    } else {
      finalStatus = 'failed';
      finalErrorMsg = `All downloads failed, disk images ${actualImages}/${expectedImages}, disk videos ${actualVideos}/${expectedVideos}`;
      console.error(
        `[GalleryDL] Gallery #${galleryId} all downloads failed: ` +
        `disk images=${actualImages}/${expectedImages}, disk videos=${actualVideos}/${expectedVideos}`,
      );
    }

    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        expectedImageCount: expectedImages,
        expectedVideoCount: expectedVideos,
        contentVerified: finalStatus === 'completed',
      },
    });

    const existingGallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { downloadMethod: true },
    });
    const newMethod = existingGallery?.downloadMethod === 'zip' ? 'both' : 'scrape';

    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        status: finalStatus,
        errorMsg: finalErrorMsg,
        totalSize: finalTotalSize,
        downloadedSize: finalTotalSize,
        downloadMethod: newMethod,
        completedAt: finalStatus === 'completed' ? new Date() : undefined,
      },
    });

    const result = { success, failed, skipped, savePath: galleryPath };

    eventBus.emit('gallery:downloadCompleted', {
      galleryId,
      success,
      failed,
      skipped,
      savePath: galleryPath,
      status: finalStatus,
      actualImages,
      actualVideos,
      expectedImages,
      expectedVideos,
    });

    return result;
  }

  
  async retryFailedImages(
    galleryId: number,
  ): Promise<{
    success: number;
    failed: number;
    skipped: number;
    savePath: string;
  }> {
    if (this.downloading.has(galleryId)) {
      throw new AppError(ErrorCode.ERR_ALREADY_DOWNLOADING, `Gallery #${galleryId} is already downloading`);
    }

    const lockKey = `gallery:download:${galleryId}`;
    const lockHandle = await ttlLock.acquire(lockKey, {
      ttl: 600000,
      waitTimeout: 5000,
    });

    if (!lockHandle) {
      throw new AppError(ErrorCode.ERR_ALREADY_DOWNLOADING, `Gallery #${galleryId} is being downloaded by another process`);
    }

    this.downloading.add(galleryId);

    try {
      await prisma.galleryImage.updateMany({
        where: { galleryId, status: 'failed' },
        data: { status: 'pending' },
      });
      await prisma.galleryVideo.updateMany({
        where: { galleryId, status: 'failed' },
        data: { status: 'pending' },
      });

      const result = await this._doDownload(galleryId, getGalleryConcurrency());
      this.galleryRetries.delete(galleryId);
      return result;
    } finally {
      this.downloading.delete(galleryId);
      this.cancelled.delete(galleryId);
      ttlLock.releaseHandle(lockHandle);
    }
  }

  
  private async runConcurrent(
    tasks: (() => Promise<void>)[],
    concurrency: number,
    galleryId?: number,
  ): Promise<void> {
    let index = 0;

    const runNext = async (): Promise<void> => {
      while (index < tasks.length) {
        if (galleryId !== undefined && this.isCancelled(galleryId)) {
          return;
        }
        const taskIndex = index++;
        await tasks[taskIndex]();
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, tasks.length) },
      () => runNext(),
    );

    await Promise.all(workers);
  }
}

const GALLERY_DL_KEY = '__puchipix_gallery_downloader__';

export function getGalleryDownloader(): GalleryDownloader {
  return getOrCreateGlobal(GALLERY_DL_KEY, () => new GalleryDownloader());
}
