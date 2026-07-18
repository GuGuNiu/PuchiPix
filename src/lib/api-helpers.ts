﻿﻿﻿import { NextResponse } from 'next/server';
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
 * Prisma VideoInfo 绫诲瀷锛堜粠鏁版嵁搴撴煡璇㈣繑鍥炵殑鍘熷绫诲瀷锛夈€?
 * tags 鍜?actors 鍦ㄦ暟鎹簱涓互 JSON 瀛楃涓插瓨鍌紝闇€瑕佽В鏋愪负鏁扮粍銆?
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
 * 灏?Prisma 鏌ヨ杩斿洖鐨勪换鍔″璞℃槧灏勪负 API 鍝嶅簲鏍煎紡銆?
 *
 * 涓昏澶勭悊锛?
 * - 瀛楁鍚嶄粠 snake_case 杞负 PascalCase銆?
 * - BigInt fileSize 杞负 Number銆?
 * - tags/actors 浠?JSON 瀛楃涓茶В鏋愪负鏁扮粍銆?
 * - Date 杞负 ISO 瀛楃涓层€?
 *
 * @param task - Prisma 鏌ヨ杩斿洖鐨勪换鍔″璞?
 * @returns API 鍝嶅簲鏍煎紡鐨勪换鍔″璞?
 */
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
    Person: videoInfo?.Actors?.length ? videoInfo.Actors.join('銆?) : undefined,
  };
}

/**
 * 灏?Prisma VideoInfo 瀵硅薄鏄犲皠涓?API 鍝嶅簲鏍煎紡銆?
 *
 * @param v - Prisma 鏌ヨ杩斿洖鐨?VideoInfo 瀵硅薄
 * @returns API 鍝嶅簲鏍煎紡鐨?VideoInfo 瀵硅薄
 */
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
 * 鏋勯€犳垚鍔熺殑 JSON 鍝嶅簲銆?
 * @param data - 鍝嶅簲浣撴暟鎹?
 * @param status - HTTP 鐘舵€佺爜锛岄粯璁?200
 */
export function jsonResponse(data: unknown, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * 鏋勯€犻敊璇殑 JSON 鍝嶅簲銆?
 * @param message - 閿欒鎻忚堪淇℃伅
 * @param status - HTTP 鐘舵€佺爜锛岄粯璁?500
 */
export function errorResponse(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * 纭繚涓嬭浇浠诲姟鎷ユ湁 M3U8 URL銆?
 *
 * 閫昏緫娴佺▼锛?
 - 濡傛灉浠诲姟宸蹭繚瀛樹簡 M3U8 URL锛岀洿鎺ヨ繑鍥炪€?
 - 濡傛灉浠诲姟 URL 鏈韩灏辨槸 .m3u8 閾炬帴锛屼繚瀛樺苟杩斿洖銆?
 - 鍚﹀垯璋冪敤 Scraper 鐖櫕浠庨〉闈腑鑷姩鎻愬彇 M3U8 鍦板潃銆?
 *
 * @param task - 涓嬭浇浠诲姟瀵硅薄锛堝寘鍚?ID銆佸師濮?URL銆佸凡鏈夌殑 M3U8URL锛?
 * @returns 瑙ｆ瀽寰楀埌鐨?M3U8 URL 瀛楃涓?
 * @throws 濡傛灉鏃犳硶浠庨〉闈腑鎵惧埌 M3U8 URL
 */
export async function ensureM3U8URL(
  task: { ID: number; URL: string; M3U8URL: string }
): Promise<string> {
  // 鎯呭喌 1锛氬凡鏈?M3U8 URL
  if (task.M3U8URL && task.M3U8URL.trim() !== '') {
    return task.M3U8URL;
  }

  // 鎯呭喌 2锛歎RL 鏈韩灏辨槸 .m3u8
  if (task.URL.endsWith('.m3u8')) {
    await prisma.downloadTask.update({
      where: { id: task.ID },
      data: { m3u8Url: task.URL },
    });
    return task.URL;
  }

  // 鎯呭喌 3锛氶渶瑕佺埇铏彁鍙?
  const scraper = getScraper();
  const result = await scraper.scrape(task.URL);

  if (!result.m3u8_url) {
    throw new Error('Could not find M3U8 URL from page');
  }

  await prisma.downloadTask.update({
    where: { id: task.ID },
    data: { m3u8Url: result.m3u8_url },
  });

  // 濡傛灉鐖櫕鎻愬彇鍒颁簡鏍囬銆佹爣绛俱€佹紨鍛橈紝鍚屾鏇存柊 VideoInfo
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
