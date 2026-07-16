import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { randomUA } from '@/lib/core/anti-crawler';
import { sanitizeFilename, extractFilenameFromHeaders } from '@/lib/utils';
import { DOWNLOAD_TIMEOUT } from './constants';

const MAX_REDIRECTS_DOWNLOAD = 5;

/**
 * 下载文件到指定路径
 *
 * 支持重定向跟踪和进度回调。
 * 如果目标文件已存在且大小 > 0，视为已下载（断点续传简化版）。
 */
export function downloadFile(
  url: string,
  filePath: string,
  headers: Record<string, string> = {},
  onProgress?: (downloaded: number, total: number) => void,
  redirects: number = 0,
): Promise<{ success: boolean; fileSize: number; savedPath: string }> {
  return new Promise((resolve) => {
    if (redirects > MAX_REDIRECTS_DOWNLOAD) {
      console.error(`[ZipDL] 下载重定向次数超限: ${url}`);
      resolve({ success: false, fileSize: 0, savedPath: '' });
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      resolve({ success: true, fileSize: fs.statSync(filePath).size, savedPath: filePath });
      return;
    }

    const isHttps = url.startsWith('https://');
    const client = isHttps ? https : http;

    let downloaded = 0;
    let total = 0;
    let actualPath = filePath;
    let resolved = false;

    const finish = (result: { success: boolean; fileSize: number; savedPath: string }): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const request = client.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          ...headers,
        },
        timeout: DOWNLOAD_TIMEOUT,
      },
      (response) => {
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          fs.unlink(filePath, () => {});
          const redirectUrl = response.headers.location;
          const absoluteRedirect = redirectUrl.startsWith('http')
            ? redirectUrl
            : new URL(redirectUrl, url).href;
          downloadFile(absoluteRedirect, filePath, headers, onProgress, redirects + 1).then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          response.resume();
          fs.unlink(filePath, () => {});
          console.error(`[ZipDL] HTTP ${response.statusCode}: ${url}`);
          finish({ success: false, fileSize: 0, savedPath: '' });
          return;
        }

        total = parseInt(response.headers['content-length'] || '0', 10);
        console.log(`[ZipDL] 下载开始: ${actualPath} (Content-Length: ${total} bytes)`);

        const cdFilename = extractFilenameFromHeaders(response.headers);
        if (cdFilename) {
          const dir = path.dirname(filePath);
          const newPath = path.join(dir, sanitizeFilename(cdFilename));
          if (newPath !== filePath) {
            actualPath = newPath;
          }
        }

        const writeStream = fs.createWriteStream(actualPath);
        let lastProgressLog = 0;

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          writeStream.write(chunk);
          if (onProgress) onProgress(downloaded, total);
          if (total > 0 && downloaded - lastProgressLog >= 5 * 1024 * 1024) {
            const pct = Math.round((downloaded / total) * 100);
            console.log(`[ZipDL] 下载进度: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`);
            lastProgressLog = downloaded;
          }
        });

        response.on('end', () => {
          writeStream.end();
        });

        writeStream.on('finish', () => {
          console.log(`[ZipDL] 下载完成: ${actualPath} (${downloaded} bytes)`);
          finish({ success: true, fileSize: downloaded, savedPath: actualPath });
        });

        writeStream.on('error', (err) => {
          console.error(`[ZipDL] 文件写入失败 ${actualPath}:`, err.message);
          fs.unlink(actualPath, () => {});
          finish({ success: false, fileSize: 0, savedPath: '' });
        });
      },
    );

    request.on('error', (err) => {
      console.error(`[ZipDL] 下载失败 ${url}:`, err.message);
      fs.unlink(actualPath, () => {});
      finish({ success: false, fileSize: 0, savedPath: '' });
    });

    request.on('timeout', () => {
      request.destroy();
      console.error(`[ZipDL] 下载超时: ${url}`);
      fs.unlink(actualPath, () => {});
      finish({ success: false, fileSize: 0, savedPath: '' });
    });
  });
}
