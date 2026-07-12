/**
 * 模块：图包下载器
 *
 * 负责将爬取到的图库图片和视频下载到本地文件系统。
 *
 * 目录结构：
 *   data/galleries/
 *   ├── {主角名} - {描述} (galleryId)/
 *   │   ├── 1.jpg
 *   │   ├── 2.jpg
 *   │   ├── ...
 *   │   └── video_original_name.mp4
 *   └── ...
 *
 * 下载策略：
 * - 图片：并发下载（默认 4 线程），自动重试，断点续传
 * - 视频 M3U8：解析播放列表 → 并发下载 TS 分片 → 合并 → 转码 MP4
 * - 图片和视频统一存放于图库根目录，图片按顺序编号，视频保留原始文件名
 * - 通过 EventBus 发布实时进度事件和体积统计
 * - 通过 TTL 锁防止同一图库被重复下载
 *
 * @author PuchiPix Team
 * @date 2026-07-11
 * @lastModified 2026-07-12
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { ttlLock } from '@/lib/core/ttl-lock';
import { backoffDelay, randomProfile, buildStealthHeaders, sleep } from '@/lib/core/anti-crawler';
import { fetchM3U8Content, parseM3U8 } from './m3u8-parser';
import type { M3U8Segment } from './m3u8-parser';
import { downloadSegment, generateTSID } from './segment-downloader';
import { mergeSegments, verifySegments, cleanupSegments } from './merger';
import { transcodeTS } from '@/lib/transcoder/ffmpeg';
import type { GalleryZipInfo } from '@/types';

// ============================================================
// 常量
// ============================================================

const DEFAULT_GALLERY_PATH = './data/galleries';
const DEFAULT_ZIP_PATH = './data/gallery_zips';
const DEFAULT_CONCURRENCY = 4;
const MAX_RETRIES = 3;

// ============================================================
// 工具函数
// ============================================================

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

  return `${parts.join(' - ')} (${galleryId})`;
}

function extractExtension(url: string): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const ext = path.extname(cleanUrl).toLowerCase();
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.ts'].includes(ext)) {
      return ext;
    }
  } catch {
    // 忽略
  }
  return '.jpg';
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 下载单个文件到指定路径
 *
 * 每次重试使用不同的 UA，增加反爬虫兼容性
 */
function downloadFile(
  url: string,
  filePath: string,
  headers: Record<string, string> = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      resolve(true);
      return;
    }

    const protocol = url.startsWith('https://') ? https : http;

    const request = protocol.get(
      url,
      {
        headers: {
          ...buildStealthHeaders(randomProfile()),
          ...headers,
        },
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

        if (response.statusCode !== 200) {
          console.error(`[GalleryDL] HTTP ${response.statusCode}: ${url}`);
          resolve(false);
          return;
        }

        const fileStream = fs.createWriteStream(filePath);
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
 * 完整流程：获取 M3U8 → 解析播放列表 → 并发下载 TS 分片 → 合并 → 转码 MP4 → 清理
 *
 * @date 2026-07-11
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

    const runSeg = async () => {
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

    const tsOutputPath = outputPath.replace(/\.mp4$/, '.ts');
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

// ============================================================
// GalleryDownloader 类
// ============================================================

export class GalleryDownloader {
  /** 正在下载的图库 ID 集合，防止并发下载同一图库 */
  private downloading: Set<number> = new Set();

  /**
   * 下载整个图库的所有图片和视频
   *
   * @param galleryId - 图库 ID
   * @param concurrency - 并发下载数（默认 4）
   * @returns 下载结果（成功/失败计数）
   */
  async downloadGallery(
    galleryId: number,
    concurrency: number = DEFAULT_CONCURRENCY,
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
      return await this._doDownload(galleryId, concurrency);
    } finally {
      this.downloading.delete(galleryId);
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

    let success = 0;
    let failed = 0;
    let skipped = 0;
    let totalDownloadedSize = BigInt(0);

    const totalFiles = gallery.images.length + gallery.videos.length;
    let completedFiles = 0;

    eventBus.emit('gallery:downloadStarted', { galleryId, total: totalFiles });

    const emitProgress = () => {
      completedFiles++;
      eventBus.emit('gallery:downloadProgress', {
        galleryId,
        completed: completedFiles,
        total: totalFiles,
        failed,
      });
    };

    // ----------------------------------------------------------
    // 1. 下载图片（并发）
    // ----------------------------------------------------------

    const imageTasks = gallery.images.map((img, index) => async () => {
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
      // 更新图库下载体积统计
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { downloadedSize: totalDownloadedSize },
      });
      emitProgress();
    });

    await this.runConcurrent(imageTasks, concurrency);

    // ----------------------------------------------------------
    // 2. 下载视频（逐个，避免 M3U8 并发冲突）
    // ----------------------------------------------------------

    for (let i = 0; i < gallery.videos.length; i++) {
      const video = gallery.videos[i];
      // 视频保留原始文件名，不重命名
      const ext = video.url.includes('.m3u8') ? '.mp4' : extractExtension(video.url);
      const originalName = (() => {
        try {
          const cleanUrl = video.url.split('?')[0].split('#')[0];
          const baseName = path.basename(cleanUrl);
          if (baseName && baseName.includes('.')) {
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
        continue;
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
        // M3U8 视频：解析播放列表 → 下载分片 → 合并 → 转码 MP4
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
      // 更新图库下载体积统计
      await prisma.gallery.update({
        where: { id: galleryId },
        data: { downloadedSize: totalDownloadedSize },
      });
      emitProgress();
    }

    // 计算图库总体积（所有已下载文件体积之和）
    const totalSizeResult = await prisma.galleryImage.aggregate({
      where: { galleryId, status: 'downloaded' },
      _sum: { fileSize: true },
    });
    const videoSizeResult = await prisma.galleryVideo.aggregate({
      where: { galleryId, status: 'completed' },
      _sum: { fileSize: true },
    });
    const finalTotalSize = (totalSizeResult._sum.fileSize || BigInt(0)) + (videoSizeResult._sum.fileSize || BigInt(0));

    const finalStatus = failed === 0 ? 'completed' : (success > 0 ? 'partial' : 'failed');

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
    });

    return result;
  }

  /**
   * 并发执行任务池
   */
  private async runConcurrent(
    tasks: (() => Promise<void>)[],
    concurrency: number,
  ): Promise<void> {
    let index = 0;

    const runNext = async (): Promise<void> => {
      while (index < tasks.length) {
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

// ============================================================
// 单例管理
// ============================================================

const GALLERY_DL_KEY = '__galleryDownloaderInstance__';

export function getGalleryDownloader(): GalleryDownloader {
  const g = globalThis as Record<string, unknown>;
  if (!g[GALLERY_DL_KEY]) {
    g[GALLERY_DL_KEY] = new GalleryDownloader();
  }
  return g[GALLERY_DL_KEY] as GalleryDownloader;
}
