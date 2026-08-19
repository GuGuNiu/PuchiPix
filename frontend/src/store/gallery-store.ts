import { create } from 'zustand';
import type { GalleryData, GalleryVideoData, DownloadTask } from '@/types';
import { subscribeSseEvent, onSseConnectionState } from '@/lib/sse/shared-sse';
import { createLogger } from '@/lib/core/infra';

const logger = createLogger('GalleryStore');

interface GalleryProgress {
  galleryId: number;
  completed: number;
  total: number;
  failed: number;
}

interface ZipProgress {
  galleryId: number;
  downloaded: number;
  total: number;
  percent: number;
}

export type ZipStatus = 'idle' | 'downloading' | 'completed' | 'failed' | 'extracting';

interface GalleryStore {
  galleries: GalleryData[];
  loading: boolean;
  sseConnected: boolean;
  progressMap: Record<number, GalleryProgress>;
  zipProgressMap: Record<number, ZipProgress>;
  zipStatusMap: Record<number, ZipStatus>;
  fetchGalleries: () => Promise<void>;
  fetchGalleryDetail: (id: number) => Promise<GalleryData | null>;
  deleteGallery: (id: number) => Promise<boolean>;
  retryDownload: (id: number) => Promise<boolean>;
  downloadZip: (id: number, manualUrl?: string) => Promise<boolean>;
  updateGallery: (id: number, updates: Partial<GalleryData>) => void;
  setProgress: (p: GalleryProgress) => void;
  setZipProgress: (p: ZipProgress) => void;
  setZipStatus: (galleryId: number, status: ZipStatus) => void;
  connectSSE: () => () => void;
  subscribeToSocket: () => () => void;
}

