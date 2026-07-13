/**
 * api-helpers.ts — API 辅助工具函数
 *
 * 提供：
 * 1. DownloadManager 单例管理。
 * 2. Prisma 任务对象到 API 响应对象的映射（mapTask）。
 * 3. JSON 响应封装工具。
 * 4. M3U8 URL 自动获取逻辑。
 */

import { NextResponse } from 'next/server';
import type { DownloadTask, TaskStatus, VideoInfo } from '@/types';
import { DownloadManager } from '@/lib/downloader/download-manager';
import { getScraper } from '@/lib/scraper/scraper';
import prisma from '@/lib/db/prisma';

// ============================================================
// DownloadManager 单例
// ============================================================

const DM_GLOBAL_KEY = '__downloadManagerInstance__';

export function getDownloadManager(): DownloadManager {
  const g = globalThis as Record<string, unknown>;
  if (!g[DM_GLOBAL_KEY]) {
    const downloadPath = process.env.DOWNLOAD_PATH || './data/videos';
    const segmentsPath = process.env.SEGMENTS_PATH || './data/segments';
    g[DM_GLOBAL_KEY] = new DownloadManager(5, 5, downloadPath, segmentsPath);
  }
  return g[DM_GLOBAL_KEY] as DownloadManager;
}

// ============================================================
// Prisma 对象映射工具
// ============================================================

/**
 * Prisma VideoInfo 类型（从数据库查询返回的原始类型）。
 * tags 和 actors 在数据库中以 JSON 字符串存储，需要解析为数组。
 */
interface PrismaVideoInfo {
  id: number;
  taskId: number;
  title: string;
  sourceUrl: string;
  fileSize: bigint;
  duration: number;
  tags: string;
  actors: string;
  categories: string;
  director: string;
  resolution: string;
  createdAt: Date;
}

/**
 * 将 Prisma 查询返回的任务对象映射为 API 响应格式。
 *
 * 主要处理：
 * - 字段名从 snake_case 转为 PascalCase。
 * - BigInt fileSize 转为 Number。
 * - tags/actors 从 JSON 字符串解析为数组。
 * - Date 转为 ISO 字符串。
 *
 * @param task - Prisma 查询返回的任务对象
 * @returns API 响应格式的任务对象
 */
export function mapTask(task: {
  id: number;
  seq?: number | null;
  url: string;
  m3u8Url: string;
  status: string;
  progress: number;
  filePath: string;
  format: string;
  priority: number;
  errorMsg: string;
  createdAt: Date;
  updatedAt: Date;
  videoInfo?: PrismaVideoInfo | null;
}): DownloadTask {
  return {
    ID: task.id,
    DisplayID: task.seq ?? undefined,
    URL: task.url,
    M3U8URL: task.m3u8Url,
    Status: task.status as TaskStatus,
    Progress: task.progress,
    FilePath: task.filePath,
    Format: task.format,
    Priority: task.priority,
    ErrorMsg: task.errorMsg,
    CreatedAt: task.createdAt.toISOString(),
    UpdatedAt: task.updatedAt.toISOString(),
    VideoInfo: task.videoInfo ? mapVideoInfo(task.videoInfo) : undefined,
  };
}

/**
 * 将 Prisma VideoInfo 对象映射为 API 响应格式。
 *
 * @param v - Prisma 查询返回的 VideoInfo 对象
 * @returns API 响应格式的 VideoInfo 对象
 */
function mapVideoInfo(v: PrismaVideoInfo): VideoInfo {
  // 解析 tags JSON 字符串为数组
  let tags: string[] = [];
  try {
    tags = v.tags ? JSON.parse(v.tags) : [];
  } catch {
    tags = [];
  }

  // 解析 actors JSON 字符串为数组
  let actors: string[] = [];
  try {
    actors = v.actors ? JSON.parse(v.actors) : [];
  } catch {
    actors = [];
  }

  // 解析 categories JSON 字符串为数组
  let categories: string[] = [];
  try {
    categories = v.categories ? JSON.parse(v.categories) : [];
  } catch {
    categories = [];
  }

  return {
    ID: v.id,
    TaskID: v.taskId,
    Title: v.title,
    SourceURL: v.sourceUrl,
    FileSize: Number(v.fileSize),
    Duration: v.duration,
    Tags: tags,
    Actors: actors,
    Categories: categories,
    Director: v.director || '',
    Resolution: v.resolution,
    CreatedAt: v.createdAt.toISOString(),
  };
}

// ============================================================
// 响应封装工具
// ============================================================

/**
 * 构造成功的 JSON 响应。
 * @param data - 响应体数据
 * @param status - HTTP 状态码，默认 200
 */
export function jsonResponse(data: unknown, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * 构造错误的 JSON 响应。
 * @param message - 错误描述信息
 * @param status - HTTP 状态码，默认 500
 */
export function errorResponse(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

// ============================================================
// M3U8 URL 自动获取
// ============================================================

/**
 * 确保下载任务拥有 M3U8 URL。
 *
 * 逻辑流程：
 * 1. 如果任务已保存了 M3U8 URL，直接返回。
 * 2. 如果任务 URL 本身就是 .m3u8 链接，保存并返回。
 * 3. 否则调用 Scraper 爬虫从页面中自动提取 M3U8 地址。
 *
 * @param task - 下载任务对象（包含 ID、原始 URL、已有的 M3U8URL）
 * @returns 解析得到的 M3U8 URL 字符串
 * @throws 如果无法从页面中找到 M3U8 URL
 */
export async function ensureM3U8URL(
  task: { ID: number; URL: string; M3U8URL: string }
): Promise<string> {
  // 情况 1：已有 M3U8 URL
  if (task.M3U8URL && task.M3U8URL.trim() !== '') {
    return task.M3U8URL;
  }

  // 情况 2：URL 本身就是 .m3u8
  if (task.URL.endsWith('.m3u8')) {
    await prisma.downloadTask.update({
      where: { id: task.ID },
      data: { m3u8Url: task.URL },
    });
    return task.URL;
  }

  // 情况 3：需要爬虫提取
  const scraper = getScraper();
  const result = await scraper.scrape(task.URL);

  if (!result.m3u8_url) {
    throw new Error('Could not find M3U8 URL from page');
  }

  // 保存 M3U8 URL 到数据库
  await prisma.downloadTask.update({
    where: { id: task.ID },
    data: { m3u8Url: result.m3u8_url },
  });

  // 如果爬虫提取到了标题、标签、演员，同步更新 VideoInfo
  await prisma.videoInfo.upsert({
    where: { taskId: task.ID },
    create: {
      taskId: task.ID,
      title: result.title || '',
      sourceUrl: task.URL,
      tags: JSON.stringify(result.tags || []),
      actors: JSON.stringify(result.actors || []),
      categories: JSON.stringify(result.categories || []),
      director: result.director || '',
    },
    update: {
      title: result.title || '',
      sourceUrl: task.URL,
      tags: JSON.stringify(result.tags || []),
      actors: JSON.stringify(result.actors || []),
      categories: JSON.stringify(result.categories || []),
      director: result.director || '',
    },
  });

  return result.m3u8_url;
}
