import fs from 'fs';
import https from 'https';
import http from 'http';
import { randomUA } from '@/lib/core/anti-crawler';

const MAX_REDIRECTS_COVER = 5;

/**
 * 下载封面图片到指定路径
 *
 * 简化版图片下载器，携带 Referer 绕过防盗链
 */
export function downloadCoverImage(url: string, filePath: string, referer: string, redirects: number = 0): Promise<boolean> {
  return new Promise((resolve) => {
    if (redirects > MAX_REDIRECTS_COVER) {
      console.error(`[ZipDL] 封面下载重定向次数超限: ${url}`);
      resolve(false);
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
      resolve(true);
      return;
    }

    let imageReferer = referer;
    try {
      const parsed = new URL(url);
      imageReferer = `${parsed.protocol}//${parsed.host}/`;
    } catch {}

    const protocol = url.startsWith('https://') ? https : http;
    const request = protocol.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Referer': imageReferer,
          'sec-fetch-dest': 'image',
          'sec-fetch-mode': 'no-cors',
          'sec-fetch-site': 'same-origin',
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
          downloadCoverImage(absoluteRedirect, filePath, referer, redirects + 1).then(resolve);
          return;
        }

        if (response.statusCode !== 200) {
          console.error(`[ZipDL] 封面下载 HTTP ${response.statusCode}: ${url}`);
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
          console.error(`[ZipDL] 封面文件写入失败 ${filePath}:`, err.message);
          fs.unlink(filePath, () => {});
          resolve(false);
        });
      },
    );

    request.on('error', (err) => {
      console.error(`[ZipDL] 封面下载失败 ${url}:`, err.message);
      resolve(false);
    });

    request.on('timeout', () => {
      request.destroy();
      console.error(`[ZipDL] 封面下载超时: ${url}`);
      resolve(false);
    });
  });
}