function mapTaskStatusToGallery(status: string): string {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'partial':
      return 'partial';
    case 'downloading':
      return 'downloading';
    case 'download_pending':
      return 'download_pending';
    case 'scraping':
      return 'scraping';
    case 'scrape_pending':
      return 'scrape_pending';
    case 'scraped':
      return 'download_pending';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

const detailInFlight = new Set<number>();

function normalizeGallery(raw: Record<string, unknown>): GalleryData {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const strOrUndef = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : undefined;

  // Go stores tags as a JSON array string, parse it if needed
  let tags: string[] = [];
  const rawTags = raw.tags ?? raw.Tags;
  if (Array.isArray(rawTags)) {
    tags = rawTags;
  } else if (typeof rawTags === 'string') {
    try {
      tags = JSON.parse(rawTags);
    } catch {
      tags = [];
    }
  }

  return {
    ID: num(raw.id ?? raw.ID),
    Seq: str(raw.DisplayID ?? raw.displayID ?? raw.seq ?? raw.Seq),
    SourceURL: str(raw.sourceUrl ?? raw.SourceURL),
    SiteID: str(raw.siteId ?? raw.SiteID),
    ScrapedDomain: str(raw.scrapedDomain ?? raw.ScrapedDomain),
    Title: str(raw.title ?? raw.Title),
    Protagonist: str(raw.protagonist ?? raw.Protagonist),
    Description: str(raw.description ?? raw.Description),
    Category: str(raw.category ?? raw.Category),
    Tags: tags,
    CoverURL: str(raw.coverUrl ?? raw.CoverURL ?? raw.CoverLocalPath ?? raw.coverLocalPath),
    CoverLocalPath: str(raw.coverLocalPath ?? raw.CoverLocalPath),
    ImageCount: num(raw.imageCount ?? raw.ImageCount),
    VideoCount: num(raw.videoCount ?? raw.VideoCount),
    PageCount: num(raw.pageCount ?? raw.PageCount),
    Status: str(raw.status ?? raw.Status) || 'pending',
    DownloadMethod: str(raw.downloadMethod ?? raw.DownloadMethod),
    ExpectedImageCount: num(raw.expectedImageCount ?? raw.ExpectedImageCount),
    ExpectedVideoCount: num(raw.expectedVideoCount ?? raw.ExpectedVideoCount),
    ContentVerified: (raw.contentVerified ?? raw.ContentVerified) === true,
    SavePath: str(raw.savePath ?? raw.SavePath),
    TotalSize: num(raw.totalSize ?? raw.TotalSize),
    DownloadedSize: num(raw.downloadedSize ?? raw.DownloadedSize),
    GameCharacters: (() => {
      const rawGc = raw.gameCharacters ?? raw.GameCharacters;
      if (Array.isArray(rawGc)) return rawGc;
      if (typeof rawGc === 'string') {
        // Fall back to undefined when the stored string is not valid JSON.
        try {
          return JSON.parse(rawGc) as string[];
        } catch {
          return undefined;
        }
      }
      return undefined;
    })(),
    PublishTime: strOrUndef(raw.publishTime ?? raw.PublishTime),
    CreatedAt: str(raw.createdAt ?? raw.CreatedAt),
    UpdatedAt: str(raw.updatedAt ?? raw.UpdatedAt),
    Videos: normalizeGalleryVideos(raw.videos ?? raw.Videos, raw.id ?? raw.ID),
  };
}

function normalizeGalleryVideos(rawVideos: unknown, galleryId: unknown): GalleryVideoData[] {
  if (!Array.isArray(rawVideos)) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return rawVideos.map((v: unknown) => {
    const row = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return {
      ID: (row.id ?? row.ID) as number,
      GalleryID: (row.galleryId ?? row.GalleryID ?? galleryId) as number,
      URL: str(row.url ?? row.URL),
      LocalPath: str(row.localPath ?? row.LocalPath),
      FileName: str(row.fileName ?? row.FileName),
      FileSize: num(row.fileSize ?? row.FileSize),
      Duration: num(row.duration ?? row.Duration),
      Resolution: str(row.resolution ?? row.Resolution),
      Format: str(row.format ?? row.Format),
      Status: normalizeGalleryVideoStatus(str(row.status ?? row.Status)),
      ErrorMsg: str(row.errorMsg ?? row.ErrorMsg),
    };
  });
}

function normalizeGalleryVideoStatus(status: string): string {
  if (status === 'downloaded' || status === 'completed') return 'completed';
  if (status === 'downloading' || status === 'pending') return status;
  return status; // 'failed' and any unknown values pass through
}

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  galleries: [],
  loading: false,
  sseConnected: false,
  progressMap: {},
  zipProgressMap: {},
  zipStatusMap: {},

  fetchGalleries: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/shelf?limit=500');
      const data = await res.json();
      const raw = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      const list: GalleryData[] = raw.map(normalizeGallery);

      const initProgress: Record<number, GalleryProgress> = {};
      for (const item of raw as Record<string, unknown>[]) {
        const id = (item.id ?? item.ID) as number;
        const nested = item.Progress as { completedFiles?: number; totalFiles?: number; failed?: number } | undefined;
        if (nested && typeof nested === 'object' && (nested.totalFiles ?? 0) > 0) {
          initProgress[id] = {
            galleryId: id,
            completed: nested.completedFiles ?? 0,
            total: nested.totalFiles ?? 0,
            failed: nested.failed ?? 0,
          };
        } else {
          const flat = item.progress ?? item.Progress;
          if (typeof flat === 'number' && flat > 0) {
            initProgress[id] = {
              galleryId: id,
              completed: Math.min(Math.round(flat), 100),
              total: 100,
              failed: 0,
            };
          }
        }
      }

      set({ galleries: list, progressMap: initProgress, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchGalleryDetail: async (id: number) => {
    if (detailInFlight.has(id)) return null;
    detailInFlight.add(id);
    try {
      const [detailRes, imagesRes] = await Promise.all([
        fetch(`/api/shelf/${id}`),
        fetch(`/api/shelf/${id}/images`),
      ]);

      if (!detailRes.ok) return null;
      const data = await detailRes.json();
      const hasNested = data?.data && typeof data.data === 'object' && !Array.isArray(data.data);
      const raw = hasNested ? data.data : (data?.ID !== undefined || data?.id !== undefined ? data : null);
      const gallery: GalleryData | null = raw ? normalizeGallery(raw) : null;

      if (gallery && imagesRes.ok) {
        const imagesData = await imagesRes.json();
        const images = Array.isArray(imagesData)
          ? imagesData.map((img: Record<string, unknown>) => ({
              ID: (img.id ?? img.ID) as number,
              GalleryID: (img.galleryId ?? img.GalleryID ?? id) as number,
              URL: ((img.url ?? img.URL) as string) ?? '',
              LocalPath: ((img.localPath ?? img.LocalPath) as string) ?? '',
              FileName: ((img.fileName ?? img.FileName) as string) ?? '',
              PageIndex: (img.pageIndex ?? img.PageIndex ?? 0) as number,
              OrderIndex: (img.orderIndex ?? img.OrderIndex ?? 0) as number,
              Status: ((img.status ?? img.Status) as string) ?? 'pending',
            }))
          : [];
        gallery.Images = images;
      }

      if (gallery) {
        set((s) => {
          const exists = s.galleries.some((g) => g.ID === id);
          return {
            galleries: exists
              ? s.galleries.map((g) => (g.ID === id ? gallery : g))
              : [gallery, ...s.galleries],
          };
        });
      }
      return gallery;
    } catch {
      return null;
    } finally {
      detailInFlight.delete(id);
    }
  },

  deleteGallery: async (id: number) => {
    try {
      const res = await fetch(`/api/shelf/${id}`, { method: 'DELETE' });
      if (!res.ok) return false;
      set((s) => ({
        galleries: s.galleries.filter((g) => g.ID !== id),
        progressMap: (() => {
          const next = { ...s.progressMap };
          delete next[id];
          return next;
        })(),
      }));
      return true;
    } catch {
      return false;
    }
  },

  retryDownload: async (id: number) => {
    try {
      const res = await fetch(`/api/shelf/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  downloadZip: async (id: number, manualUrl?: string) => {
    set((s) => ({
      zipStatusMap: { ...s.zipStatusMap, [id]: 'downloading' },
      zipProgressMap: { ...s.zipProgressMap, [id]: { galleryId: id, downloaded: 0, total: 0, percent: 0 } },
    }));
    try {
      const res = await fetch(`/api/shelf/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download-zip', ...(manualUrl ? { manualUrl } : {}) }),
      });
      const data = await res.json();
      if (data.success) {
        set((s) => ({ zipStatusMap: { ...s.zipStatusMap, [id]: 'completed' } }));
        get().fetchGalleryDetail(id);
        return true;
      } else {
        set((s) => ({ zipStatusMap: { ...s.zipStatusMap, [id]: 'failed' } }));
        return false;
      }
    } catch {
      set((s) => ({ zipStatusMap: { ...s.zipStatusMap, [id]: 'failed' } }));
      return false;
    }
  },

  updateGallery: (id, updates) =>
    set((s) => ({
      galleries: s.galleries.map((g) => (g.ID === id ? { ...g, ...updates } : g)),
    })),

  setProgress: (p) =>
    set((s) => ({
      progressMap: { ...s.progressMap, [p.galleryId]: p },
    })),

  setZipProgress: (p) =>
    set((s) => ({
      zipProgressMap: { ...s.zipProgressMap, [p.galleryId]: p },
    })),

  setZipStatus: (galleryId, status) =>
    set((s) => ({
      zipStatusMap: { ...s.zipStatusMap, [galleryId]: status },
    })),

  connectSSE: () => {
    /* Shared resident connection: route switching no longer tears down and re-establishes the stream. Pages only subscribe/unsubscribe. */
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSseConnectionState((connState) => {
        set({ sseConnected: connState === 'connected' });
      }),
    );

    unsubs.push(
      subscribeSseEvent('initial', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as DownloadTask[];
          if (data.length === 0) return;

          const galleryTasks = data.filter((t) => t.TaskType === 'gallery');
          if (galleryTasks.length === 0) return;

          set((s) => ({
            galleries: s.galleries.map((g) => {
              const task = galleryTasks.find((t) => t.ID === g.ID);
              if (task && task.Status) {
                return { ...g, Status: mapTaskStatusToGallery(task.Status) };
              }
              return g;
            }),
          }));
        } catch (err) {
          logger.warn('SSE initial parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:progress', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number;
            taskType: string;
            progress: number;
            completed?: number;
            total?: number;
            failed?: number;
            status: string;
            downloadedSize?: number;
          };
          if (payload.taskType !== 'gallery') return;

          if (payload.status) {
            const galleryStatus = mapTaskStatusToGallery(payload.status);
            set((s) => ({
              galleries: s.galleries.map((g) =>
                g.ID === payload.taskId ? { ...g, Status: galleryStatus } : g,
              ),
            }));
          }

          if (payload.total !== undefined && payload.total > 0) {
            const progress: GalleryProgress = {
              galleryId: payload.taskId,
              completed: payload.completed ?? 0,
              total: payload.total,
              failed: payload.failed ?? 0,
            };
            set((s) => ({
              progressMap: { ...s.progressMap, [payload.taskId]: progress },
            }));
          }

          if (payload.downloadedSize !== undefined && payload.downloadedSize > 0) {
            set((s) => ({
              galleries: s.galleries.map((g) =>
                g.ID === payload.taskId
                  ? { ...g, DownloadedSize: Math.max(g.DownloadedSize || 0, payload.downloadedSize!) }
                  : g,
              ),
            }));
          }
        } catch (err) {
          logger.warn('SSE task:progress parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:completed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number;
            taskType?: string;
            status?: string;
          };
          if (payload.taskType && payload.taskType !== 'gallery') return;
          const galleryStatus = mapTaskStatusToGallery(payload.status || 'completed');
          set((s) => ({
            galleries: s.galleries.map((g) =>
              g.ID === payload.taskId ? { ...g, Status: galleryStatus } : g,
            ),
          }));
        } catch (err) {
          logger.warn('SSE task:completed parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:failed', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as { taskId: number; error?: string };
          set((s) => ({
            galleries: s.galleries.map((g) =>
              g.ID === payload.taskId ? { ...g, Status: 'failed' } : g,
            ),
          }));
        } catch (err) {
          logger.warn('SSE task:failed parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('gallery:created', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as { ID: number; TaskType?: string };
          if (!raw.ID) return;
          get().fetchGalleryDetail(raw.ID);
        } catch (err) {
          logger.warn('SSE gallery:created parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('gallery:stateChanged', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            dagId: string;
            status: string;
            galleryId?: number;
          };
          let galleryId = payload.galleryId ?? NaN;
          if (isNaN(galleryId) && payload.dagId.startsWith('gallery-')) {
            galleryId = parseInt(payload.dagId.replace('gallery-', ''), 10);
          }
          if (isNaN(galleryId)) return;
          set((s) => ({
            galleries: s.galleries.map((g) =>
              g.ID === galleryId ? { ...g, Status: mapTaskStatusToGallery(payload.status) } : g,
            ),
          }));
        } catch (err) {
          logger.warn('SSE gallery:stateChanged parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('task:cancelled', (e: MessageEvent) => {
        try {
          const raw = JSON.parse(e.data) as { taskId: number; taskType?: string };
          if (raw.taskType && raw.taskType !== 'gallery') return;
          const { taskId } = raw;
          set((s) => {
            if (!s.galleries.some((g) => g.ID === taskId)) return s;
            return {
              galleries: s.galleries.filter((g) => g.ID !== taskId),
              progressMap: (() => {
                const next = { ...s.progressMap };
                delete next[taskId];
                return next;
              })(),
              zipStatusMap: (() => {
                const next = { ...s.zipStatusMap };
                delete next[taskId];
                return next;
              })(),
            };
          });
        } catch (err) {
          logger.warn('SSE task:cancelled parse failed', { error: err instanceof Error ? err.message : String(err) });
        }
      }),
    );

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  },

  subscribeToSocket: () => {
    return get().connectSSE();
  },
}));
