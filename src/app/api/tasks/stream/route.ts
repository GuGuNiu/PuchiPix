/**
 * SSE 实时任务流端点
 *
 * GET /api/tasks/stream
 *
 * 推送机制：
 * 1. 连接时发送 initial 事件（全量任务列表）
 * 2. 后续根据 EventBus 事件推送增量更新：
 *    - upsert：完整任务对象（用于 created/scraped/scrapeCompleted 等需要 DB 查询的事件）
 *    - patch：部分字段更新（用于 progress 等高频事件，300ms 节流）
 *    - delete：任务删除通知
 * 3. 每 15 秒发送 keepalive 注释防止代理超时
 *
 * 客户端使用 EventSource API 订阅，自动重连。
 *
 * @date 2026-07-12
 */

import { NextRequest } from 'next/server';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/event-bus';
import { mapTask } from '@/lib/api-helpers';
import type { DownloadTask, TaskStatus } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function mapGalleryStatus(status: string): TaskStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'partial':
      return 'partial';
    case 'downloading':
      return 'downloading';
    case 'scraping':
      return 'scraping';
    case 'failed':
    case 'not_found':
      return 'failed';
    default:
      return 'pending';
  }
}

function mapGalleryToTask(g: {
  id: number;
  seq?: number | null;
  sourceUrl: string;
  title: string;
  status: string;
  downloadMethod: string;
  imageCount: number;
  videoCount: number;
  totalSize: bigint;
  downloadedSize: bigint;
  savePath: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { images: number; videos: number };
  downloadInfo?: {
    id: number;
    galleryId: number;
    title: string;
    fileCount: number;
    fileSizeText: string;
    imageDimensions: string;
    password: string;
    downloadUrl: string;
    downloadSource: string;
    ouoUrl: string;
    resolvedDirectUrl: string;
    provider: string;
    requiresLogin: boolean;
    requiresEmail: boolean;
    status: string;
    localPath: string;
    extractedPath: string;
    actualSize: bigint;
    zipFileName: string;
    parallelism: number;
    avgSpeed: number;
    verifiedCount: number;
    countMatched: boolean;
  } | null;
}): DownloadTask {
  const totalFiles = g.imageCount + g.videoCount;
  const downloadedFiles = (g._count?.images ?? 0) + (g._count?.videos ?? 0);
  const progress = totalFiles > 0
    ? Math.min((downloadedFiles / totalFiles) * 100, 100)
    : 0;

  return {
    ID: g.id,
    DisplayID: g.seq ?? undefined,
    URL: g.sourceUrl,
    M3U8URL: '',
    Status: mapGalleryStatus(g.status),
    Progress: progress,
    FilePath: g.savePath,
    Format: '',
    Priority: 0,
    ErrorMsg: '',
    CreatedAt: g.createdAt.toISOString(),
    UpdatedAt: g.updatedAt.toISOString(),
    TaskType: 'gallery',
    GalleryTitle: g.title,
    ImageCount: g.imageCount,
    VideoCount: g.videoCount,
    DownloadMethod: g.downloadMethod,
    DownloadInfo: g.downloadInfo ? {
      ID: g.downloadInfo.id,
      GalleryID: g.downloadInfo.galleryId,
      Title: g.downloadInfo.title,
      FileCount: g.downloadInfo.fileCount,
      FileSizeText: g.downloadInfo.fileSizeText,
      ImageDimensions: g.downloadInfo.imageDimensions,
      Password: g.downloadInfo.password,
      DownloadURL: g.downloadInfo.downloadUrl,
      DownloadSource: g.downloadInfo.downloadSource,
      OuoURL: g.downloadInfo.ouoUrl,
      ResolvedDirectURL: g.downloadInfo.resolvedDirectUrl,
      Provider: g.downloadInfo.provider,
      RequiresLogin: g.downloadInfo.requiresLogin,
      RequiresEmail: g.downloadInfo.requiresEmail,
      Status: g.downloadInfo.status,
      LocalPath: g.downloadInfo.localPath,
      ExtractedPath: g.downloadInfo.extractedPath,
      ActualSize: Number(g.downloadInfo.actualSize),
      ZipFileName: g.downloadInfo.zipFileName,
      Parallelism: g.downloadInfo.parallelism,
      AvgSpeed: g.downloadInfo.avgSpeed,
      VerifiedCount: g.downloadInfo.verifiedCount,
      CountMatched: g.downloadInfo.countMatched,
    } : undefined,
  };
}

// ============================================================
// 全量任务查询
// ============================================================

async function fetchAllTasks(): Promise<DownloadTask[]> {
  const [tasks, galleries] = await Promise.all([
    prisma.downloadTask.findMany({
      include: { videoInfo: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.gallery.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        downloadInfo: true,
        _count: {
          select: {
            images: { where: { status: 'downloaded' } },
            videos: { where: { status: 'completed' } },
          },
        },
      },
      take: 500,
    }),
  ]);

  const videoTasks = tasks.map(mapTask);
  const galleryTasks = galleries.map(mapGalleryToTask);

  return [...videoTasks, ...galleryTasks].sort(
    (a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime(),
  );
}

async function fetchVideoTask(taskId: number): Promise<DownloadTask | null> {
  const task = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    include: { videoInfo: true },
  });
  return task ? mapTask(task) : null;
}

async function fetchGalleryTask(galleryId: number): Promise<DownloadTask | null> {
  const gallery = await prisma.gallery.findUnique({
    where: { id: galleryId },
    include: {
      downloadInfo: true,
      _count: {
        select: {
          images: { where: { status: 'downloaded' } },
          videos: { where: { status: 'completed' } },
        },
      },
    },
  });
  return gallery ? mapGalleryToTask(gallery) : null;
}

