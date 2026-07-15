import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { randomUA, sleep } from '@/lib/core/anti-crawler';

const DEFAULT_CHUNK_COUNT = 4;
const MAX_CHUNK_COUNT = 8;
const CHUNK_TIMEOUT = 120000;
const MAX_REDIRECTS = 5;

interface ChunkInfo {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  retries: number;
}

export interface ParallelDownloadOptions {
  chunkCount?: number;
  headers?: Record<string, string>;
  /** 进度回调 */
  onProgress?: (downloaded: number, total: number) => void;
  /** 下载超时（毫秒） */
  timeout?: number;
}

export interface DownloadResult {
  success: boolean;
  fileSize: number;
  savedPath: string;
  /** 实际使用的并行数 */
  parallelism: number;
  /** 是否使用了多线程 */
  ranged: boolean;
  /** 平均速度（字节/秒） */
  avgSpeed: number;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/*?:"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
}

function extractFilenameFromHeaders(
  headers: http.IncomingHttpHeaders,
): string | null {
  const cd = headers['content-disposition'];
  if (!cd) return null;
  const match = cd.match(
    /filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i,
  );
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return null;
}

/**
 * 发送 HEAD 请求获取文件元信息
 *
 * 如果 HEAD 请求返回 403/405（某些 CDN 不支持 HEAD），
 * 自动降级为 GET Range: bytes=0-0 探测。
 */
function probeUrl(
  url: string,
  headers: Record<string, string>,
  redirects: number = 0,
): Promise<{
  statusCode: number;
  contentLength: number;
  acceptsRanges: boolean;
  finalUrl: string;
  filename: string | null;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error('重定向次数超限'));
      return;
    }

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    const req = client.request(
      url,
      {
        method: 'HEAD',
        headers: {
          'User-Agent': randomUA(),
          ...headers,
        },
        timeout: 15000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          probeUrl(absoluteRedirect, headers, redirects + 1).then(resolve, reject);
          return;
        }

        // HEAD 请求被拒绝（403/405），降级为 GET Range 探测
        if (response.statusCode === 403 || response.statusCode === 405) {
          response.resume();
          probeUrlWithGet(url, headers, redirects).then(resolve, reject);
          return;
        }

        const contentLength = parseInt(
          response.headers['content-length'] || '0',
          10,
        );
        const acceptsRanges =
          (response.headers['accept-ranges'] || '').toLowerCase() === 'bytes';
        const filename = extractFilenameFromHeaders(response.headers);

        resolve({
          statusCode: response.statusCode || 0,
          contentLength,
          acceptsRanges,
          finalUrl: url,
          filename,
          headers: response.headers,
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HEAD 请求超时'));
    });

    req.end();
  });
}

/**
 * 使用 GET Range: bytes=0-0 探测文件元信息（HEAD 降级方案）
 *
 * 某些 CDN（Cloudflare、MediaFire）不支持 HEAD 请求，
 * 但支持 Range 请求。通过 GET Range: bytes=0-0 获取：
 * - Content-Range 头中的总大小
 * - 206 状态码确认 Range 支持
 */
function probeUrlWithGet(
  url: string,
  headers: Record<string, string>,
  redirects: number = 0,
): Promise<{
  statusCode: number;
  contentLength: number;
  acceptsRanges: boolean;
  finalUrl: string;
  filename: string | null;
  headers: http.IncomingHttpHeaders;
}> {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error('重定向次数超限'));
      return;
    }

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          Range: 'bytes=0-0',
          ...headers,
        },
        timeout: 15000,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          probeUrlWithGet(absoluteRedirect, headers, redirects + 1).then(resolve, reject);
          return;
        }

        response.resume();

        // 从 Content-Range 头解析总大小：格式 "bytes 0-0/12345678"
        const contentRange = response.headers['content-range'] || '';
        let contentLength = 0;
        const rangeMatch = contentRange.match(/\/(\d+)/);
        if (rangeMatch) {
          contentLength = parseInt(rangeMatch[1], 10);
        }

        // 206 状态码或 Content-Range 头存在都说明支持 Range
        const acceptsRanges =
          response.statusCode === 206 || !!contentRange;

        const filename = extractFilenameFromHeaders(response.headers);

        resolve({
          statusCode: 200,
          contentLength,
          acceptsRanges,
          finalUrl: url,
          filename,
          headers: response.headers,
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GET Range 探测超时'));
    });
  });
}

/**
 * 下载单个分块到文件的指定位置
 *
 * 使用 Range 请求获取文件的指定字节范围，
 * 通过 fs.write 直接写入文件的对应偏移位置。
 */
