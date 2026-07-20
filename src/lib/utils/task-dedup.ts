import prisma from '@/lib/db/prisma';
import {
  cleanUrl,
  normalizeUrl,
  getUrlSignature,
  generateMirrorUrls,
} from './url-normalizer';

export interface DedupResult {
  duplicate: boolean;
  /** Matchtype */
  matchType: 'exact' | 'mirror' | 'path' | null;
  table: 'gallery' | 'download_task' | null;
  recordId: number | null;
  status: string | null;
  existingUrl: string | null;
  title: string | null;
  message: string | null;
}

const NO_DUPLICATE: DedupResult = {
  duplicate: false,
  matchType: null,
  table: null,
  recordId: null,
  status: null,
  existingUrl: null,
  title: null,
  message: null,
};

/**
 * Check gallery duplicate by three strategies:
 * - Exact match on normalized URL
 * - Mirror match by generating all mirror domain variants and querying each
 * - Path match using URL signature for endsWith query
 *
 * @returns Deduplication check result
 */
export async function checkGalleryDuplicate(rawUrl: string): Promise<DedupResult> {
  const cleanedUrl = cleanUrl(rawUrl);
  if (!cleanedUrl) return NO_DUPLICATE;

  const normalizedUrl = normalizeUrl(cleanedUrl);
  const mirrorUrls = generateMirrorUrls(cleanedUrl);
  const signature = getUrlSignature(cleanedUrl);

  let existing = await prisma.gallery.findUnique({
    where: { sourceUrl: normalizedUrl },
    select: { id: true, sourceUrl: true, status: true, title: true },
  });

  if (existing) {
    return {
      duplicate: true,
      matchType: 'exact',
      table: 'gallery',
      recordId: existing.id,
      status: existing.status,
      existingUrl: existing.sourceUrl,
      title: existing.title,
      message: `数据库中已存在此图库记录ID: #${existing.id}状态: ${existing.status}`,
    };
  }

  for (const mirrorUrl of mirrorUrls) {
    if (mirrorUrl === normalizedUrl) continue;
    existing = await prisma.gallery.findUnique({
      where: { sourceUrl: mirrorUrl },
      select: { id: true, sourceUrl: true, status: true, title: true },
    });

    if (existing) {
      return {
        duplicate: true,
        matchType: 'mirror',
        table: 'gallery',
        recordId: existing.id,
        status: existing.status,
        existingUrl: existing.sourceUrl,
        title: existing.title,
        message: `数据库中已存在此图库记录镜像域名不同ID: #${existing.id}状态: ${existing.status}`,
      };
    }
  }

  if (signature && signature.length > 1) {
    const pathMatches = await prisma.gallery.findMany({
      where: {
        sourceUrl: { endsWith: signature },
      },
      select: { id: true, sourceUrl: true, status: true, title: true },
      take: 5,
    });

    if (pathMatches.length > 0) {
      const match = pathMatches[0];
      return {
        duplicate: true,
        matchType: 'path',
        table: 'gallery',
        recordId: match.id,
        status: match.status,
        existingUrl: match.sourceUrl,
        title: match.title,
        message: `数据库中已存在路径相同的图库记录ID: #${match.id}状态: ${match.status}`,
      };
    }
  }

  return NO_DUPLICATE;
}

/**
 *
 *
 * @returns Deduplication check result
 */
export async function checkVideoTaskDuplicate(rawUrl: string): Promise<DedupResult> {
  const cleanedUrl = cleanUrl(rawUrl);
  if (!cleanedUrl) return NO_DUPLICATE;

  const normalizedUrl = normalizeUrl(cleanedUrl);
  const mirrorUrls = generateMirrorUrls(cleanedUrl);
  const signature = getUrlSignature(cleanedUrl);

  let existing = await prisma.downloadTask.findFirst({
    where: { url: normalizedUrl },
    select: { id: true, url: true, status: true },
  });

  if (existing) {
    return {
      duplicate: true,
      matchType: 'exact',
      table: 'download_task',
      recordId: existing.id,
      status: existing.status,
      existingUrl: existing.url,
      title: null,
      message: `数据库中已存在此视频任务记录ID: #${existing.id}状态: ${existing.status}`,
    };
  }

  for (const mirrorUrl of mirrorUrls) {
    if (mirrorUrl === normalizedUrl) continue;
    existing = await prisma.downloadTask.findFirst({
      where: { url: mirrorUrl },
      select: { id: true, url: true, status: true },
    });

    if (existing) {
      return {
        duplicate: true,
        matchType: 'mirror',
        table: 'download_task',
        recordId: existing.id,
        status: existing.status,
        existingUrl: existing.url,
        title: null,
        message: `数据库中已存在此视频任务记录镜像域名不同ID: #${existing.id}状态: ${existing.status}`,
      };
    }
  }

  if (signature && signature.length > 1) {
    const pathMatches = await prisma.downloadTask.findMany({
      where: {
        url: { endsWith: signature },
      },
      select: { id: true, url: true, status: true },
      take: 5,
    });

    if (pathMatches.length > 0) {
      const match = pathMatches[0];
      return {
        duplicate: true,
        matchType: 'path',
        table: 'download_task',
        recordId: match.id,
        status: match.status,
        existingUrl: match.url,
        title: null,
        message: `数据库中已存在路径相同的视频任务记录ID: #${match.id}状态: ${match.status}`,
      };
    }
  }

  return NO_DUPLICATE;
}


export async function checkTaskDuplicate(rawUrl: string): Promise<DedupResult> {
  const galleryResult = await checkGalleryDuplicate(rawUrl);
  if (galleryResult.duplicate) {
    return galleryResult;
  }

  const videoResult = await checkVideoTaskDuplicate(rawUrl);
  if (videoResult.duplicate) {
    return videoResult;
  }

  return NO_DUPLICATE;
}
