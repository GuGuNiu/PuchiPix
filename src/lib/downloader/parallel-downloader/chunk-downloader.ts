import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { randomUA } from '@/lib/core/anti-crawler';
import { sanitizeFilename, extractFilenameFromHeaders } from '@/lib/utils';
import { MAX_REDIRECTS, CHUNK_TIMEOUT, type ChunkInfo } from './types';

/**
 * 下载单个分块到文件的指定位置
 */
export function downloadChunk(
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
 * 单线程下载（降级方案）
 */
export async function singleThreadDownload(
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
