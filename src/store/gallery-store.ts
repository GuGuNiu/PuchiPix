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
      const res = await fetch('/api/gallery?limit=100');
      const data = await res.json();
      const list: GalleryData[] = Array.isArray(data?.data) ? data.data : [];
      set({ galleries: list, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  fetchGalleryDetail: async (id: number) => {
    if (detailInFlight.has(id)) return null;
    detailInFlight.add(id);
    try {
      const res = await fetch(`/api/gallery/${id}`);
      if (!res.ok) return null;
      const data = await res.json();
      const gallery: GalleryData | null = data?.data ?? null;
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
      const res = await fetch(`/api/gallery/${id}`, { method: 'DELETE' });
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
      const res = await fetch(`/api/gallery/${id}`, {
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
      const res = await fetch(`/api/gallery/${id}`, {
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
