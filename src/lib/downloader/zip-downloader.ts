import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { ttlLock } from '@/lib/core/ttl-lock';
import { sleep, backoffDelay } from '@/lib/core/anti-crawler';
import { parallelDownload } from '@/lib/downloader/parallel-downloader';
import {
  generateEnglishZipName,
  detectDownloadSource,
  verifyExtractedContent,
  parseTitleCount,
} from '@/lib/downloader/gallery-content-verifier';
import { sanitizeFilename, extractFilenameFromUrl } from '@/lib/utils';

import {
  MAX_RETRIES,
  PARALLEL_CHUNK_COUNT,
  getZipRoot,
  ensureDir,
} from './zip-downloader/constants';
import { downloadCoverImage } from './zip-downloader/cover-downloader';
import { resolveDirectDownloadUrl } from './zip-downloader/url-resolver';
import { extractArchive } from './zip-downloader/archive-extractor';

export interface ZipDownloadResult {
  success: boolean;
  status: string;
  localPath: string;
  extractedPath: string;
  actualSize: number;
  fileCount: number;
  /** 下载来源 */
  downloadSource?: string;
  /** 英文 ZIP 文件名 */
  zipFileName?: string;
  /** 内容校验是否通过 */
  contentVerified?: boolean;
  /** 是否需要回退爬虫下载 */
  needsFallbackScrape?: boolean;
  /** 校验不匹配原因 */
  verifyReason?: string;
  error?: string;
}

