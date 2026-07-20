import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
import { ttlLock } from '@/lib/core/infra/ttl-lock';
import { ErrorCode, AppError } from '@/lib/core/error-codes';
import { parallelDownload, downloadGalleryCover } from '@/lib/downloader';
import {
  generateEnglishZipName,
  detectDownloadSource,
  verifyExtractedContent,
  parseTitleCount,
} from '@/lib/downloader/gallery-content-verifier';
import { sanitizeFilename, extractFilenameFromUrl, retry } from '@/lib/utils';
import { ensureDir } from '@/lib/utils/file-system';
import { loggers } from '@/lib/core/infra/logger';

const logger = loggers.zipDownloader();

import {
  MAX_RETRIES,
  PARALLEL_CHUNK_COUNT,
  getZipRoot,
} from './constants';
import { resolveDirectDownloadUrl } from './url-resolver';
import { extractArchive } from './archive-extractor';

export interface ZipDownloadResult {
  success: boolean;
  status: string;
  localPath: string;
  extractedPath: string;
  actualSize: number;
  fileCount: number;
  downloadSource?: string;
  zipFileName?: string;
  contentVerified?: boolean;
  needsFallbackScrape?: boolean;
  verifyReason?: string;
  error?: string;
}

/**
 *
 * @param galleryId - Graphlibrary ID
 */