// ============================================================
// SSE 端点
// ============================================================

interface PatchMessage {
  id: number;
  taskType: string;
  changes: Partial<DownloadTask>;
}

export async function GET(request: NextRequest): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 立即发送空数组，让客户端快速结束 loading 状态
      // 全量数据随后通过第二次 initial 或 upsert 事件推送
      send('initial', []);

      // 异步加载全量数据并推送
      fetchAllTasks().then((tasks) => {
        send('initial', tasks);
      }).catch((err) => {
        console.error('[SSE] 异步加载任务列表失败:', err);
      });

      // 节流 patch：300ms 内的更新合并发送
      const pendingPatches = new Map<string, PatchMessage>();
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const schedulePatch = (id: number, taskType: string, changes: Partial<DownloadTask>) => {
        const key = `${taskType}-${id}`;
        const existing = pendingPatches.get(key);
        if (existing) {
          Object.assign(existing.changes, changes);
        } else {
          pendingPatches.set(key, { id, taskType, changes });
        }
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            for (const patch of pendingPatches.values()) {
              send('patch', patch);
            }
            pendingPatches.clear();
          }, 300);
        }
      };

      const upsertVideo = async (taskId: number) => {
        try {
          const task = await fetchVideoTask(taskId);
          if (task) send('upsert', task);
        } catch {
          // ignore
        }
      };

      const upsertGallery = async (galleryId: number) => {
        try {
          const task = await fetchGalleryTask(galleryId);
          if (task) send('upsert', task);
        } catch {
          // ignore
        }
      };

      // ============================================================
      // 订阅 EventBus 事件
      // ============================================================

      const subs: Array<{ unsubscribe: () => void }> = [];

      // 视频任务事件
      subs.push(eventBus.on('task:created', (p) => { upsertVideo(p.taskId); }));
      subs.push(eventBus.on('task:scraping', (p) => {
        schedulePatch(p.taskId, 'video', { Status: 'scraping' as TaskStatus });
      }));
      subs.push(eventBus.on('task:progress', (p) => {
        const changes: Partial<DownloadTask> = { Progress: p.progress };
        if (p.segment !== undefined) changes.Segment = p.segment;
        if (p.total !== undefined) changes.TotalSegments = p.total;
        if (p.status) changes.Status = p.status as TaskStatus;
        schedulePatch(p.taskId, 'video', changes);
      }));
      subs.push(eventBus.on('task:completed', (p) => {
        schedulePatch(p.taskId, 'video', { Status: 'completed' as TaskStatus, Progress: 100 });
      }));
      subs.push(eventBus.on('task:failed', (p) => {
        schedulePatch(p.taskId, 'video', { Status: 'failed' as TaskStatus, ErrorMsg: p.error });
      }));
      subs.push(eventBus.on('task:cancelled', (p) => {
        schedulePatch(p.taskId, 'video', { Status: 'cancelled' as TaskStatus });
      }));
      subs.push(eventBus.on('task:deleted', (p) => {
        send('delete', { id: p.taskId, taskType: 'video' });
      }));
      subs.push(eventBus.on('task:scraped', (p) => { upsertVideo(p.taskId); }));

      // 图库事件
      subs.push(eventBus.on('gallery:scrapeStarted', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'scraping' as TaskStatus });
      }));
      subs.push(eventBus.on('gallery:scrapeCompleted', (p) => { upsertGallery(p.galleryId); }));
      subs.push(eventBus.on('gallery:scrapeFailed', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'failed' as TaskStatus, ErrorMsg: p.error });
      }));
      subs.push(eventBus.on('gallery:downloadStarted', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'downloading' as TaskStatus });
      }));
      subs.push(eventBus.on('gallery:downloadProgress', (p) => {
        const progress = p.total > 0 ? (p.completed / p.total) * 100 : 0;
        schedulePatch(p.galleryId, 'gallery', {
          Status: 'downloading' as TaskStatus,
          Progress: Math.min(progress, 100),
        });
      }));
      subs.push(eventBus.on('gallery:downloadCompleted', (p) => { upsertGallery(p.galleryId); }));
      subs.push(eventBus.on('gallery:downloadFailed', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'failed' as TaskStatus, ErrorMsg: p.error });
      }));

      // 图库 ZIP 事件
      subs.push(eventBus.on('gallery:zipDownloadStarted', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'downloading' as TaskStatus });
      }));
      subs.push(eventBus.on('gallery:zipDownloadProgress', (p) => {
        schedulePatch(p.galleryId, 'gallery', {
          Status: 'downloading' as TaskStatus,
          Progress: p.percent,
        });
      }));
      subs.push(eventBus.on('gallery:zipDownloadCompleted', (p) => { upsertGallery(p.galleryId); }));
      subs.push(eventBus.on('gallery:zipDownloadFailed', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'failed' as TaskStatus, ErrorMsg: p.error });
      }));
      subs.push(eventBus.on('gallery:zipExtractCompleted', (p) => { upsertGallery(p.galleryId); }));
      subs.push(eventBus.on('gallery:zipExtractFailed', (p) => { upsertGallery(p.galleryId); }));
      subs.push(eventBus.on('gallery:deleted', (p) => {
        send('delete', { id: p.galleryId, taskType: 'gallery' });
      }));

      // keepalive
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, 15000);

      // 清理
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        for (const sub of subs) {
          sub.unsubscribe();
        }
        subs.length = 0;
        pendingPatches.clear();
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
