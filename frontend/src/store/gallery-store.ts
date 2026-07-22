import { create } from 'zustand';
import type { GalleryData, DownloadTask, TaskStatus } from '@/types';

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

// Go backend returns camelCase JSON; TypeScript types use PascalCase.
// Normalize at the data boundary so the rest of the app doesn't need changes.
function normalizeGallery(raw: any): GalleryData {
  // Go stores tags as a JSON array string, parse it if needed
  let tags: string[] = [];
  if (Array.isArray(raw.tags ?? raw.Tags)) {
    tags = raw.tags ?? raw.Tags;
  } else if (typeof raw.tags === 'string') {
    try { tags = JSON.parse(raw.tags); } catch { tags = []; }
  } else if (typeof raw.Tags === 'string') {
    try { tags = JSON.parse(raw.Tags); } catch { tags = []; }
  }

  return {
    ID: raw.id ?? raw.ID,
    Seq: raw.seq ?? raw.Seq,
    SourceURL: raw.sourceUrl ?? raw.SourceURL ?? '',
    SiteID: raw.siteId ?? raw.SiteID ?? '',
    ScrapedDomain: raw.scrapedDomain ?? raw.ScrapedDomain ?? '',
    Title: raw.title ?? raw.Title ?? '',
    Protagonist: raw.protagonist ?? raw.Protagonist ?? '',
    Description: raw.description ?? raw.Description ?? '',
    Category: raw.category ?? raw.Category ?? '',
    Tags: tags,
    CoverURL: raw.coverUrl ?? raw.CoverURL ?? raw.CoverLocalPath ?? raw.coverLocalPath ?? '',
    CoverLocalPath: raw.coverLocalPath ?? raw.CoverLocalPath ?? '',
    ImageCount: raw.imageCount ?? raw.ImageCount ?? 0,
    VideoCount: raw.videoCount ?? raw.VideoCount ?? 0,
    PageCount: raw.pageCount ?? raw.PageCount ?? 0,
    Status: raw.status ?? raw.Status ?? 'pending',
    DownloadMethod: raw.downloadMethod ?? raw.DownloadMethod ?? '',
    ExpectedImageCount: raw.expectedImageCount ?? raw.ExpectedImageCount ?? 0,
    ExpectedVideoCount: raw.expectedVideoCount ?? raw.ExpectedVideoCount ?? 0,
    ContentVerified: raw.contentVerified ?? raw.ContentVerified ?? false,
    SavePath: raw.savePath ?? raw.SavePath ?? '',
    TotalSize: raw.totalSize ?? raw.TotalSize ?? 0,
    DownloadedSize: raw.downloadedSize ?? raw.DownloadedSize ?? 0,
    GameCharacters: (() => {
      const rawGc = raw.gameCharacters ?? raw.GameCharacters;
      if (Array.isArray(rawGc)) return rawGc;
      if (typeof rawGc === 'string') {
        try { return JSON.parse(rawGc) as string[]; } catch { /* ignore */ }
      }
      return undefined;
    })(),
    PublishTime: raw.publishTime ?? raw.PublishTime ?? undefined,
    CreatedAt: raw.createdAt ?? raw.CreatedAt ?? '',
    UpdatedAt: raw.updatedAt ?? raw.UpdatedAt ?? '',
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
          ? imagesData.map((img: any) => ({
              ID: img.id ?? img.ID,
              GalleryID: img.galleryId ?? img.GalleryID ?? id,
              URL: img.url ?? img.URL ?? '',
              LocalPath: img.localPath ?? img.LocalPath ?? '',
              FileName: img.fileName ?? img.FileName ?? '',
              PageIndex: img.pageIndex ?? img.PageIndex ?? 0,
              OrderIndex: img.orderIndex ?? img.OrderIndex ?? 0,
              Status: img.status ?? img.Status ?? 'pending',
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
    let eventSource: EventSource | null = null;

    const connect = (): void => {
      eventSource = new EventSource('/api/tasks/stream');

      eventSource.onopen = () => {
        set({ sseConnected: true });
      };

      eventSource.onerror = () => {
        set({ sseConnected: false });
      };

      eventSource.addEventListener('initial', (e: MessageEvent) => {
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
      });

      eventSource.addEventListener('patch', (e: MessageEvent) => {
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
      });

      eventSource.addEventListener('upsert', (e: MessageEvent) => {
        try {
          const task = JSON.parse(e.data) as DownloadTask;
          if (task.TaskType !== 'gallery') return;
          get().fetchGalleryDetail(task.ID);
        } catch (err) {
          console.warn('[GalleryStore] SSE upsert parse failed:', err instanceof Error ? err.message : String(err));
        }
      });

      eventSource.addEventListener('delete', (e: MessageEvent) => {
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
      });
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      set({ sseConnected: false });
    };
  },

  subscribeToSocket: () => {
    return get().connectSSE();
  },
}));