export async function downloadAndExtractZip(
  galleryId: number,
  manualUrl?: string,
): Promise<ZipDownloadResult> {
  const lockKey = `gallery:zip:${galleryId}`;
  const lockHandle = await ttlLock.acquire(lockKey, {
    ttl: 300000,
    waitTimeout: 5000,
  });

  if (!lockHandle) {
    throw new AppError(ErrorCode.ERR_ALREADY_DOWNLOADING, `Gallery #${galleryId} ZIP is already downloading`);
  }

  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: { downloadInfo: true },
    });

    if (!gallery) {
      throw new Error(`Gallery #${galleryId} not found`);
    }

    if (!gallery.downloadInfo) {
      throw new Error(`Gallery #${galleryId} has no ZIP download info`);
    }

    const downloadInfo = gallery.downloadInfo;
    const downloadUrl = manualUrl || downloadInfo.downloadUrl;

    if (!downloadUrl) {
      throw new AppError(ErrorCode.ERR_NO_DOWNLOAD_URL, 'No download URL available, please provide manually');
    }

    const downloadSource = detectDownloadSource(downloadUrl);
    const isOuoSource = downloadSource === 'ouo';

    const ext = path.extname(downloadUrl.split('?')[0]) || '.zip';
    const englishZipName = generateEnglishZipName(
      gallery.protagonist,
      gallery.description,
      galleryId,
      ext,
    );

    logger.info(`Download source: ${downloadSource}, English name: ${englishZipName}`);

    const { expectedImages, expectedVideos } = parseTitleCount(gallery.title);

    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        status: 'downloading',
        downloadSource,
        ouoUrl: isOuoSource ? downloadUrl : downloadInfo.ouoUrl,
        zipFileName: englishZipName,
      },
    });

    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        expectedImageCount: expectedImages,
        expectedVideoCount: expectedVideos,
        downloadMethod: 'zip',
      },
    });

    eventBus.emit('gallery:zipDownloadStarted', {
      galleryId,
      url: downloadUrl,
    });

    const zipDir = path.join(getZipRoot(), `gallery_${galleryId}`);
    ensureDir(zipDir);

    const existingArchive = fs.readdirSync(zipDir).find((f) => {
      const lower = f.toLowerCase();
      return lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z');
    });

    let actualZipPath = '';
    let actualSize = BigInt(0);
    let skipDownload = false;

    if (existingArchive) {
      const existingPath = path.join(zipDir, existingArchive);
      const stat = fs.statSync(existingPath);
      if (stat.size > 0) {
        logger.info(`Existing file found: ${existingArchive} (${stat.size} bytes), skipping download`);
        actualZipPath = existingPath;
        actualSize = BigInt(stat.size);
        skipDownload = true;

        await prisma.galleryDownloadInfo.update({
          where: { galleryId },
          data: { status: 'completed', localPath: actualZipPath, actualSize },
        });
      }
    }

    if (!skipDownload) {
      let directUrl = downloadUrl;
      let filename = `gallery_${galleryId}.zip`;
      let refererUrl = downloadUrl;

      const isDirectLink = /\.(zip|rar|7z)(\?|$)/i.test(downloadUrl);

      if (!isDirectLink) {
        logger.info(`Resolving relay: ${downloadUrl}`);

        let resolved: { directUrl: string; filename: string; sourceUrl: string } | null = null;
        let lastError: unknown = null;

        try {
          resolved = await retry(
            () => resolveDirectDownloadUrl(downloadUrl),
            {
              maxRetries: MAX_RETRIES - 1,
              backoff: 'exponential',
              baseDelay: 2000,
              maxDelay: 10000,
              onRetry: (attempt, error) => {
                logger.warn(
                  `Relay resolution failed attempt ${attempt + 1}`,
                  { error: error instanceof Error ? error.message : error },
                );
              },
            },
          );
        } catch (err) {
          lastError = err;
        }

        if (!resolved) {
          const errMsg =
            lastError instanceof Error
              ? `Relay resolution failed: ${lastError.message}`
              : 'Relay resolution failed';

          await prisma.galleryDownloadInfo.update({
            where: { galleryId },
            data: { status: 'failed' },
          });

          eventBus.emit('gallery:zipDownloadFailed', {
            galleryId,
            error: errMsg,
          });

          return {
            success: false,
            status: 'failed',
            localPath: '',
            extractedPath: '',
            actualSize: 0,
            fileCount: 0,
            error: errMsg,
          };
        }

        directUrl = resolved.directUrl;
        filename = resolved.filename || filename;
        refererUrl = resolved.sourceUrl || directUrl;

        await prisma.galleryDownloadInfo.update({
          where: { galleryId },
          data: { resolvedDirectUrl: directUrl },
        });
      } else {
        filename = extractFilenameFromUrl(downloadUrl);
      }

logger.info(`Direct URL: ${directUrl}`);
logger.info(`Filename: ${filename}`);

      const zipFilePath = path.join(zipDir, sanitizeFilename(filename));

      let downloadResult = {
        success: false,
        fileSize: 0,
        savedPath: '',
        parallelism: 0,
        avgSpeed: 0,
      };

      const parallelResult = await retry(
        () => parallelDownload(directUrl, zipFilePath, {
          chunkCount: PARALLEL_CHUNK_COUNT,
          headers: { Referer: refererUrl },
          onProgress: (downloaded, total) => {
            if (total > 0) {
              const pct = Math.round((downloaded / total) * 100);
              eventBus.emit('gallery:zipDownloadProgress', {
                galleryId,
                downloaded,
                total,
                percent: pct,
              });
            }
          },
        }),
        {
          maxRetries: MAX_RETRIES - 1,
          backoff: 'exponential',
          baseDelay: 3000,
          maxDelay: 15000,
          isSuccess: (r) => r.success,
          onRetry: (attempt) => {
            logger.warn(`Download retry attempt ${attempt + 1}`);
          },
        },
      );

      downloadResult = {
        success: parallelResult.success,
        fileSize: parallelResult.fileSize,
        savedPath: parallelResult.savedPath,
        parallelism: parallelResult.parallelism,
        avgSpeed: parallelResult.avgSpeed,
      };

      actualZipPath = downloadResult.savedPath || zipFilePath;

      if (!downloadResult.success || !fs.existsSync(actualZipPath)) {
        const errMsg = 'ZIP file download failed';

        await prisma.galleryDownloadInfo.update({
          where: { galleryId },
          data: { status: 'failed' },
        });

        eventBus.emit('gallery:zipDownloadFailed', { galleryId, error: errMsg });

        return {
          success: false,
          status: 'failed',
          localPath: '',
          extractedPath: '',
          actualSize: 0,
          fileCount: 0,
          error: errMsg,
        };
      }

      actualSize = BigInt(fs.statSync(actualZipPath).size);

      const englishZipPath = path.join(zipDir, englishZipName);
      if (actualZipPath !== englishZipPath) {
        try {
          if (fs.existsSync(englishZipPath)) {
            fs.unlinkSync(englishZipPath);
          }
          fs.renameSync(actualZipPath, englishZipPath);
          actualZipPath = englishZipPath;
          logger.info(`Archive renamed: -> ${englishZipName}`);
        } catch (err) {
          logger.warn('Rename failed, keeping original filename', { error: err instanceof Error ? err.message : err });
        }
      }

      await prisma.galleryDownloadInfo.update({
        where: { galleryId },
        data: {
          status: 'completed',
          localPath: actualZipPath,
          actualSize,
          zipFileName: englishZipName,
          parallelism: downloadResult.parallelism,
          avgSpeed: downloadResult.avgSpeed,
        },
      });

      eventBus.emit('gallery:zipDownloadCompleted', {
        galleryId,
        localPath: actualZipPath,
        actualSize: Number(actualSize),
      });

      logger.info(`ZIP download completed: ${actualZipPath} (${actualSize} bytes)`);
    }

    const extractDir = path.join(
      gallery.savePath || path.join(getZipRoot(), `gallery_${galleryId}`),
      'zip_extracted',
    );
    ensureDir(extractDir);

    logger.info(`Extraction started: ${actualZipPath} -> ${extractDir} (password: ${downloadInfo.password ? 'yes' : 'no'})`);

    const extractResult = await extractArchive(actualZipPath, extractDir, downloadInfo.password || undefined);

    if (!extractResult.success) {
      await prisma.galleryDownloadInfo.update({
        where: { galleryId },
        data: {
          status: 'failed',
          localPath: actualZipPath,
          actualSize,
        },
      });

      eventBus.emit('gallery:zipExtractFailed', {
        galleryId,
        error: 'Extraction failed',
      });

      return {
        success: false,
        status: 'failed',
        localPath: actualZipPath,
        extractedPath: '',
        actualSize: Number(actualSize),
        fileCount: 0,
        error: 'ZIP extraction failed, password may be incorrect',
      };
    }

    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        status: 'completed',
        localPath: actualZipPath,
        extractedPath: extractDir,
        actualSize,
        fileCount: extractResult.fileCount,
      },
    });

    const verification = verifyExtractedContent(extractDir, expectedImages, expectedVideos);

    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        verifiedCount: verification.totalCount,
        countMatched: verification.matched,
      },
    });

    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        contentVerified: true,
      },
    });

    if (!verification.matched) {
      logger.warn(`Content verification failed: ${verification.reason}`);
      eventBus.emit('gallery:zipVerifyFailed', {
        galleryId,
        reason: verification.reason ?? '',
        expectedImages,
        actualImages: verification.imageCount,
        expectedVideos,
        actualVideos: verification.videoCount,
      });
    } else {
      logger.info(`Content verification passed: images ${verification.imageCount}, videos ${verification.videoCount}`);
    }

    eventBus.emit('gallery:zipExtractCompleted', {
      galleryId,
      extractedPath: extractDir,
      fileCount: extractResult.fileCount,
    });

    logger.info(
      `Extraction completed: ${extractDir} ${extractResult.fileCount} files`,
    );

    if (gallery.coverUrl && !gallery.coverLocalPath) {
      const galleryBasePath = gallery.savePath || path.join(getZipRoot(), `gallery_${galleryId}`);
      await downloadGalleryCover(galleryId, gallery.coverUrl, gallery.sourceUrl, galleryBasePath);
    }

    return {
      success: true,
      status: 'completed',
      localPath: actualZipPath,
      extractedPath: extractDir,
      actualSize: Number(actualSize),
      fileCount: extractResult.fileCount,
      downloadSource,
      zipFileName: englishZipName,
      contentVerified: verification.matched,
      needsFallbackScrape: verification.needsFallbackScrape,
      verifyReason: verification.reason,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);

    await prisma.galleryDownloadInfo
      .update({
        where: { galleryId },
        data: { status: 'failed' },
      })
      .catch(() => {});

    eventBus.emit('gallery:zipDownloadFailed', { galleryId, error: errMsg });

    return {
      success: false,
      status: 'failed',
      localPath: '',
      extractedPath: '',
      actualSize: 0,
      fileCount: 0,
      error: errMsg,
    };
  } finally {
    ttlLock.releaseHandle(lockHandle);
  }
}
