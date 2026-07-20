import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { randomUA } from '@/lib/core/stealth/anti-crawler';
import { sanitizeFilename, extractFilenameFromHeaders } from '@/lib/utils';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_REDIRECTS = 5;

export interface DownloadOptions {
  headers?: Record<string, string>;
  timeout?: number;
  /** MaxRedirectcount（default 5） */
  maxRedirects?: number;
  resume?: boolean;
  /** ProgressCallback */
  onProgress?: (downloaded: number, total: number) => void;
  extractFilename?: boolean;
  /** User-Agent（default randomUA()） */
  userAgent?: string;
  atomic?: boolean;
}

export interface DownloadResult {
  success: boolean;
  fileSize: number;
  savedPath: string;
}

/**
 *
 * Merge gallery-downloader、zip-downloader、segment-downloader、cover-downloader
 *
 * @param url - Downloadaddress
 */
export function downloadFile(
  url: string,
  filePath: string,
  options?: DownloadOptions,
): Promise<DownloadResult> {
  const {
    headers = {},
    timeout = DEFAULT_TIMEOUT,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    resume = false,
    onProgress,
    extractFilename = false,
    userAgent = randomUA(),
    atomic = false,
  } = options ?? {};

  return new Promise<DownloadResult>((resolve) => {
    if (!resume && !atomic && fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        resolve({ success: true, fileSize: stat.size, savedPath: filePath });
        return;
      }
    }

    const existingSize = resume && !atomic && fs.existsSync(filePath)
      ? fs.statSync(filePath).size
      : 0;

    const requestHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      ...headers,
    };

    if (resume && existingSize > 0) {
      requestHeaders['Range'] = `bytes=${existingSize}-`;
    }

    let resolved = false;
    let actualPath = filePath;
    let downloaded = 0;
    let total = 0;

    const finish = (result: DownloadResult): void => {
      if (resolved) return;
      resolved = true;
      resolve(result);
    };

    const doRequest = (requestUrl: string, redirects: number): void => {
      if (redirects > maxRedirects) {
        console.error(`[Download] Too many redirects: ${requestUrl}`);
        finish({ success: false, fileSize: 0, savedPath: '' });
        return;
      }

      const protocol = requestUrl.startsWith('https://') ? https : http;

      const request = protocol.get(
        requestUrl,
        {
          headers: requestHeaders,
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
              : new URL(redirectUrl, requestUrl).href;
            doRequest(absoluteRedirect, redirects + 1);
            return;
          }

          const isResume = response.statusCode === 206;
          const isFullContent = response.statusCode === 200;
          const acceptable = resume ? (isResume || isFullContent) : isFullContent;

          if (!acceptable) {
            response.resume();
            console.error(`[Download] HTTP ${response.statusCode}: ${requestUrl}`);
            finish({ success: false, fileSize: 0, savedPath: '' });
            return;
          }

          if (extractFilename) {
            const cdFilename = extractFilenameFromHeaders(response.headers);
            if (cdFilename) {
              const dir = path.dirname(filePath);
              const newPath = path.join(dir, sanitizeFilename(cdFilename));
              if (newPath !== filePath) {
                actualPath = newPath;
              }
            }
          }

          total = parseInt(response.headers['content-length'] || '0', 10);

          const writePath = atomic ? actualPath + '.tmp' : actualPath;
          const writeFlags = isResume && !atomic ? 'a' : 'w';

          if (resume && isFullContent && existingSize > 0 && !atomic) {
            try { fs.unlinkSync(filePath); } catch {}
          }

          const writeStream = fs.createWriteStream(writePath, { flags: writeFlags });

          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            writeStream.write(chunk);
            if (onProgress) onProgress(downloaded, total);
          });

          response.on('end', () => {
            writeStream.end();
          });

          writeStream.on('finish', () => {
            writeStream.close();

            if (atomic) {
              try {
                fs.renameSync(writePath, actualPath);
              } catch {
                try { fs.unlinkSync(writePath); } catch {}
                finish({ success: false, fileSize: 0, savedPath: '' });
                return;
              }
            }

            finish({ success: true, fileSize: downloaded, savedPath: actualPath });
          });

          writeStream.on('error', (err) => {
            console.error(`[Download] File write failed ${writePath}:`, err instanceof Error ? err.message : String(err));
            try { fs.unlinkSync(writePath); } catch {}
            response.destroy();
            finish({ success: false, fileSize: 0, savedPath: '' });
          });

          response.on('error', (err) => {
            console.error(`[Download] Response stream error:`, err instanceof Error ? err.message : String(err));
            writeStream.close();
            try { fs.unlinkSync(writePath); } catch {}
            finish({ success: false, fileSize: 0, savedPath: '' });
          });
        },
      );

      request.on('error', (err) => {
        console.error(`[Download] Download failed ${requestUrl}:`, err instanceof Error ? err.message : String(err));
        try { fs.unlinkSync(atomic ? actualPath + '.tmp' : actualPath); } catch {}
        finish({ success: false, fileSize: 0, savedPath: '' });
      });

      request.on('timeout', () => {
        request.destroy();
        console.error(`[Download] Download timeout: ${requestUrl}`);
        try { fs.unlinkSync(atomic ? actualPath + '.tmp' : actualPath); } catch {}
        finish({ success: false, fileSize: 0, savedPath: '' });
      });
    };

    doRequest(url, 0);
  });
}
