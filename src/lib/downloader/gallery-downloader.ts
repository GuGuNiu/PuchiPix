import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { taskQueueManager } from '@/lib/core/task-queue-manager';
import { ttlLock } from '@/lib/core/ttl-lock';
import { getOrCreateGlobal } from '@/lib/core/global-singleton';
import { backoffDelay, randomProfile, buildStealthHeaders, sleep, DEFAULT_ACCEPT_LANGUAGE } from '@/lib/core/anti-crawler';
import { fetchM3U8Content, parseM3U8 } from './m3u8-parser';
import type { M3U8Segment } from './m3u8-parser';
import { downloadSegment, generateTSID } from './segment-downloader';
import { mergeSegments, verifySegments, cleanupSegments } from './merger';
import { transcodeTS } from '@/lib/transcoder/ffmpeg';
import type { GalleryZipInfo } from '@/types';

const DEFAULT_GALLERY_PATH = './data/galleries';
const DEFAULT_ZIP_PATH = './data/gallery_zips';
const MAX_RETRIES = 3;

function getGalleryConcurrency(): number {
  return taskQueueManager.getDownloadConcurrency().galleryImageConcurrent;
}

function getGalleryRoot(): string {
  return process.env.GALLERY_PATH || DEFAULT_GALLERY_PATH;
}

function getZipRoot(): string {
  return process.env.GALLERY_ZIP_PATH || DEFAULT_ZIP_PATH;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/*?:"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
}

function buildGalleryFolderName(
  galleryId: number,
  title: string,
  protagonist: string,
  description: string,
): string {
  const parts: string[] = [];

  if (protagonist) {
    parts.push(sanitizeFilename(protagonist));
  }

  if (description) {
    parts.push(sanitizeFilename(description));
  }

  if (parts.length === 0 && title) {
    parts.push(sanitizeFilename(title));
  }

  if (parts.length === 0) {
    return `gallery_${galleryId}`;
  }

  return parts.join(' - ');
}

function extractExtension(url: string): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const ext = path.extname(cleanUrl).toLowerCase();
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.ts'].includes(ext)) {
      return ext;
    }
  } catch {
  }
  return '.jpg';
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 根据文件 URL 判断下载类型，生成匹配的请求头
 *
 * Cloudflare 等防护会校验 sec-fetch-dest 和 Referer 的一致性：
 * - 图片请求须用 sec-fetch-dest: image，且 Referer 与图片同域
 * - 文档请求头（sec-fetch-dest: document）会导致图片 403
 *
 * @param url - 文件 URL
 * @param referer - 调用方传入的 Referer（可能跨域）
 * @returns 适配的请求头集合
 *
 */
function buildDownloadHeaders(
  url: string,
  referer?: string,
): Record<string, string> {
  const profile = randomProfile();
  const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|tiff?)(\?|#|$)/i.test(url);

  if (isImage) {
    let imageReferer = '';
    try {
      const parsed = new URL(url);
      imageReferer = `${parsed.protocol}//${parsed.host}/`;
    } catch {
      imageReferer = referer || '';
    }

    const headers: Record<string, string> = {
      'User-Agent': profile.ua,
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Encoding': profile.acceptEncoding,
      'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
      'Connection': 'keep-alive',
      'sec-fetch-dest': 'image',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-site': 'same-origin',
      'Referer': imageReferer,
    };

    if (profile.secChUa) {
      headers['sec-ch-ua'] = profile.secChUa;
      headers['sec-ch-ua-mobile'] = profile.secChUaMobile;
      headers['sec-ch-ua-platform'] = profile.secChUaPlatform;
    }

    return headers;
  }

  return buildStealthHeaders(profile, referer);
}

/**
 * 下载单个文件到指定路径，支持断点续传
 *
 * 若本地已存在部分文件，通过 HTTP Range 头从断点位置继续下载。
 * 服务器不支持 Range 时回退到完整下载。
 */
function downloadFile(
  url: string,
  filePath: string,
  headers: Record<string, string> = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    const existingSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

    const protocol = url.startsWith('https://') ? https : http;

    const requestHeaders: Record<string, string> = {
      ...headers,
      ...buildDownloadHeaders(url, headers.Referer),
    };

    // 本地已有部分数据时尝试断点续传
    if (existingSize > 0) {
      requestHeaders['Range'] = `bytes=${existingSize}-`;
    }

    const request = protocol.get(
      url,
      {
        headers: requestHeaders,
        timeout: 30000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          downloadFile(absoluteRedirect, filePath, headers).then(resolve);
          return;
        }

        // 206 = Partial Content（断点续传成功），200 = 完整内容（服务器不支持 Range 或文件已完成）
        const isResume = response.statusCode === 206;
        const isFullContent = response.statusCode === 200;

        if (!isResume && !isFullContent) {
          console.error(`[GalleryDL] HTTP ${response.statusCode}: ${url}`);
          resolve(false);
          return;
        }

        // 服务器返回完整内容但本地有部分文件：删除旧文件重新写入
        const writeFlags = isResume ? 'a' : 'w';
        if (isFullContent && existingSize > 0) {
          try { fs.unlinkSync(filePath); } catch {}
        }

        const fileStream = fs.createWriteStream(filePath, { flags: writeFlags });
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve(true);
        });

        fileStream.on('error', (err) => {
          console.error(`[GalleryDL] 文件写入失败 ${filePath}:`, err.message);
          fs.unlink(filePath, () => {});
          resolve(false);
        });
      },
    );

    request.on('error', (err) => {
      console.error(`[GalleryDL] 下载失败 ${url}:`, err.message);
      resolve(false);
    });

    request.on('timeout', () => {
      request.destroy();
      console.error(`[GalleryDL] 下载超时: ${url}`);
      resolve(false);
    });
  });
}

