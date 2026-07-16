import fs from 'fs';
import { logT } from '@/lib/i18n/server';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/** 等待函数 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 指数退避延迟 */
function backoffDelay(retry: number): number {
  return BASE_DELAY_MS * Math.pow(2, retry);
}

export interface DeleteResult {
  path: string;
  success: boolean;
  error?: string;
}

/**
 * 安全删除单个文件
 *
 * @param filePath - 文件绝对路径
 * @returns 删除结果
 */
export async function safeDeleteFile(filePath: string): Promise<DeleteResult> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { path: filePath, success: true };
  }

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      fs.unlinkSync(filePath);
      // 验证删除成功
      if (!fs.existsSync(filePath)) {
        return { path: filePath, success: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (retry < MAX_RETRIES - 1) {
        console.warn(logT('log.safeDelete.fileFailed', { retry: retry + 1, max: MAX_RETRIES, path: filePath, msg }));
        await sleep(backoffDelay(retry));
      } else {
        console.error(logT('log.safeDelete.fileFinalFailed', { path: filePath, msg }));
        return { path: filePath, success: false, error: msg };
      }
    }
  }

  // 最终检查
  if (!fs.existsSync(filePath)) {
    return { path: filePath, success: true };
  }
  return { path: filePath, success: false, error: 'Unknown error' };
}

/**
 * 安全递归删除目录
 *
 * @param dirPath - 目录绝对路径
 * @returns 删除结果
 */
export async function safeDeleteDir(dirPath: string): Promise<DeleteResult> {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return { path: dirPath, success: true };
  }

  // 检查是否为目录
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      // 如果是文件，用文件删除
      return safeDeleteFile(dirPath);
    }
  } catch {
    // stat 失败说明路径可能已不存在
    return { path: dirPath, success: true };
  }

  for (let retry = 0; retry < MAX_RETRIES; retry++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      // 验证删除成功
      if (!fs.existsSync(dirPath)) {
        return { path: dirPath, success: true };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (retry < MAX_RETRIES - 1) {
        console.warn(logT('log.safeDelete.dirFailed', { retry: retry + 1, max: MAX_RETRIES, path: dirPath, msg }));
        await sleep(backoffDelay(retry));
      } else {
        console.error(logT('log.safeDelete.dirFinalFailed', { path: dirPath, msg }));
        return { path: dirPath, success: false, error: msg };
      }
    }
  }

  // 最终检查
  if (!fs.existsSync(dirPath)) {
    return { path: dirPath, success: true };
  }
  return { path: dirPath, success: false, error: 'Unknown error' };
}

/**
 * 批量安全删除多个路径（文件和目录混合）
 *
 * @param paths - 路径列表（文件或目录）
 * @returns 每个路径的删除结果
 */
export async function safeDeletePaths(paths: string[]): Promise<DeleteResult[]> {
  const results: DeleteResult[] = [];
  for (const p of paths) {
    if (!p) continue;
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        results.push(await safeDeleteDir(p));
      } else {
        results.push(await safeDeleteFile(p));
      }
    } catch {
      // 路径不存在，视为成功
      results.push({ path: p, success: true });
    }
  }
  return results;
}

/**
 * 检查删除结果中是否有失败的
 */
export function hasDeleteFailures(results: DeleteResult[]): boolean {
  return results.some((r) => !r.success);
}

/**
 * 汇总删除结果为日志字符串
 */
export function summarizeDeleteResults(results: DeleteResult[]): string {
  const ok = results.filter((r) => r.success).length;
  const fail = results.length - ok;
  return `删除完成: ${ok} 成功, ${fail} 失败`;
}
