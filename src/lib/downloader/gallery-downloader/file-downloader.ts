import fs from 'fs';
import https from 'https';
import http from 'http';
import { buildDownloadHeaders } from './utils';

/**
 * 下载单个文件到指定路径，支持断点续传
 *
 * 若本地已存在部分文件，通过 HTTP Range 头从断点位置继续下载。
 * 服务器不支持 Range 时回退到完整下载。
 */
export function downloadFile(
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
