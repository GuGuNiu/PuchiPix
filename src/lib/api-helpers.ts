import "server-only";
import { NextResponse } from 'next/server';
import type { DownloadTask, TaskStatus, VideoInfo } from '@/types';
import { DownloadManager } from '@/lib/downloader/manager';
import { getScraper } from '@/lib/sites/scraper';
import prisma from '@/lib/db/prisma';
import { getM3U8Candidates } from '@/lib/core/domain/m3u8-candidate-store';
import { getOrCreateGlobal } from '@/lib/core/infra/global-singleton';

const DM_GLOBAL_KEY = '__puchipix_download_manager__';

export function getDownloadManager(): DownloadManager {
  return getOrCreateGlobal(DM_GLOBAL_KEY, () => {
    const downloadPath = process.env.DOWNLOAD_PATH || './data/videos';
    const segmentsPath = process.env.SEGMENTS_PATH || './data/segments';
    return new DownloadManager(5, downloadPath, segmentsPath);
  });
}

/**
 * Prisma VideoInfo row shape for mapping.
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

export function mapTask(task: {
  id: number;
  seq?: string | null;
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
  const videoInfo = task.videoInfo ? mapVideoInfo(task.videoInfo) : undefined;
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
    VideoInfo: videoInfo,
    M3U8Candidates: getM3U8Candidates(task.id),
    Person: videoInfo?.Actors?.length ? videoInfo.Actors.join('、') : undefined,
  };
}

function mapVideoInfo(v: PrismaVideoInfo): VideoInfo {
  let tags: string[] = [];
  try {
    tags = v.tags ? JSON.parse(v.tags) as string[] : [];
  } catch {
    tags = [];
  }

  let actors: string[] = [];
  try {
    actors = v.actors ? JSON.parse(v.actors) as string[] : [];
  } catch {
    actors = [];
  }

  let categories: string[] = [];
  try {
    categories = v.categories ? JSON.parse(v.categories) as string[] : [];
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

/**
 * @param data - Response body data
 * @param status - HTTP status code, default 200
 */
export function jsonResponse(data: unknown, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * @param message - Error message
 * @param status - HTTP status code, default 500
 */
export function errorResponse(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Ensure the task has an M3U8 URL by scraping if needed.
 *
 * Logic flow:
 *  - If the task already has a saved M3U8 URL, return it directly.
 *  - If the task URL itself is a .m3u8 link, save and return it.
 *  - Otherwise, call the Scraper to automatically extract M3U8 from the page.
 *
 * @param task - Download task object (contains ID, original URL, and existing M3U8URL)
 */
export async function ensureM3U8URL(
  task: { ID: number; URL: string; M3U8URL: string }
): Promise<string> {
  if (task.M3U8URL && task.M3U8URL.trim() !== '') {
    return task.M3U8URL;
  }

  if (task.URL.endsWith('.m3u8')) {
    await prisma.downloadTask.update({
      where: { id: task.ID },
      data: { m3u8Url: task.URL },
    });
    return task.URL;
  }

  const scraper = getScraper();
  const result = await scraper.scrape(task.URL);

  if (!result.m3u8_url) {
    throw new Error('Could not find M3U8 URL from page');
  }

  await prisma.downloadTask.update({
    where: { id: task.ID },
    data: { m3u8Url: result.m3u8_url },
  });

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
