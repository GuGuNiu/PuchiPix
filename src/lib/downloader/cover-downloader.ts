import fs from 'fs';
import path from 'path';
import prisma from '@/lib/db/prisma';
import { retry } from '@/lib/utils';
import { ensureDir } from '@/lib/utils/file-system';
import { downloadFileWithDomainFallback } from './domain-fallback';
import { randomUA } from '@/lib/core/stealth/anti-crawler';

const COVER_MAX_RETRIES = 3;

function buildImageHeaders(url: string, referer: string): Record<string, string> {
  let imageReferer = referer;
  try {
    const parsed = new URL(url);
    imageReferer = `${parsed.protocol}//${parsed.host}/`;
  } catch {}

  return {
    'User-Agent': randomUA(),
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Referer': imageReferer,
    'sec-fetch-dest': 'image',
    'sec-fetch-mode': 'no-cors',
    'sec-fetch-site': 'same-origin',
  };
}

function extractCoverExtension(url: string): string {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const ext = path.extname(cleanUrl).toLowerCase();
    if (ext && ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return ext;
  } catch {}
  return '.jpg';
}

export async function downloadGalleryCover(
  galleryId: number,
  coverUrl: string,
  sourceUrl: string,
  basePath: string,
): Promise<string | null> {
  const coverDir = path.join(basePath, 'cover');
  ensureDir(coverDir);
  const coverExt = extractCoverExtension(coverUrl);
  const coverFilePath = path.join(coverDir, `cover${coverExt}`);

  if (fs.existsSync(coverFilePath) && fs.statSync(coverFilePath).size > 0) {
    await prisma.gallery.update({
      where: { id: galleryId },
      data: { coverLocalPath: coverFilePath },
    });
    return coverFilePath;
  }

  const result = await retry(
    () => downloadFileWithDomainFallback(coverUrl, coverFilePath, {
      headers: buildImageHeaders(coverUrl, sourceUrl),
    }),
    {
      maxRetries: COVER_MAX_RETRIES - 1,
      backoff: 'exponential',
      baseDelay: 1000,
      maxDelay: 8000,
      isSuccess: (r) => r.success,
    },
  );

  if (result.success) {
    await prisma.gallery.update({
      where: { id: galleryId },
      data: { coverLocalPath: coverFilePath, savePath: basePath },
    });
    console.log(`[CoverDL] Gallery #${galleryId} cover downloaded: ${coverFilePath}`);
    return coverFilePath;
  }

  console.error(`[CoverDL] Gallery #${galleryId} cover download failed: ${coverUrl}`);
  return null;
}
