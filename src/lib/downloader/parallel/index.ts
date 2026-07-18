import fs from 'fs';
import path from 'path';
import { sleep } from '@/lib/core/stealth/anti-crawler';
import { sanitizeFilename } from '@/lib/utils';
import {
  DEFAULT_CHUNK_COUNT,
  MAX_CHUNK_COUNT,
  type ChunkInfo,
  type ParallelDownloadOptions,
  type DownloadResult,
} from './types';
import { probeUrl, probeUrlWithGet } from './probe';
import { downloadChunk, singleThreadDownload } from './chunk-downloader';

export async function parallelDownload(
  url: string,
  filePath: string,
  options: ParallelDownloadOptions = {},
): Promise<DownloadResult> {
  const {
    chunkCount = DEFAULT_CHUNK_COUNT,
    headers = {},
    onProgress,
    timeout = 300000,
  } = options;

  const startTime = Date.now();

  let probe;
  try {
    probe = await probeUrl(url, headers);
  } catch (err) {
    console.warn('[ParallelDL] HEAD 探测失败，降级为 GET Range:', err instanceof Error ? err.message : err);
    try {
      probe = await probeUrlWithGet(url, headers);
    } catch (err2) {
      console.error('[ParallelDL] GET Range 探测也失败:', err2 instanceof Error ? err2.message : err2);
      return {
        success: false,
        fileSize: 0,
        savedPath: '',
        parallelism: 0,
        ranged: false,
        avgSpeed: 0,
      };
    }
  }

  if (probe.statusCode !== 200) {
    console.error(`[ParallelDL] HTTP ${probe.statusCode}: ${url}`);
    return {
      success: false,
      fileSize: 0,
      savedPath: '',
      parallelism: 0,
      ranged: false,
      avgSpeed: 0,
    };
  }

  let actualPath = filePath;
  if (probe.filename) {
    const dir = path.dirname(filePath);
    const newPath = path.join(dir, sanitizeFilename(probe.filename));
    if (newPath !== filePath) {
      actualPath = newPath;
    }
  }

  const totalSize = probe.contentLength;
  console.log(
    `[ParallelDL] 文件大小: ${totalSize} bytes (${(totalSize / 1024 / 1024).toFixed(1)} MB), Range 支持: ${probe.acceptsRanges}`,
  );

  const useParallel = probe.acceptsRanges && totalSize > 5 * 1024 * 1024;
  const actualChunks = useParallel
    ? Math.min(chunkCount, MAX_CHUNK_COUNT)
    : 1;

  if (!useParallel) {
    console.log('[ParallelDL] 降级为单线程下载');
    const result = await singleThreadDownload(
      probe.finalUrl,
      actualPath,
      headers,
      onProgress,
      timeout,
    );
    return {
      ...result,
      parallelism: 1,
      ranged: false,
      avgSpeed:
        result.fileSize > 0
          ? Math.round((result.fileSize / (Date.now() - startTime)) * 1000)
          : 0,
    };
  }

  if (fs.existsSync(actualPath)) {
    fs.unlinkSync(actualPath);
  }
  const fd = fs.openSync(actualPath, 'w');
  fs.ftruncateSync(fd, totalSize);
  fs.closeSync(fd);

  const chunkSize = Math.ceil(totalSize / actualChunks);
  const chunks: ChunkInfo[] = [];
  for (let i = 0; i < actualChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize - 1, totalSize - 1);
    chunks.push({
      index: i,
      start,
      end,
      downloaded: 0,
      retries: 0,
    });
  }

  console.log(`[ParallelDL] 使用 ${actualChunks} 线程并行下载，每块约 ${(chunkSize / 1024 / 1024).toFixed(1)} MB`);

  let lastProgressLog = 0;
  const trackProgress = (): void => {
    const downloaded = chunks.reduce((sum, c) => sum + c.downloaded, 0);
    if (onProgress) onProgress(downloaded, totalSize);
    if (
      totalSize > 0 &&
      downloaded - lastProgressLog >= 5 * 1024 * 1024
    ) {
      const pct = Math.round((downloaded / totalSize) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? (downloaded / 1024 / 1024 / elapsed).toFixed(1) : '0';
      console.log(
        `[ParallelDL] 进度: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(totalSize / 1024 / 1024).toFixed(1)} MB, ${speed} MB/s)`,
      );
      lastProgressLog = downloaded;
    }
  };

  const chunkPromises = chunks.map(async (chunk) => {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await downloadChunk(
          probe.finalUrl,
          actualPath,
          chunk,
          headers,
          (_idx, _downloaded) => trackProgress(),
        );
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ParallelDL] 分块 ${chunk.index} 失败（第 ${attempt + 1} 次）: ${msg}`,
        );
        chunk.retries = attempt + 1;
        if (attempt < maxRetries) {
          const delay = Math.min(2000 * Math.pow(2, attempt), 10000);
          await sleep(delay + Math.random() * 1000);
        } else {
          throw new Error(`分块 ${chunk.index} 下载失败（重试 ${maxRetries} 次）: ${msg}`);
        }
      }
    }
  });

  try {
    await Promise.all(chunkPromises);
  } catch (err) {
    console.error('[ParallelDL] 下载失败:', err instanceof Error ? err.message : err);
    return {
      success: false,
      fileSize: 0,
      savedPath: actualPath,
      parallelism: actualChunks,
      ranged: true,
      avgSpeed: 0,
    };
  }

  const elapsedSec = (Date.now() - startTime) / 1000;
  const avgSpeed = elapsedSec > 0 ? Math.round(totalSize / elapsedSec) : 0;

  const stat = fs.statSync(actualPath);
  if (stat.size !== totalSize) {
    console.error(
      `[ParallelDL] 文件大小不匹配: 期望 ${totalSize}，实际 ${stat.size}`,
    );
    return {
      success: false,
      fileSize: stat.size,
      savedPath: actualPath,
      parallelism: actualChunks,
      ranged: true,
      avgSpeed,
    };
  }

  console.log(
    `[ParallelDL] 下载完成: ${actualPath} (${totalSize} bytes, ${(avgSpeed / 1024).toFixed(0)} KB/s)`,
  );

  return {
    success: true,
    fileSize: totalSize,
    savedPath: actualPath,
    parallelism: actualChunks,
    ranged: true,
    avgSpeed,
  };
}
