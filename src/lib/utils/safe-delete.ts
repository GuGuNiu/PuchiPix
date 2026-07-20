import fs from 'fs';
import { loggers } from '@/lib/core/infra/logger';
import { logT } from '@/lib/i18n/server';
import { retry } from './delay';


const logger = loggers.safeDelete();
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export interface DeleteResult {
  path: string;
  success: boolean;
  error?: string;
}

export async function safeDeleteFile(filePath: string): Promise<DeleteResult> {
  if (!filePath || !fs.existsSync(filePath)) {
    return { path: filePath, success: true };
  }

  try {
    await retry(
      async () => {
        fs.unlinkSync(filePath);
        if (fs.existsSync(filePath)) {
          throw new Error('File still exists after deletion');
        }
      },
      {
        maxRetries: MAX_RETRIES - 1,
        backoff: 'exponential',
        baseDelay: BASE_DELAY_MS,
        onRetry: (attempt, error) => {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warnT('log.safeDelete.fileFailed', { retry: attempt + 1, max: MAX_RETRIES, path: filePath, msg });
        },
      },
    );
    return { path: filePath, success: true };
  } catch (err) {
    if (!fs.existsSync(filePath)) {
      return { path: filePath, success: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.errorT('log.safeDelete.fileFinalFailed', { path: filePath, msg });
    return { path: filePath, success: false, error: msg };
  }
}

export async function safeDeleteDir(dirPath: string): Promise<DeleteResult> {
  if (!dirPath || !fs.existsSync(dirPath)) {
    return { path: dirPath, success: true };
  }

  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return safeDeleteFile(dirPath);
    }
  } catch {
    return { path: dirPath, success: true };
  }

  try {
    await retry(
      async () => {
        fs.rmSync(dirPath, { recursive: true, force: true });
        if (fs.existsSync(dirPath)) {
          throw new Error('Directory still exists after deletion');
        }
      },
      {
        maxRetries: MAX_RETRIES - 1,
        backoff: 'exponential',
        baseDelay: BASE_DELAY_MS,
        onRetry: (attempt, error) => {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warnT('log.safeDelete.dirFailed', { retry: attempt + 1, max: MAX_RETRIES, path: dirPath, msg });
        },
      },
    );
    return { path: dirPath, success: true };
  } catch (err) {
    if (!fs.existsSync(dirPath)) {
      return { path: dirPath, success: true };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.errorT('log.safeDelete.dirFinalFailed', { path: dirPath, msg });
    return { path: dirPath, success: false, error: msg };
  }
}

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
      results.push({ path: p, success: true });
    }
  }
  return results;
}

export function hasDeleteFailures(results: DeleteResult[]): boolean {
  return results.some((r) => !r.success);
}

export function summarizeDeleteResults(results: DeleteResult[]): string {
  const ok = results.filter((r) => r.success).length;
  const fail = results.length - ok;
  return `删除完成: ${ok} 成功, ${fail} 失败`;
}
