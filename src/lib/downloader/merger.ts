import * as fs from 'fs';
import * as path from 'path';
import { ensureDir } from '@/lib/utils/file-system';

/**
 * Mergeoperation Return result。
 */
export interface MergeResult {
  totalFiles: number;
  totalSize: number;
}

/**
 *
 * @param outputPath - MergeafterOutputFile path
 * @throws ifdirectorynot exist、no Segment file、orexistemptyfile
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

  // EnsureOutput directoryexist
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
 *
 * @param segDir - Segment filedirectory
 * @returns Verification result object
 */
export function verifySegments(
  segDir: string,
  expectedCount: number
): { valid: boolean; missing: number[]; emptyFiles: string[]; totalSize: number; actualCount: number } {
  const dirPath = path.resolve(segDir);

  // Directorynot exist
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
 * RecursionClean upsegmentdirectoryanditsallcontent。
 *
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
