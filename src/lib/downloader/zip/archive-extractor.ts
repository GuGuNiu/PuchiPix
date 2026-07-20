import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { createExtractorFromData } from 'node-unrar-js';
import { ensureDir } from '@/lib/utils/file-system';

/**
 *
 * - .zip → adm-zip
 * - .rar → node-unrar-js (WASM)
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
 * CheckDecompressPathisnosecurity（PreventPathIterateattack）
 */
function isSafeExtractPath(destPath: string, extractBase: string): boolean {
  const resolvedDest = path.resolve(destPath);
  const resolvedBase = path.resolve(extractBase);
  return resolvedDest === resolvedBase || resolvedDest.startsWith(resolvedBase + path.sep);
}


function writeRarFile(
  file: { fileHeader: { name: string; flags: { directory: boolean } }; extraction?: Uint8Array },
  extractPath: string,
  files: string[],
): boolean {
  if (file.fileHeader.flags.directory) return false;

  const fileName = file.fileHeader.name;
  const destPath = path.join(extractPath, fileName);

  if (!isSafeExtractPath(destPath, extractPath)) {
    console.warn(`[ZipDL] Skipped suspicious path: ${fileName}`);
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

    console.log(`[ZipDL] RAR extraction succeeded: ${files.length} files`);
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
        console.log(`[ZipDL] RAR extraction (no password) succeeded: ${files.length} files`);
        return { success: true, fileCount: files.length, files };
      } catch {
      }
    }

    console.error(`[ZipDL] RAR extraction failed: ${msg}`);
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

    console.error(`[ZipDL] ZIP extraction failed: ${msg}`);
    return { success: false, fileCount: 0, files: [] };
  }
}