function downloadChunk(
  url: string,
  filePath: string,
  chunk: ChunkInfo,
  headers: Record<string, string>,
  onChunkProgress: (chunkIndex: number, downloaded: number) => void,
  redirects: number = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error(`分块 ${chunk.index}: 重定向次数超限`));
      return;
    }

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    const rangeHeader = `bytes=${chunk.start + chunk.downloaded}-${chunk.end}`;
    const fd = fs.openSync(filePath, 'r+');

    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          Range: rangeHeader,
          ...headers,
        },
        timeout: CHUNK_TIMEOUT,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          fs.closeSync(fd);
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          downloadChunk(
            absoluteRedirect,
            filePath,
            chunk,
            headers,
            onChunkProgress,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }

        if (response.statusCode !== 206 && response.statusCode !== 200) {
          response.resume();
          fs.closeSync(fd);
          reject(
            new Error(
              `分块 ${chunk.index}: HTTP ${response.statusCode}`,
            ),
          );
          return;
        }

        // 如果服务器返回 200 而非 206，说明不支持 Range，整个文件会返回
        // 此时只有第一个块应该继续，其他块需要放弃
        const isFullResponse = response.statusCode === 200;
        if (isFullResponse && chunk.index !== 0) {
          response.resume();
          fs.closeSync(fd);
          reject(new Error(`分块 ${chunk.index}: 服务器不支持 Range 请求`));
          return;
        }

        let writeOffset = isFullResponse ? 0 : chunk.start + chunk.downloaded;

        response.on('data', (data: Buffer) => {
          fs.writeSync(fd, data, 0, data.length, writeOffset);
          writeOffset += data.length;
          chunk.downloaded += data.length;
          onChunkProgress(chunk.index, chunk.downloaded);
        });

        response.on('end', () => {
          fs.closeSync(fd);
          resolve();
        });

        response.on('error', (err) => {
          fs.closeSync(fd);
          reject(err);
        });
      },
    );

    req.on('error', (err) => {
      try { fs.closeSync(fd); } catch {}
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      try { fs.closeSync(fd); } catch {}
      reject(new Error(`分块 ${chunk.index}: 下载超时`));
    });
  });
}

/**
 * 多线程并行下载文件
 *
 * 策略：
 - 先探测目标 URL：获取文件大小、是否支持 Range、文件名
 - 如果支持 Range 且文件 > 5MB，使用多线程分块下载
 - 否则降级为单线程下载
 *
 * @param url - 下载直链
 * @param filePath - 保存路径（会在需要时根据 Content-Disposition 调整）
 * @param options - 下载选项
 *
 */
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

  // 探测文件信息（HEAD 失败时自动降级为 GET Range）
  let probe;
  try {
    probe = await probeUrl(url, headers);
  } catch (err) {
    // HEAD 请求网络错误，尝试 GET Range 降级探测
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

  // 文件小于 5MB 或不支持 Range，使用单线程
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

  // 预分配文件空间
  if (fs.existsSync(actualPath)) {
    fs.unlinkSync(actualPath);
  }
  const fd = fs.openSync(actualPath, 'w');
  fs.ftruncateSync(fd, totalSize);
  fs.closeSync(fd);

  // 分配块
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

  // 进度跟踪
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

  // 并行下载所有块（带重试）
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
          // 指数退避
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

  // 验证文件大小
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

/**
 * 单线程下载（降级方案）
 *
 * 与并行下载保持相同的接口，但只使用单个连接。
 * 处理重定向、Content-Disposition 文件名提取。
 */
async function singleThreadDownload(
  url: string,
  filePath: string,
  headers: Record<string, string>,
  onProgress?: (downloaded: number, total: number) => void,
  timeout: number = 300000,
): Promise<{ success: boolean; fileSize: number; savedPath: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result: { success: boolean; fileSize: number; savedPath: string }): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;
    let downloaded = 0;
    let total = 0;
    let actualPath = filePath;
    let writeStream: fs.WriteStream | null = null;

    const req = client.get(
      url,
      {
        headers: { 'User-Agent': randomUA(), ...headers },
        timeout,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          singleThreadDownload(absoluteRedirect, filePath, headers, onProgress, timeout).then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          console.error(`[ParallelDL] HTTP ${response.statusCode}: ${url}`);
          finish({ success: false, fileSize: 0, savedPath: '' });
          return;
        }

        total = parseInt(response.headers['content-length'] || '0', 10);
        console.log(`[ParallelDL] 单线程下载开始: ${actualPath} (${total} bytes)`);

        const cdFilename = extractFilenameFromHeaders(response.headers);
        if (cdFilename) {
          const dir = path.dirname(filePath);
          const newPath = path.join(dir, sanitizeFilename(cdFilename));
          if (newPath !== filePath) actualPath = newPath;
        }

        writeStream = fs.createWriteStream(actualPath);
        let lastLog = 0;

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          writeStream!.write(chunk);
          if (onProgress) onProgress(downloaded, total);
          if (total > 0 && downloaded - lastLog >= 5 * 1024 * 1024) {
            const pct = Math.round((downloaded / total) * 100);
            console.log(
              `[ParallelDL] 进度: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`,
            );
            lastLog = downloaded;
          }
        });

        response.on('end', () => writeStream!.end());

        writeStream.on('finish', () => {
          console.log(`[ParallelDL] 下载完成: ${actualPath} (${downloaded} bytes)`);
          finish({ success: true, fileSize: downloaded, savedPath: actualPath });
        });

        writeStream.on('error', (err) => {
          console.error(`[ParallelDL] 写入失败: ${err.message}`);
          fs.unlink(actualPath, () => {});
          finish({ success: false, fileSize: 0, savedPath: '' });
        });
      },
    );

    req.on('error', (err) => {
      console.error(`[ParallelDL] 请求失败: ${err.message}`);
      finish({ success: false, fileSize: 0, savedPath: '' });
    });

    req.on('timeout', () => {
      req.destroy();
      if (writeStream) {
        writeStream.destroy();
      }
      console.error('[ParallelDL] 下载超时');
      finish({ success: false, fileSize: 0, savedPath: '' });
    });
  });
}
