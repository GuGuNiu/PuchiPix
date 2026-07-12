/**
 * merger.ts — TS 分片合并器
 *
 * 职责：
 * 1. 将下载完成的 TS 分片按序号顺序合并为单个 TS 文件。
 * 2. 合并前校验所有分片是否齐全且有效（非空文件）。
 * 3. 合并后返回合并统计信息（文件数、总大小）。
 * 4. 清理临时分片文件。
 *
 * 合并策略：
 * - 读取分片目录下所有 .ts 文件。
 * - 按文件名中的序号（TSID 的 index 部分）升序排序，确保播放顺序正确。
 * - 使用流式写入方式拼接，避免一次性加载所有分片到内存。
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 合并结果类型
// ============================================================

/**
 * 合并操作的返回结果。
 */
export interface MergeResult {
  /** 实际合并的分片文件数 */
  totalFiles: number;
  /** 合并后文件的总大小（字节） */
  totalSize: number;
}

// ============================================================
// 分片合并
// ============================================================

/**
 * 将 TS 分片合并为单个文件。
 *
 * 流程：
 * 1. 检查分片目录是否存在。
 * 2. 读取所有 .ts 文件，按 index 序号排序。
 * 3. 校验没有空文件（大小为 0 的文件）。
 * 4. 逐个读取分片数据，写入输出文件。
 * 5. 返回合并统计信息。
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

  // 1. 检查目录是否存在
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Segment directory does not exist: ${dirPath}`);
  }

  // 2. 读取所有 .ts 分片文件（排除 .tmp 临时文件）
  const files = fs.readdirSync(dirPath).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.tmp')
  );

  if (files.length === 0) {
    throw new Error('No .ts segment files found to merge');
  }

  // 3. 按 TSID 中的序号排序（格式: {hash}_{NNNNN}.ts）
  files.sort((a, b) => {
    const idxA = parseInt(a.match(/_(\d+)\.ts$/)?.[1] || '0', 10);
    const idxB = parseInt(b.match(/_(\d+)\.ts$/)?.[1] || '0', 10);
    return idxA - idxB;
  });

  // 4. 校验所有文件大小 > 0（排除空文件/损坏文件）
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      throw new Error(`Segment file is empty (0 bytes): ${file}`);
    }
  }

  // 5. 确保输出目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 6. 流式写入合并文件
  const writeStream = fs.createWriteStream(outputPath);
  let totalSize = 0;

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const data = fs.readFileSync(filePath);
    totalSize += data.length;
    writeStream.write(data);
  }

  // 7. 等待写入完成
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

// ============================================================
// 分片校验
// ============================================================

/**
 * 验证所有分片文件是否齐全且有效。
 *
 * 检查内容：
 * 1. 目录中 .ts 文件数量是否等于期望数量。
 * 2. 每个序号（0 ~ expectedCount-1）都有对应的分片文件。
 * 3. 每个分片文件大小 > 0（非空文件）。
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

  // 读取所有 .ts 文件
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
      // 检查空文件
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

// ============================================================
// 清理工具
// ============================================================

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
