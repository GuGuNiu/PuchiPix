import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import type { M3U8Segment } from './m3u8-parser';

/**
 * 单个分片的下载任务描述。
 */
export interface SegmentTask {
  /** M3U8 分片元数据（包含 URI、完整 URL、时长、序号） */
  segment: M3U8Segment;
  /** 分片文件保存目录（绝对路径或相对路径） */
  destDir: string;
  /** 分片的唯一标识符，用于文件命名和排序 */
  tsid: string;
  /** 可选的 Referer 头，用于绕过 CDN 防盗链（通常为视频页面 URL） */
  referer?: string;
}

/**
 * 分片下载结果。
 */
export interface SegmentResult {
  /** 分片在播放列表中的序号 */
  index: number;
  /** 分片的唯一标识符 */
  tsid: string;
  /** 下载后的文件完整路径 */
  filePath: string;
  /** 下载过程中发生的错误（如果有），不等于 undefined 表示该分片下载失败 */
  error?: Error;
  /** 实际尝试下载的次数（含首次） */
  attempts: number;
}

/**
 * 使用 FNV-1a 32 位哈希算法生成分片 URI 的哈希值。
 *
 * FNV-1a 算法相比简单哈希具有更好的分布性和更低的碰撞率，
 * 适合对 URL 字符串进行快速哈希。
 *
 * @param str - 待哈希的字符串（通常是分片的 URI）
 * @returns 8 位十六进制哈希字符串
 */
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV prime: 16777619
    hash = Math.imul(hash, 0x01000193);
  }
  // 转为无符号 32 位整数后输出 8 位 hex
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 为分片生成全局唯一标识符（TSID）。
 *
 * 格式: {fnv1a_hash_8chars}_{index_padded_5digits}
 * 示例: a1b2c3d4_00042
 *
 * - hash 部分：基于分片完整 URI 的 FNV-1a 哈希，确保不同 URI 不会冲突。
 * - index 部分：分片在 M3U8 播放列表中的顺序序号，补零至 5 位，确保排序正确。
 *
 * 这样即使分片 URI 相同（极少见），index 不同也能区分；
 * 而 index 相同但 URI 不同时，hash 不同也能区分。
 *
 * @param uri - 分片的 URI（用于计算哈希）
 * @param index - 分片在播放列表中的序号
 * @returns 唯一标识符字符串
 */
export function generateTSID(uri: string, index: number): string {
  const hash = fnv1aHash(uri);
  return `${hash}_${index.toString().padStart(5, '0')}`;
}

/**
 * 使用 Node.js 原生 http/https 模块下载文件到指定路径。
 *
 * 特性：
 * - 支持 HTTPS 和 HTTP 协议自动选择。
 * - 支持自动跟随 301/302/307 重定向。
 * - 使用 .tmp 临时文件写入，完成后原子重命名，避免半成品文件。
 * - 支持 Referer 头用于 CDN 防盗链。
 * - 30 秒超时保护。
 *
 * @param url      - 要下载的文件 URL
 * @param destPath - 目标保存路径（最终文件名）
 * @param referer  - 可选的 Referer 请求头
 * @returns Promise<void>，下载成功时 resolve，失败时 reject
 */
function downloadFile(url: string, destPath: string, referer?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 根据协议选择 http 或 https 模块
    const protocol = url.startsWith('https') ? https : http;
    const parsedUrl = new URL(url);

    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
    };

    if (referer) {
      headers['Referer'] = referer;
    }

    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers,
      timeout: 30000,
    };

    const req = protocol.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        // 递归跟随重定向，保持相同的 Referer
        downloadFile(redirectUrl, destPath, referer).then(resolve).catch(reject);
        return;
      }

      // 非 200 状态码视为错误
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      // 使用临时文件写入，完成后原子重命名
      const tmpPath = destPath + '.tmp';
      const fileStream = fs.createWriteStream(tmpPath);

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        try {
          fs.renameSync(tmpPath, destPath);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      fileStream.on('error', (err) => {
        fileStream.close();
        try {
          fs.unlinkSync(tmpPath);
        } catch {
        }
        reject(err);
      });

      res.on('error', (err) => {
        fileStream.close();
        try {
          fs.unlinkSync(tmpPath);
        } catch {
        }
        reject(err);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Request timeout (30s)'));
    });

    // 请求错误
    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * 下载单个 M3U8 分片，支持最大重试次数。
 *
 * 重试策略：
 * - 首次尝试失败后，按指数退避策略等待后重试。
 * - 退避时间: 1s → 2s → 4s → 8s → 16s（第 1~5 次重试）。
 * - 每次重试前清理上次下载的残留文件。
 * - 如果文件已存在且大小 > 0，视为已下载完成（断点续传支持）。
 *
 * @param task     - 分片下载任务
 * @param maxRetries - 最大重试次数（默认 5 次，即首次失败后最多再试 5 次）
 * @returns SegmentResult，包含下载结果和尝试次数
 */
export async function downloadSegment(
  task: SegmentTask,
  maxRetries: number = 5
): Promise<SegmentResult> {
  // 构建分片文件完整路径
  const filePath = path.join(task.destDir, `${task.tsid}.ts`);
  const baseDelay = 1000;
  let lastError: Error | undefined;
  let attempts = 0;

  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 0) {
      return {
        index: task.segment.index,
        tsid: task.tsid,
        filePath,
        attempts: 0,
      };
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++;

    try {
      // 非首次尝试时，按指数退避策略等待
      if (attempt > 0) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // 1s, 2s, 4s, 8s, 16s
        await new Promise((r) => setTimeout(r, delay));
      }

      await downloadFile(task.segment.fullURI, filePath, task.referer);

      // 下载成功，验证文件大小（防止空文件）
      const stat = fs.statSync(filePath);
      if (stat.size === 0) {
        throw new Error(`Downloaded file is empty (0 bytes)`);
      }

      return {
        index: task.segment.index,
        tsid: task.tsid,
        filePath,
        attempts,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (fs.existsSync(filePath + '.tmp')) fs.unlinkSync(filePath + '.tmp');
      } catch {
      }

      if (attempt < maxRetries) {
        console.warn(
          `[Segment] 分片 ${task.tsid} 第 ${attempts} 次下载失败: ${lastError.message}，` +
          `${attempt < maxRetries ? `将在 ${baseDelay * Math.pow(2, attempt)}ms 后重试...` : '已达最大重试次数'}`
        );
      }
    }
  }

  return {
    index: task.segment.index,
    tsid: task.tsid,
    filePath,
    error: lastError || new Error('All retries exhausted'),
    attempts,
  };
}

/**
 * 批量生成所有分片的 TSID 列表。
 * 用于在下载前预先生成完整的分片清单，便于后续校验。
 *
 * @param segments - M3U8 分片数组
 * @returns TSID 字符串数组，与 segments 一一对应
 */
export function generateAllTSIDs(segments: M3U8Segment[]): string[] {
  return segments.map((seg) => generateTSID(seg.uri, seg.index));
}

/**
 * 检查分片文件是否已存在且有效（大小 > 0）。
 *
 * @param destDir - 分片文件目录
 * @param tsid    - 分片唯一标识符
 * @returns true 如果文件存在且有效
 */
export function isSegmentDownloaded(destDir: string, tsid: string): boolean {
  const filePath = path.join(destDir, `${tsid}.ts`);
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  return stat.size > 0;
}
