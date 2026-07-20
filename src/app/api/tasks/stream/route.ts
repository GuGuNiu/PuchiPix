import type { NextRequest } from 'next/server';
import prisma from '@/lib/db/prisma';
import { eventBus } from '@/lib/core/infra/event-bus';
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
  seq?: string | null;
  sourceUrl: string;
  title: string;
  protagonist: string;
  description: string;
  gameCharacters: string | null;
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

  let person = g.protagonist || '';
  if (!person && g.gameCharacters) {
    try {
      const gc = JSON.parse(g.gameCharacters);
      if (Array.isArray(gc) && gc.length > 0) {
        person = gc.join('、');
      }
    } catch {
    }
  }

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
    Person: person || undefined,
    ImageCount: g.imageCount,
    VideoCount: g.videoCount,
    DownloadMethod: g.downloadMethod,
    GalleryTotalSize: Number(g.totalSize),
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

function mapSniffToTask(s: {
  id: number;
  seq?: string | null;
  url: string;
  status: string;
  totalFound: number;
  totalCreated: number;
  totalSkipped: number;
  errorMsg: string;
  createdAt: Date;
  updatedAt: Date;
}): DownloadTask {
  const statusMap: Record<string, TaskStatus> = {
    pending: 'pending',
    sniffing: 'scraping',
    completed: 'completed',
    failed: 'failed',
  };

  const progress = s.status === 'completed' ? 100 : s.status === 'sniffing' ? 30 : 0;

  return {
    ID: s.id,
    DisplayID: s.seq ?? undefined,
    URL: s.url,
    M3U8URL: '',
    Status: statusMap[s.status] ?? 'pending',
    Progress: progress,
    FilePath: '',
    Format: '',
    Priority: 0,
    ErrorMsg: s.errorMsg,
    CreatedAt: s.createdAt.toISOString(),
    UpdatedAt: s.updatedAt.toISOString(),
    TaskType: 'sniff',
    SniffTotalFound: s.totalFound,
    SniffTotalCreated: s.totalCreated,
    SniffTotalSkipped: s.totalSkipped,
  };
}

