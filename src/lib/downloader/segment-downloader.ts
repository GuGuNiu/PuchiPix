import * as fs from 'fs';
import * as path from 'path';
import type { M3U8Segment } from './m3u8-parser';
import { downloadFile } from './file-download';

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
 * FNV-1a 算法具有较好的分布性和较低的碰撞率，
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

    if (attempt > 0) {
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }

    const headers: Record<string, string> = {
      Accept: '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
    };
    if (task.referer) {
      headers['Referer'] = task.referer;
    }

    const result = await downloadFile(task.segment.fullURI, filePath, {
      headers,
      atomic: true,
    });

    if (result.success) {
      const stat = fs.statSync(filePath);
      if (stat.size === 0) {
        lastError = new Error('Downloaded file is empty (0 bytes)');
      } else {
        return {
          index: task.segment.index,
          tsid: task.tsid,
          filePath,
          attempts,
        };
      }
    } else {
      lastError = new Error(`Download failed for ${task.segment.fullURI}`);
    }

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(filePath + '.tmp')) fs.unlinkSync(filePath + '.tmp');
    } catch {
    }

    if (attempt < maxRetries) {
      console.warn(
        `[Segment] 分片 ${task.tsid} 第 ${attempts} 次下载失败: ${lastError.message}，` +
        `将在 ${baseDelay * Math.pow(2, attempt)}ms 后重试...`
      );
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
