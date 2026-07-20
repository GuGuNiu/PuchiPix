import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { randomUA } from '@/lib/core/stealth/anti-crawler';
import { sanitizeFilename, extractFilenameFromHeaders } from '@/lib/utils';
import { MAX_REDIRECTS, CHUNK_TIMEOUT, type ChunkInfo } from './types';

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
      reject(new Error(`Chunk ${chunk.index}: too many redirects`));
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
              `Chunk ${chunk.index}: HTTP ${response.statusCode}`,
            ),
          );
          return;
        }

        const isFullResponse = response.statusCode === 200;
        if (isFullResponse && chunk.index !== 0) {
          response.resume();
          fs.closeSync(fd);
          reject(new Error(`Chunk ${chunk.index}: server does not support Range requests`));
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
      reject(new Error(`Chunk ${chunk.index}: download timeout`));
    });
  });
}

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
        console.log(`[ParallelDL] Single-thread download started: ${actualPath} (${total} bytes)`);

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
              `[ParallelDL] Progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)`,
            );
            lastLog = downloaded;
          }
        });

        response.on('end', () => writeStream!.end());

        writeStream.on('finish', () => {
          console.log(`[ParallelDL] Download completed: ${actualPath} (${downloaded} bytes)`);
          finish({ success: true, fileSize: downloaded, savedPath: actualPath });
        });

        writeStream.on('error', (err) => {
          console.error(`[ParallelDL] Write failed: ${err.message}`);
          fs.unlink(actualPath, () => {});
          finish({ success: false, fileSize: 0, savedPath: '' });
        });
      },
    );

    req.on('error', (err) => {
      console.error(`[ParallelDL] Request failed: ${err.message}`);
      finish({ success: false, fileSize: 0, savedPath: '' });
    });

    req.on('timeout', () => {
      req.destroy();
      if (writeStream) {
        writeStream.destroy();
      }
      console.error('[ParallelDL] Download timeout');
      finish({ success: false, fileSize: 0, savedPath: '' });
    });
  });
}
