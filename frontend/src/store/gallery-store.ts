import { create } from 'zustand';
import type { GalleryData, DownloadTask, TaskStatus } from '@/types';
import { subscribeSseEvent, onSseConnectionState } from '@/lib/sse/shared-sse';

export interface GalleryProgress {
  galleryId: number;
  completed: number;
  total: number;
  failed: number;
}

export interface ZipProgress {
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

function mapTaskStatusToGallery(status: TaskStatus): string {
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
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

const detailInFlight = new Set<number>();

/*
 * Go backend returns camelCase JSON; TypeScript types use PascalCase.
 * Normalize at the data boundary so the rest of the app doesn't need changes.
 */
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
  };
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
      // Go backend returns a bare array, TS backend wrapped in { data: [...] }
      const raw = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      const list: GalleryData[] = raw.map(normalizeGallery);
      set({ galleries: list, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchGalleryDetail: async (id: number) => {
    if (detailInFlight.has(id)) return null;
    detailInFlight.add(id);
    try {
      // Fetch gallery metadata and images in parallel
      const [detailRes, imagesRes] = await Promise.all([
        fetch(`/api/shelf/${id}`),
        fetch(`/api/shelf/${id}/images`),
      ]);

      if (!detailRes.ok) return null;
      const data = await detailRes.json();
      // Go backend returns bare object, TS backend wrapped in { data: {...} }
      const raw = data?.data ?? (data?.id ? data : null);
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
          console.warn('[GalleryStore] SSE initial parse failed:', err instanceof Error ? err.message : String(err));
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('patch', (e: MessageEvent) => {
        try {
          const { id, taskType, changes } = JSON.parse(e.data) as {
            id: number;
            taskType: string;
            changes: Partial<DownloadTask>;
          };
          if (taskType !== 'gallery') return;

          if (changes.Status) {
            const galleryStatus = mapTaskStatusToGallery(changes.Status);
            set((s) => ({
              galleries: s.galleries.map((g) =>
                g.ID === id ? { ...g, Status: galleryStatus } : g,
              ),
            }));
          }

          if (changes.GalleryProgressInfo) {
            const info = changes.GalleryProgressInfo;
            set((s) => ({
              progressMap: {
                ...s.progressMap,
                [id]: { galleryId: id, completed: info.completed, total: info.total, failed: info.failed },
              },
            }));
          }

          if (changes.GalleryZipProgressInfo) {
            const info = changes.GalleryZipProgressInfo;
            set((s) => ({
              zipProgressMap: {
                ...s.zipProgressMap,
                [id]: { galleryId: id, downloaded: info.downloaded, total: info.total, percent: info.percent },
              },
            }));
          }

          if (changes.GalleryZipStatus) {
            const zipStatus = changes.GalleryZipStatus as ZipStatus;
            set((s) => ({
              zipStatusMap: { ...s.zipStatusMap, [id]: zipStatus },
            }));
          }
        } catch (err) {
          console.warn('[GalleryStore] SSE patch parse failed:', err instanceof Error ? err.message : String(err));
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('upsert', (e: MessageEvent) => {
        try {
          const task = JSON.parse(e.data) as DownloadTask;
          if (task.TaskType !== 'gallery') return;
          get().fetchGalleryDetail(task.ID);
        } catch (err) {
          console.warn('[GalleryStore] SSE upsert parse failed:', err instanceof Error ? err.message : String(err));
        }
      }),
    );

    unsubs.push(
      subscribeSseEvent('delete', (e: MessageEvent) => {
        try {
          const { id, taskType } = JSON.parse(e.data) as {
            id: number;
            taskType: string;
          };
          if (taskType !== 'gallery') return;
          set((s) => ({
            galleries: s.galleries.filter((g) => g.ID !== id),
            progressMap: (() => {
              const next = { ...s.progressMap };
              delete next[id];
              return next;
            })(),
            zipStatusMap: (() => {
              const next = { ...s.zipStatusMap };
              delete next[id];
              return next;
            })(),
          }));
        } catch (err) {
          console.warn('[GalleryStore] SSE delete parse failed:', err instanceof Error ? err.message : String(err));
        }
      }),
    );

    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
      /* The shared connection lives for the whole App lifetime; here we only unsubscribe. */
    };
  },

  subscribeToSocket: () => {
    return get().connectSSE();
  },
}));
