import prisma from '@/lib/db/prisma';
import {
  cleanUrl,
  normalizeUrl,
  getUrlSignature,
  generateMirrorUrls,
} from './url-normalizer';

/** 去重检查结果 */
export interface DedupResult {
  /** 是否找到重复记录 */
  duplicate: boolean;
  /** 匹配类型 */
  matchType: 'exact' | 'mirror' | 'path' | null;
  /** 重复记录的表 */
  table: 'gallery' | 'download_task' | null;
  /** 重复记录的 ID */
  recordId: number | null;
  /** 重复记录的状态 */
  status: string | null;
  /** 重复记录在数据库中存储的 URL（可能是不同域名的镜像） */
  existingUrl: string | null;
  /** 重复记录的标题（如有） */
  title: string | null;
  /** 提示消息 */
  message: string | null;
}

/** 无重复结果 */
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
 * 检查图库表中是否存在重复 URL
 *
 * 策略：
 - 精确匹配：规范化 URL
 - 镜像匹配：生成所有镜像域名变体，逐一查询
 - 路径匹配：使用 URL 签名进行 endsWith 查询
 *
 * @param rawUrl - 用户提交的原始 URL
 * @returns 去重检查结果
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
      message: `数据库中已存在此图库记录（ID: #${existing.id}，状态: ${existing.status}）`,
    };
  }

  for (const mirrorUrl of mirrorUrls) {
    if (mirrorUrl === normalizedUrl) continue; // 跳过已查过的
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
        message: `数据库中已存在此图库记录（镜像域名不同，ID: #${existing.id}，状态: ${existing.status}）`,
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
        message: `数据库中已存在路径相同的图库记录（ID: #${match.id}，状态: ${match.status}）`,
      };
    }
  }

  return NO_DUPLICATE;
}

/**
 * 检查视频任务表中是否存在重复 URL
 *
 * 视频任务的 url 字段不是 unique，因此需要 findMany。
 *
 * @param rawUrl - 用户提交的原始 URL
 * @returns 去重检查结果
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
      message: `数据库中已存在此视频任务记录（ID: #${existing.id}，状态: ${existing.status}）`,
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
        message: `数据库中已存在此视频任务记录（镜像域名不同，ID: #${existing.id}，状态: ${existing.status}）`,
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
        message: `数据库中已存在路径相同的视频任务记录（ID: #${match.id}，状态: ${match.status}）`,
      };
    }
  }

  return NO_DUPLICATE;
}

/**
 * 综合去重检查 — 同时检查图库表和视频任务表
 *
 * 先检查图库表（因为图库站点更容易出现镜像域名问题），
 * 如果图库表没有匹配，再检查视频任务表。
 *
 * @param rawUrl - 用户提交的原始 URL
 * @returns 去重检查结果（第一条匹配即返回）
 */
export async function checkTaskDuplicate(rawUrl: string): Promise<DedupResult> {
  // 先检查图库表
  const galleryResult = await checkGalleryDuplicate(rawUrl);
  if (galleryResult.duplicate) {
    return galleryResult;
  }

  // 再检查视频任务表
  const videoResult = await checkVideoTaskDuplicate(rawUrl);
  if (videoResult.duplicate) {
    return videoResult;
  }

  return NO_DUPLICATE;
}