/**
 * 下载 M3U8 视频到指定路径
 *
 */
async function downloadM3U8Video(
  m3u8Url: string,
  outputPath: string,
  referer?: string,
): Promise<boolean> {
  const segDir = outputPath + '_segments';
  ensureDir(segDir);

  try {
    const m3u8Content = await fetchM3U8Content(m3u8Url, referer);
    const playlist = parseM3U8(m3u8Content, m3u8Url);

    let segments: M3U8Segment[];

    if (playlist.isMaster && playlist.variants.length > 0) {
      const sorted = [...playlist.variants].sort((a, b) => b.bandwidth - a.bandwidth);
      const variantUrl = sorted[0].fullURI;
      const variantContent = await fetchM3U8Content(variantUrl, referer);
      const variantPlaylist = parseM3U8(variantContent, variantUrl);
      segments = variantPlaylist.segments;
    } else {
      segments = playlist.segments;
    }

    if (segments.length === 0) {
      console.error(`[GalleryDL] M3U8 无分片: ${m3u8Url}`);
      return false;
    }

    const concurrency = 5;
    let segIndex = 0;
    const segResults: { success: boolean; error?: Error }[] = [];

    const runSeg = async (): Promise<void> => {
      while (segIndex < segments.length) {
        const seg = segments[segIndex++];
        const tsid = generateTSID(seg.uri, seg.index);
        const result = await downloadSegment(
          { segment: seg, destDir: segDir, tsid, referer },
          5,
        );
        segResults.push({ success: !result.error, error: result.error });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, segments.length) }, () => runSeg()),
    );

    const failedCount = segResults.filter((r) => !r.success).length;
    if (failedCount > 0) {
      console.error(`[GalleryDL] M3U8 下载失败: ${failedCount}/${segments.length} 个分片失败`);
      return false;
    }

    const verification = verifySegments(segDir, segments.length);
    if (!verification.valid) {
      console.error(`[GalleryDL] M3U8 分片校验失败: 期望 ${segments.length}，实际 ${verification.actualCount}`);
      return false;
    }

    const tsOutputPath = outputPath.replace(/\.\w+$/, '.ts');
    await mergeSegments(segDir, tsOutputPath);
    await transcodeTS(segDir, outputPath);

    try { fs.unlinkSync(tsOutputPath); } catch {}
    await cleanupSegments(segDir).catch(() => {});

    return true;
  } catch (err) {
    console.error(`[GalleryDL] M3U8 下载异常: ${m3u8Url}`, err);
    await cleanupSegments(segDir).catch(() => {});
    return false;
  }
}

export class GalleryDownloader {
  /** 正在下载的图库 ID 集合，防止并发下载同一图库 */
  private downloading: Set<number> = new Set();
  /** 图库自动重试计数（内存态） */
  private galleryRetries: Map<number, number> = new Map();
  /** 已取消的图库 ID 集合，下载循环会检查并提前终止 */
  private cancelled: Set<number> = new Set();
  /** 最大图库级自动重试次数 */
  private static readonly MAX_GALLERY_RETRIES = 1;

  /**
   * 取消指定图库的下载
   *
   * 标记图库为已取消，正在执行的下载循环会在下一个任务前检测并终止。
   * 用于图库被删除时停止后续不必要的下载操作。
   *
   * @param galleryId - 图库 ID
   */
  cancelDownload(galleryId: number): void {
    this.cancelled.add(galleryId);
    this.galleryRetries.delete(galleryId);
  }

  /**
   * 停止所有活跃的图库下载
   *
   * 用于应用优雅关闭时，取消所有正在进行的下载任务。
   * 将所有正在下载的图库标记为已取消，下载循环会在下一个检查点终止。
   */
  stopAll(): void {
    for (const galleryId of this.downloading) {
      this.cancelled.add(galleryId);
    }
    this.galleryRetries.clear();
    console.log(`[GalleryDownloader] 已取消 ${this.downloading.size} 个活跃下载`);
  }

