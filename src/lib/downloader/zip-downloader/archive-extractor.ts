import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { createExtractorFromData } from 'node-unrar-js';
import { ensureDir } from './constants';

/**
 * 解压压缩文件到指定目录
 *
 * 根据文件扩展名自动选择解压器：
 * - .zip → adm-zip
 * - .rar → node-unrar-js (WASM)
 * - .7z → 暂不支持
 */
export async function extractArchive(
  archivePath: string,
  extractPath: string,
  password?: string,
): Promise<{ success: boolean; fileCount: number; files: string[] }> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === '.rar') {
    return extractRar(archivePath, extractPath, password);
  }

  return extractZipFile(archivePath, extractPath, password);
}

/**
 * 检查解压路径是否安全（防止路径遍历攻击）
 */
function isSafeExtractPath(destPath: string, extractBase: string): boolean {
  const resolvedDest = path.resolve(destPath);
  const resolvedBase = path.resolve(extractBase);
  return resolvedDest === resolvedBase || resolvedDest.startsWith(resolvedBase + path.sep);
}

/**
 * 解压 RAR 内的单个文件到目标路径，带路径遍历防护
 */
function writeRarFile(
  file: { fileHeader: { name: string; flags: { directory: boolean } }; extraction?: Uint8Array },
  extractPath: string,
  files: string[],
): boolean {
  if (file.fileHeader.flags.directory) return false;

  const fileName = file.fileHeader.name;
  const destPath = path.join(extractPath, fileName);

  if (!isSafeExtractPath(destPath, extractPath)) {
    console.warn(`[ZipDL] 跳过可疑路径: ${fileName}`);
    return false;
  }

  ensureDir(path.dirname(destPath));

  if (file.extraction) {
    fs.writeFileSync(destPath, Buffer.from(file.extraction));
  }
  files.push(fileName);
  return true;
}

async function extractRar(
  rarPath: string,
  extractPath: string,
  password?: string,
): Promise<{ success: boolean; fileCount: number; files: string[] }> {
  try {
    const data = fs.readFileSync(rarPath);
    const extractor = await createExtractorFromData({
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      password: password || '',
    });

    const extracted = extractor.extract({ password: password || undefined });
    const files: string[] = [];

    for (const file of extracted.files) {
      writeRarFile(file, extractPath, files);
    }

    console.log(`[ZipDL] RAR 解压成功: ${files.length} 个文件`);
    return { success: true, fileCount: files.length, files };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('PASSWORD') || msg.includes('password')) {
      try {
        const data = fs.readFileSync(rarPath);
        const extractor = await createExtractorFromData({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, password: '' });
        const extracted = extractor.extract();
        const files: string[] = [];

        for (const file of extracted.files) {
          writeRarFile(file, extractPath, files);
        }
        console.log(`[ZipDL] RAR 无密码解压成功: ${files.length} 个文件`);
        return { success: true, fileCount: files.length, files };
      } catch {
      }
    }

    console.error(`[ZipDL] RAR 解压失败: ${msg}`);
    return { success: false, fileCount: 0, files: [] };
  }
}

function extractZipFile(
  zipPath: string,
  extractPath: string,
  password?: string,
): { success: boolean; fileCount: number; files: string[] } {
  try {
    const zip = new AdmZip(zipPath);

    const entries = zip.getEntries();
    if (entries.length === 0) {
      return { success: false, fileCount: 0, files: [] };
    }

    zip.extractAllTo(extractPath, true, false, password || undefined);

    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory) {
        files.push(entry.entryName);
      }
    }

    return { success: true, fileCount: files.length, files };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('password') || msg.includes('Password')) {
      try {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractPath, true);
        const entries = zip.getEntries();
        const files = entries.filter((e) => !e.isDirectory).map((e) => e.entryName);
        return { success: true, fileCount: files.length, files };
      } catch {
      }
    }

    console.error(`[ZipDL] ZIP 解压失败: ${msg}`);
    return { success: false, fileCount: 0, files: [] };
  }
}
