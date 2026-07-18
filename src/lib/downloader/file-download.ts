import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { randomUA } from '@/lib/core/stealth/anti-crawler';
import { sanitizeFilename, extractFilenameFromHeaders } from '@/lib/utils';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_REDIRECTS = 5;

export interface DownloadOptions {
  /** 璇锋眰澶达紙浼氫笌榛樿 User-Agent 鍚堝苟锛岃皟鐢ㄦ柟鍙鐩?UA锛?*/
  headers?: Record<string, string>;
  /** 瓒呮椂姣锛堥粯璁?30000锛?*/
  timeout?: number;
  /** 鏈€澶ч噸瀹氬悜娆℃暟锛堥粯璁?5锛?*/
  maxRedirects?: number;
  /** 鏄惁鏀寔鏂偣缁紶锛堥粯璁?false锛夈€備笌 atomic 浜掓枼锛屽悓鏃朵负 true 鏃?atomic 浼樺厛 */
  resume?: boolean;
  /** 杩涘害鍥炶皟 */
  onProgress?: (downloaded: number, total: number) => void;
  /** 鏄惁浠?Content-Disposition 鎻愬彇鏂囦欢鍚嶏紙榛樿 false锛?*/
  extractFilename?: boolean;
  /** User-Agent锛堥粯璁?randomUA()锛?*/
  userAgent?: string;
  /** 鏄惁浣跨敤 .tmp 涓存椂鏂囦欢鍘熷瓙閲嶅懡鍚嶏紙榛樿 false锛?*/
  atomic?: boolean;
}

export interface DownloadResult {
  success: boolean;
  fileSize: number;
  savedPath: string;
}

/**
 * 缁熶竴鏂囦欢涓嬭浇鍑芥暟
 *
 * 鍚堝苟浜?gallery-downloader銆亃ip-downloader銆乻egment-downloader銆乧over-downloader
 * 鍥涘鐙珛瀹炵幇锛岄€氳繃 options 鎺у埗鏂偣缁紶銆佸師瀛愬啓鍏ャ€佽繘搴﹀洖璋冪瓑鐗规€с€?
 *
 * @param url - 涓嬭浇鍦板潃
 * @param filePath - 鐩爣淇濆瓨璺緞
 * @param options - 鍙€夐厤缃?
 * @returns 涓嬭浇缁撴灉锛屽寘鍚垚鍔熸爣蹇椼€佹枃浠跺ぇ灏忓拰瀹為檯淇濆瓨璺緞
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
    // 闈炵画浼犮€侀潪鍘熷瓙妯″紡涓嬶紝宸插瓨鍦ㄦ枃浠剁洿鎺ヨ烦杩?
    if (!resume && !atomic && fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        resolve({ success: true, fileSize: stat.size, savedPath: filePath });
        return;
      }
    }

    // 缁紶妯″紡锛氭鏌ユ湰鍦板凡鏈夋暟鎹ぇ灏?
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
        console.error(`[Download] 閲嶅畾鍚戞鏁拌秴闄? ${requestUrl}`);
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

          // 缁紶澶辫触鏃舵湇鍔″櫒杩斿洖瀹屾暣鍐呭锛岄渶鍒犻櫎鏃х殑閮ㄥ垎鏂囦欢
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
            console.error(`[Download] 鏂囦欢鍐欏叆澶辫触 ${writePath}:`, err instanceof Error ? err.message : String(err));
            try { fs.unlinkSync(writePath); } catch {}
            response.destroy();
            finish({ success: false, fileSize: 0, savedPath: '' });
          });

          response.on('error', (err) => {
            console.error(`[Download] 鍝嶅簲娴侀敊璇?`, err instanceof Error ? err.message : String(err));
            writeStream.close();
            try { fs.unlinkSync(writePath); } catch {}
            finish({ success: false, fileSize: 0, savedPath: '' });
          });
        },
      );

      request.on('error', (err) => {
        console.error(`[Download] 涓嬭浇澶辫触 ${requestUrl}:`, err instanceof Error ? err.message : String(err));
        try { fs.unlinkSync(atomic ? actualPath + '.tmp' : actualPath); } catch {}
        finish({ success: false, fileSize: 0, savedPath: '' });
      });

      request.on('timeout', () => {
        request.destroy();
        console.error(`[Download] 涓嬭浇瓒呮椂: ${requestUrl}`);
        try { fs.unlinkSync(atomic ? actualPath + '.tmp' : actualPath); } catch {}
        finish({ success: false, fileSize: 0, savedPath: '' });
      });
    };

    doRequest(url, 0);
  });
}
