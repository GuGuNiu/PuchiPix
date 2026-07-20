import * as fs from 'fs';
import * as path from 'path';
import type { M3U8Segment } from './m3u8-parser';
import { downloadFileWithDomainFallback } from './domain-fallback';


export interface SegmentTask {
  segment: M3U8Segment;
  destDir: string;
  tsid: string;
  referer?: string;
}

/**
 * SegmentDownloadresult。
 */
export interface SegmentResult {
  index: number;
  tsid: string;
  /** Downloadafter fileFull path */
  filePath: string;
  error?: Error;
  attempts: number;
}


function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    // FNV prime: 16777619
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 *
 *
 *
 * @returns Unique identifier string
 */
export function generateTSID(uri: string, index: number): string {
  const hash = fnv1aHash(uri);
  return `${hash}_${index.toString().padStart(5, '0')}`;
}


/**
 *
 * @param task     - segmentDownloadtask
 */
export async function downloadSegment(
  task: SegmentTask,
  maxRetries: number = 5
): Promise<SegmentResult> {
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

    const result = await downloadFileWithDomainFallback(task.segment.fullURI, filePath, {
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
        `[Segment] 分片 ${task.tsid} 第 ${attempts} 次下载失败: ${lastError.message}` +
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
 *
 * @param segments - M3U8 segmentArray
 */
export function generateAllTSIDs(segments: M3U8Segment[]): string[] {
  return segments.map((seg) => generateTSID(seg.uri, seg.index));
}

/**
 * @param destDir - Segment filedirectory
 */
export function isSegmentDownloaded(destDir: string, tsid: string): boolean {
  const filePath = path.join(destDir, `${tsid}.ts`);
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  return stat.size > 0;
}
