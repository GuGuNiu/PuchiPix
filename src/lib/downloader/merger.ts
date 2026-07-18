import * as fs from 'fs';
import * as path from 'path';
import { ensureDir } from '@/lib/utils/file-system';

/**
 * 合并操作的返回结果。
 */
export interface MergeResult {
  /** 实际合并的分片文件数 */
  totalFiles: number;
  /** 合并后文件的总大小（字节） */
  totalSize: number;
}

/**
 * 将 TS 分片合并为单个文件。
 *
 * @param segDir     - 分片文件所在目录
 * @param outputPath - 合并后输出文件路径
 * @returns MergeResult 包含文件数和总大小
 * @throws 如果目录不存在、无分片文件、或存在空文件
 */
export async function mergeSegments(
  segDir: string,
  outputPath: string
): Promise<MergeResult> {
  const dirPath = path.resolve(segDir);

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Segment directory does not exist: ${dirPath}`);
  }

  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.tmp')
  );

  if (files.length === 0) {
    throw new Error('No .ts segment files found to merge');
  }

  files.sort((a, b) => {
    const idxA = parseInt(a.match(/_(\d+)\.ts$/)?.[1] || '0', 10);
    const idxB = parseInt(b.match(/_(\d+)\.ts$/)?.[1] || '0', 10);
    return idxA - idxB;
  });

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      throw new Error(`Segment file is empty (0 bytes): ${file}`);
    }
  }

  // 确保输出目录存在
  ensureDir(path.dirname(outputPath));

  const writeStream = fs.createWriteStream(outputPath);
  let totalSize = 0;

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const data = fs.readFileSync(filePath);
    totalSize += data.length;
    writeStream.write(data);
  }

  return new Promise<MergeResult>((resolve, reject) => {
    writeStream.on('finish', () => {
      resolve({ totalFiles: files.length, totalSize });
    });
    writeStream.on('error', (err) => {
      reject(err);
    });
    writeStream.end();
  });
}

/**
 * 验证所有分片文件是否齐全且有效。
 *
 * @param segDir        - 分片文件目录
 * @param expectedCount - 期望的分片数量（来自 M3U8 解析）
 * @returns 校验结果对象
 */
export function verifySegments(
  segDir: string,
  expectedCount: number
): { valid: boolean; missing: number[]; emptyFiles: string[]; totalSize: number; actualCount: number } {
  const dirPath = path.resolve(segDir);

  // 目录不存在
  if (!fs.existsSync(dirPath)) {
    return {
      valid: false,
      missing: Array.from({ length: expectedCount }, (_, i) => i),
      emptyFiles: [],
      totalSize: 0,
      actualCount: 0,
    };
  }

  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.tmp')
  );

  const foundIndices = new Set<number>();
  const emptyFiles: string[] = [];
  let totalSize = 0;

  for (const file of files) {
    const match = file.match(/_(\d+)\.ts$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      foundIndices.add(idx);
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      totalSize += stat.size;
      if (stat.size === 0) {
        emptyFiles.push(file);
      }
    }
  }

  // 查找缺失的序号
  const missing: number[] = [];
  for (let i = 0; i < expectedCount; i++) {
    if (!foundIndices.has(i)) {
      missing.push(i);
    }
  }

  return {
    valid: missing.length === 0 && emptyFiles.length === 0,
    missing,
    emptyFiles,
    totalSize,
    actualCount: files.length,
  };
}

/**
 * 递归清理分片目录及其所有内容。
 *
 * @param segDir - 要清理的目录路径
 */
export async function cleanupSegments(segDir: string): Promise<void> {
  if (!fs.existsSync(segDir)) return;

  const entries = fs.readdirSync(segDir);
  for (const entry of entries) {
    const fullPath = path.join(segDir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      fs.unlinkSync(fullPath);
    } else if (stat.isDirectory()) {
      await cleanupSegments(fullPath);
    }
  }

  fs.rmdirSync(segDir);
}