  /** 检查图库是否已被取消 */
  private isCancelled(galleryId: number): boolean {
    return this.cancelled.has(galleryId);
  }

  /**
   * 下载整个图库的所有图片和视频
   *
   * @param galleryId - 图库 ID
   * @param concurrency - 并发下载数（默认从任务设置读取，默认 5）
   * @returns 下载结果（成功/失败计数）
   */
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
      throw new Error(`图库 #${galleryId} 正在下载中`);
    }

    const lockKey = `gallery:download:${galleryId}`;
    const lockHandle = await ttlLock.acquire(lockKey, {
      ttl: 600000,
      waitTimeout: 5000,
    });

    if (!lockHandle) {
      throw new Error(`图库 #${galleryId} 正在被其他进程下载`);
    }

    this.downloading.add(galleryId);

    try {
      let result = await this._doDownload(galleryId, concurrency);

      // 如果下载被取消（图库已删除），跳过重试并返回当前结果
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
          `[GalleryDL] 图库 #${galleryId} 有 ${result.failed} 个文件失败，` +
          `${delayMs / 1000}s 后自动重试...`,
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

        // 重试前检查是否已取消
        if (this.isCancelled(galleryId)) {
          this.cancelled.delete(galleryId);
          return result;
        }

        console.log(`[GalleryDL] 图库 #${galleryId}: 开始自动重试...`);
        result = await this._doDownload(galleryId, concurrency);
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
      throw new Error(`图库 #${galleryId} 不存在`);
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
          coverDownloaded = await downloadFile(gallery.coverUrl, coverFilePath, downloadHeaders);
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
          console.log(`[GalleryDL] 图库 #${galleryId} 封面下载成功: ${coverFilePath}`);
        } else {
          console.error(`[GalleryDL] 图库 #${galleryId} 封面下载失败: ${gallery.coverUrl}`);
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
        downloaded = await downloadFile(img.url, filePath, downloadHeaders);
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
          downloaded = await downloadFile(video.url, filePath, downloadHeaders);
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
      `[GalleryDL] 图库 #${galleryId} 下载统计: ` +
      `成功=${success} 失败=${failed} 跳过=${skipped} | ` +
      `磁盘文件: 图片=${actualImages}/${expectedImages} 视频=${actualVideos}/${expectedVideos}`,
    );

    let finalStatus: string;
    if (totalFiles === 0) {
      finalStatus = 'failed';
      console.error(`[GalleryDL] 图库 #${galleryId} 无可下载文件（爬取结果为空）`);
    } else if (failed === 0 && actualImages >= expectedImages && actualVideos >= expectedVideos) {
      finalStatus = 'completed';
    } else if (success > 0) {
      finalStatus = 'partial';
      console.error(
        `[GalleryDL] 图库 #${galleryId} 部分下载失败: ` +
        `失败=${failed}, 磁盘图片=${actualImages}/${expectedImages}, 磁盘视频=${actualVideos}/${expectedVideos}`,
      );
    } else {
      finalStatus = 'failed';
      console.error(
        `[GalleryDL] 图库 #${galleryId} 全部下载失败: ` +
        `磁盘图片=${actualImages}/${expectedImages}, 磁盘视频=${actualVideos}/${expectedVideos}`,
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

    // 根据已有下载方式更新 downloadMethod
    const existingGallery = await prisma.gallery.findUnique({
      where: { id: galleryId },
      select: { downloadMethod: true },
    });
    const newMethod = existingGallery?.downloadMethod === 'zip' ? 'both' : 'scrape';

    await prisma.gallery.update({
      where: { id: galleryId },
      data: {
        status: finalStatus,
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

  /**
   * 仅重试失败的图片和视频
   *
   * 用于网络中断后的断点续传：已下载完成的文件自动跳过，
   * 仅重新下载状态为 failed 或 pending 的文件。
   *
   * @param galleryId - 图库 ID
   * @returns 下载结果（成功/失败计数）
   */
  async retryFailedImages(
    galleryId: number,
  ): Promise<{
    success: number;
    failed: number;
    skipped: number;
    savePath: string;
  }> {
    if (this.downloading.has(galleryId)) {
      throw new Error(`图库 #${galleryId} 正在下载中`);
    }

    const lockKey = `gallery:download:${galleryId}`;
    const lockHandle = await ttlLock.acquire(lockKey, {
      ttl: 600000,
      waitTimeout: 5000,
    });

    if (!lockHandle) {
      throw new Error(`图库 #${galleryId} 正在被其他进程下载`);
    }

    this.downloading.add(galleryId);

    try {
      // 将 failed 状态重置为 pending
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

  /**
   * 并发执行任务池
   */
  private async runConcurrent(
    tasks: (() => Promise<void>)[],
    concurrency: number,
    galleryId?: number,
  ): Promise<void> {
    let index = 0;

    const runNext = async (): Promise<void> => {
      while (index < tasks.length) {
        // 检查是否已取消（图库被删除时）
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