/**
 * 下载并解压图库的 ZIP 压缩包
 *
 * @param galleryId - 图库 ID
 * @param manualUrl - 手动传入的下载 URL（覆盖数据库中的 URL）
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
    throw new Error(`图库 #${galleryId} 的 ZIP 正在下载中`);
  }

  try {
    const gallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      include: { downloadInfo: true },
    });

    if (!gallery) {
      throw new Error(`图库 #${galleryId} 不存在`);
    }

    if (!gallery.downloadInfo) {
      throw new Error(`图库 #${galleryId} 无 ZIP 下载信息`);
    }

    const downloadInfo = gallery.downloadInfo;
    const downloadUrl = manualUrl || downloadInfo.downloadUrl;

    if (!downloadUrl) {
      throw new Error('无可用下载 URL，请手动提供');
    }

    // 检测下载来源（ouo / mediafire / direct / unknown）
    const downloadSource = detectDownloadSource(downloadUrl);
    const isOuoSource = downloadSource === 'ouo';

    // 生成英文 ZIP 文件名
    const ext = path.extname(downloadUrl.split('?')[0]) || '.zip';
    const englishZipName = generateEnglishZipName(
      gallery.protagonist,
      gallery.description,
      galleryId,
      ext,
    );

    console.log(`[ZipDL] 下载来源: ${downloadSource}, 英文名: ${englishZipName}`);

    const { expectedImages, expectedVideos } = parseTitleCount(gallery.title);

    // 更新状态为下载中，同时保存来源和 ouo URL
    await prisma.galleryDownloadInfo.update({
      where: { galleryId },
      data: {
        status: 'downloading',
        downloadSource,
        ouoUrl: isOuoSource ? downloadUrl : downloadInfo.ouoUrl,
        zipFileName: englishZipName,
      },
    });

    // 更新图库的预期数量和下载方式
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

    // 构建保存路径
    const zipDir = path.join(getZipRoot(), `gallery_${galleryId}`);
    ensureDir(zipDir);

    // 检查目录中是否已有下载好的压缩包（Content-Disposition 可能改了文件名）
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
        console.log(`[ZipDL] 发现已下载文件: ${existingArchive} (${stat.size} bytes)，跳过下载`);
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
      // 阶段 1：解析中转站获取直链
      let directUrl = downloadUrl;
      let filename = `gallery_${galleryId}.zip`;
      let refererUrl = downloadUrl;

      // 判断是否需要解析中转站
      const isDirectLink = /\.(zip|rar|7z)(\?|$)/i.test(downloadUrl);

      if (!isDirectLink) {
        console.log(`[ZipDL] 解析中转站: ${downloadUrl}`);

        let resolved: { directUrl: string; filename: string; sourceUrl: string } | null = null;
        let lastError: unknown = null;

        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          try {
            resolved = await resolveDirectDownloadUrl(downloadUrl);
            break;
          } catch (err) {
            lastError = err;
            console.warn(
              `[ZipDL] 中转站解析失败（第 ${retry + 1} 次）:`,
              err instanceof Error ? err.message : err,
            );
            if (retry < MAX_RETRIES - 1) {
              await sleep(backoffDelay(retry, 2000, 10000));
            }
          }
        }

        if (!resolved) {
          const errMsg =
            lastError instanceof Error
              ? `中转站解析失败: ${lastError.message}`
              : '中转站解析失败';

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

      console.log(`[ZipDL] 直链: ${directUrl}`);
      console.log(`[ZipDL] 文件名: ${filename}`);

      // 阶段 2：多线程下载 ZIP 文件
      const zipFilePath = path.join(zipDir, sanitizeFilename(filename));

      let downloadResult = {
        success: false,
        fileSize: 0,
        savedPath: '',
        parallelism: 0,
        avgSpeed: 0,
      };

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        const parallelResult = await parallelDownload(directUrl, zipFilePath, {
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
        });

        downloadResult = {
          success: parallelResult.success,
          fileSize: parallelResult.fileSize,
          savedPath: parallelResult.savedPath,
          parallelism: parallelResult.parallelism,
          avgSpeed: parallelResult.avgSpeed,
        };

        if (downloadResult.success) break;

        if (retry < MAX_RETRIES - 1) {
          console.warn(`[ZipDL] 下载重试（第 ${retry + 1} 次）`);
          await sleep(backoffDelay(retry, 3000, 15000));
        }
      }

      // 使用实际保存路径（Content-Disposition 可能重命名了文件）
      actualZipPath = downloadResult.savedPath || zipFilePath;

      if (!downloadResult.success || !fs.existsSync(actualZipPath)) {
        const errMsg = 'ZIP 文件下载失败';

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

      // 将压缩包重命名为英文名
      const englishZipPath = path.join(zipDir, englishZipName);
      if (actualZipPath !== englishZipPath) {
        try {
          if (fs.existsSync(englishZipPath)) {
            fs.unlinkSync(englishZipPath);
          }
          fs.renameSync(actualZipPath, englishZipPath);
          actualZipPath = englishZipPath;
          console.log(`[ZipDL] 压缩包重命名: → ${englishZipName}`);
        } catch (err) {
          console.warn(`[ZipDL] 重命名失败，保留原文件名:`, err instanceof Error ? err.message : err);
        }
      }

      // 更新下载信息（含并行数、速度、英文名）
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

      console.log(`[ZipDL] ZIP 下载完成: ${actualZipPath} (${actualSize} bytes)`);
    } // end if (!skipDownload)

    // 阶段 3：解压
    const extractDir = path.join(
      gallery.savePath || path.join(getZipRoot(), `gallery_${galleryId}`),
      'zip_extracted',
    );
    ensureDir(extractDir);

    console.log(`[ZipDL] 开始解压: ${actualZipPath} → ${extractDir} (密码: ${downloadInfo.password ? '有' : '无'})`);

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
        error: '解压失败',
      });

      return {
        success: false,
        status: 'failed',
        localPath: actualZipPath,
        extractedPath: '',
        actualSize: Number(actualSize),
        fileCount: 0,
        error: 'ZIP 解压失败（密码可能不正确）',
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

    // 阶段 4：内容校验
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
      console.warn(`[ZipDL] 内容校验不通过: ${verification.reason}`);
      eventBus.emit('gallery:zipVerifyFailed', {
        galleryId,
        reason: verification.reason ?? '',
        expectedImages,
        actualImages: verification.imageCount,
        expectedVideos,
        actualVideos: verification.videoCount,
      });
    } else {
      console.log(`[ZipDL] 内容校验通过: 图片 ${verification.imageCount}, 视频 ${verification.videoCount}`);
    }

    eventBus.emit('gallery:zipExtractCompleted', {
      galleryId,
      extractedPath: extractDir,
      fileCount: extractResult.fileCount,
    });

    console.log(
      `[ZipDL] 解压完成: ${extractDir}（${extractResult.fileCount} 个文件）`,
    );

    // 阶段 5：下载封面图到 cover/ 子目录（用于资源架展示）
    if (gallery.coverUrl && !gallery.coverLocalPath) {
      const galleryBasePath = gallery.savePath || path.join(getZipRoot(), `gallery_${galleryId}`);
      const coverDir = path.join(galleryBasePath, 'cover');
      if (!fs.existsSync(coverDir)) {
        fs.mkdirSync(coverDir, { recursive: true });
      }
      const coverExt = (() => {
        try {
          const cleanUrl = gallery.coverUrl.split('?')[0].split('#')[0];
          const ext = path.extname(cleanUrl).toLowerCase();
          if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return ext;
        } catch {}
        return '.jpg';
      })();
      const coverFilePath = path.join(coverDir, `cover${coverExt}`);

      if (!fs.existsSync(coverFilePath) || fs.statSync(coverFilePath).size === 0) {
        let coverDownloaded = false;
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          coverDownloaded = await downloadCoverImage(gallery.coverUrl, coverFilePath, gallery.sourceUrl);
          if (coverDownloaded) break;
          if (retry < MAX_RETRIES - 1) {
            await sleep(backoffDelay(retry, 1000, 8000));
          }
        }
        if (coverDownloaded) {
          await prisma.gallery.update({
            where: { id: galleryId },
            data: { coverLocalPath: coverFilePath, savePath: galleryBasePath },
          });
          console.log(`[ZipDL] 图库 #${galleryId} 封面下载成功: ${coverFilePath}`);
        } else {
          console.error(`[ZipDL] 图库 #${galleryId} 封面下载失败: ${gallery.coverUrl}`);
        }
      } else {
        await prisma.gallery.update({
          where: { id: galleryId },
          data: { coverLocalPath: coverFilePath },
        });
      }
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