async function fetchAllTasks(): Promise<DownloadTask[]> {
  const [tasks, galleries, sniffTasks] = await Promise.all([
    prisma.downloadTask.findMany({
      include: { videoInfo: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
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
      take: 200,
    }),
    prisma.sniffTask.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const videoTasks = tasks.map(mapTask);
  const galleryTasks = galleries.map(mapGalleryToTask);
  const sniffTaskList = sniffTasks.map(mapSniffToTask);

  return [...videoTasks, ...galleryTasks, ...sniffTaskList].sort(
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

async function fetchSniffTask(sniffId: number): Promise<DownloadTask | null> {
  const sniffTask = await prisma.sniffTask.findUnique({
    where: { id: sniffId },
  });
  return sniffTask ? mapSniffToTask(sniffTask) : null;
}

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

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      /*
       * 
       * 
       */
      let initialLoaded = false;
      const eventBuffer: Array<() => void> = [];

      const bufferOrSend = (event: string, data: unknown): void => {
        if (!initialLoaded) {
          eventBuffer.push(() => send(event, data));
        } else {
          send(event, data);
        }
      };

      send('initial', []);

      fetchAllTasks().then((tasks) => {
        send('initial', tasks);
        initialLoaded = true;
        for (const fn of eventBuffer) {
          fn();
        }
        eventBuffer.length = 0;
      }).catch((err) => {
        console.error('[SSE] Failed to load task list asynchronously:', err);
        initialLoaded = true; // Release buffer even on failure
        for (const fn of eventBuffer) {
          fn();
        }
        eventBuffer.length = 0;
      });

      const pendingPatches = new Map<string, PatchMessage>();
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      /*
       * 
       * 
       */
      const pendingUpserts = new Set<string>();

      const schedulePatch = (id: number, taskType: string, changes: Partial<DownloadTask>): void => {
        const key = `${taskType}-${id}`;
        if (pendingUpserts.has(key)) return;
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
              bufferOrSend('patch', patch);
            }
            pendingPatches.clear();
          }, 300);
        }
      };

      const cancelPendingPatch = (id: number, taskType: string): void => {
        const key = `${taskType}-${id}`;
        pendingPatches.delete(key);
      };

      const upsertVideo = async (taskId: number): Promise<void> => {
        const key = `video-${taskId}`;
        pendingUpserts.add(key);
        try {
          cancelPendingPatch(taskId, 'video');
          const task = await fetchVideoTask(taskId);
          if (task) bufferOrSend('upsert', task);
        } catch {
        } finally {
          pendingUpserts.delete(key);
        }
      };

      const upsertGallery = async (galleryId: number): Promise<void> => {
        const key = `gallery-${galleryId}`;
        pendingUpserts.add(key);
        try {
          cancelPendingPatch(galleryId, 'gallery');
          const task = await fetchGalleryTask(galleryId);
          if (task) bufferOrSend('upsert', task);
        } catch {
        } finally {
          pendingUpserts.delete(key);
        }
      };

      const upsertSniffTask = async (sniffId: number): Promise<void> => {
        const key = `sniff-${sniffId}`;
        pendingUpserts.add(key);
        try {
          cancelPendingPatch(sniffId, 'sniff');
          const task = await fetchSniffTask(sniffId);
          if (task) bufferOrSend('upsert', task);
        } catch {
        } finally {
          pendingUpserts.delete(key);
        }
      };


      const subs: Array<{ unsubscribe: () => void }> = [];

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
        bufferOrSend('delete', { id: p.taskId, taskType: 'video' });
      }));
      subs.push(eventBus.on('task:scraped', (p) => { upsertVideo(p.taskId); }));

      subs.push(eventBus.on('task:m3u8Select', (p) => {
        upsertVideo(p.taskId);
      }));

      // GraphlibraryEvent
      subs.push(eventBus.on('gallery:scrapeStarted', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'scraping' as TaskStatus });
      }));
      subs.push(eventBus.on('gallery:scrapeCompleted', (p) => { upsertGallery(p.galleryId); }));
      subs.push(eventBus.on('gallery:scrapeFailed', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'failed' as TaskStatus, ErrorMsg: p.error });
      }));
      subs.push(eventBus.on('gallery:downloadStarted', (p) => {
        schedulePatch(p.galleryId, 'gallery', {
          Status: 'downloading' as TaskStatus,
          GalleryProgressInfo: { completed: 0, total: p.total, failed: 0 },
        });
      }));
      subs.push(eventBus.on('gallery:downloadProgress', (p) => {
        const rawProgress = p.total > 0 ? (p.completed / p.total) * 100 : 0;
        const progress = Math.min(rawProgress, 99);
        schedulePatch(p.galleryId, 'gallery', {
          Status: 'downloading' as TaskStatus,
          Progress: progress,
          GalleryProgressInfo: { completed: p.completed, total: p.total, failed: p.failed },
        });
      }));
      subs.push(eventBus.on('gallery:downloadCompleted', (p) => { upsertGallery(p.galleryId); }));
      subs.push(eventBus.on('gallery:downloadFailed', (p) => {
        schedulePatch(p.galleryId, 'gallery', { Status: 'failed' as TaskStatus, ErrorMsg: p.error });
      }));

      // Graphlibrary ZIP Event
      subs.push(eventBus.on('gallery:zipDownloadStarted', (p) => {
        schedulePatch(p.galleryId, 'gallery', {
          Status: 'downloading' as TaskStatus,
          GalleryZipStatus: 'downloading',
        });
      }));
      subs.push(eventBus.on('gallery:zipDownloadProgress', (p) => {
        schedulePatch(p.galleryId, 'gallery', {
          Status: 'downloading' as TaskStatus,
          Progress: p.percent,
          GalleryZipProgressInfo: { downloaded: p.downloaded, total: p.total, percent: p.percent },
        });
      }));
      subs.push(eventBus.on('gallery:zipDownloadCompleted', (p) => {
        schedulePatch(p.galleryId, 'gallery', { GalleryZipStatus: 'extracting' });
        upsertGallery(p.galleryId);
      }));
      subs.push(eventBus.on('gallery:zipDownloadFailed', (p) => {
        schedulePatch(p.galleryId, 'gallery', {
          Status: 'failed' as TaskStatus,
          ErrorMsg: p.error,
          GalleryZipStatus: 'failed',
        });
      }));
      subs.push(eventBus.on('gallery:zipExtractCompleted', (p) => {
        schedulePatch(p.galleryId, 'gallery', { GalleryZipStatus: 'completed' });
        upsertGallery(p.galleryId);
      }));
      subs.push(eventBus.on('gallery:zipExtractFailed', (p) => {
        schedulePatch(p.galleryId, 'gallery', { GalleryZipStatus: 'failed' });
        upsertGallery(p.galleryId);
      }));
      subs.push(eventBus.on('gallery:deleted', (p) => {
        send('delete', { id: p.galleryId, taskType: 'gallery' });
      }));

      subs.push(eventBus.on('sniffTask:started', (p) => {
        schedulePatch(p.sniffId, 'sniff', { Status: 'scraping' as TaskStatus });
      }));
      subs.push(eventBus.on('sniffTask:galleryCreated', (p) => {
        bufferOrSend('sniffTask', {
          action: 'galleryCreated',
          sniffId: p.sniffId,
          galleryId: p.galleryId,
          seq: p.seq,
          title: p.title,
          totalCreated: p.totalCreated,
          totalSkipped: p.totalSkipped,
        });
        schedulePatch(p.sniffId, 'sniff', {
          SniffTotalCreated: p.totalCreated,
          SniffTotalSkipped: p.totalSkipped,
        });
      }));
      subs.push(eventBus.on('sniffTask:completed', (p) => {
        upsertSniffTask(p.sniffId);
      }));
      subs.push(eventBus.on('sniffTask:failed', (p) => {
        schedulePatch(p.sniffId, 'sniff', { Status: 'failed' as TaskStatus, ErrorMsg: p.error });
      }));
      subs.push(eventBus.on('sniffTask:deleted', (p) => {
        bufferOrSend('delete', { id: p.sniffId, taskType: 'sniff' });
      }));
      subs.push(eventBus.on('notification:info', (p) => {
        bufferOrSend('notification', { type: 'info', message: p.message, id: p.id });
      }));
      subs.push(eventBus.on('notification:success', (p) => {
        bufferOrSend('notification', { type: 'success', message: p.message, id: p.id });
      }));
      subs.push(eventBus.on('notification:warning', (p) => {
        bufferOrSend('notification', { type: 'warning', message: p.message, id: p.id });
      }));
      subs.push(eventBus.on('notification:error', (p) => {
        bufferOrSend('notification', { type: 'error', message: p.message, id: p.id });
      }));
      subs.push(eventBus.on('dag:nodeProgress', (p) => {
        bufferOrSend('nodeProgress', {
          dagId: p.dagId,
          nodeId: p.nodeId,
          phase: p.phase,
          current: p.current,
          total: p.total,
          speed: p.speed,
          failed: p.failed,
        });
      }));

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, 15000);

      const cleanup = (): void => {
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
        pendingUpserts.clear();
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
