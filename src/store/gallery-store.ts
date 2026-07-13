/**
 * 图库状态管理 Store
 *
 * 管理图库列表数据、下载进度追踪和 WebSocket 实时更新。
 *
 * @date 2026-07-11
 * @lastModified 2026-07-11
 */

import { create } from 'zustand';
import type { GalleryData } from '@/types';
import { useSocketStore } from './socket-store';

/** 单个图库的实时下载进度 */
export interface GalleryProgress {
  galleryId: number;
  completed: number;
  total: number;
  failed: number;
}

/** ZIP 下载进度 */
export interface ZipProgress {
  galleryId: number;
  downloaded: number;
  total: number;
  percent: number;
}

/** ZIP 下载状态 */
export type ZipStatus = 'idle' | 'downloading' | 'completed' | 'failed' | 'extracting';

interface GalleryStore {
  galleries: GalleryData[];
  loading: boolean;
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
  subscribeToSocket: () => () => void;
}

export const useGalleryStore = create<GalleryStore>((set, get) => ({
  galleries: [],
  loading: false,
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
    try {
      const res = await fetch(`/api/gallery/${id}`);
      if (!res.ok) return null;
      const data = await res.json();
      const gallery: GalleryData | null = data?.data ?? null;
      if (gallery) {
        set((s) => ({
          galleries: s.galleries.map((g) => (g.ID === id ? gallery : g)),
        }));
      }
      return gallery;
    } catch {
      return null;
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
      const res = await fetch(`/api/gallery/${id}/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
      const res = await fetch(`/api/gallery/${id}/download-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualUrl ? { manualUrl } : {}),
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

  subscribeToSocket: () => {
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    let currentSocket: ReturnType<typeof useSocketStore.getState>['socket'] = null;

    const scheduleRefetch = () => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        get().fetchGalleries();
      }, 800);
    };

    const handleScrapeCompleted = (msg: { galleryId: number }) => {
      // 爬取完成后立即刷新详情，让用户马上看到图片列表
      get().fetchGalleryDetail(msg.galleryId);
      scheduleRefetch();
    };

    const handleScrapeFailed = (msg: { galleryId: number }) => {
      get().updateGallery(msg.galleryId, { Status: 'failed' });
    };

    const handleDownloadStarted = (msg: { galleryId: number; total: number }) => {
      get().setProgress({ galleryId: msg.galleryId, completed: 0, total: msg.total, failed: 0 });
      get().updateGallery(msg.galleryId, { Status: 'downloading' });
    };

    const handleDownloadProgress = (msg: {
      galleryId: number;
      completed: number;
      total: number;
      failed: number;
    }) => {
      get().setProgress(msg);
    };

    const handleDownloadCompleted = (msg: { galleryId: number }) => {
      // 下载完成后立即刷新该图包详情，让用户马上看到图片
      get().fetchGalleryDetail(msg.galleryId);
      scheduleRefetch();
    };

    const handleDownloadFailed = (msg: { galleryId: number; error: string }) => {
      get().updateGallery(msg.galleryId, { Status: 'failed' });
    };

    // ZIP 下载事件
    const handleZipDownloadStarted = (msg: { galleryId: number; url: string }) => {
      get().setZipStatus(msg.galleryId, 'downloading');
    };

    const handleZipDownloadProgress = (msg: {
      galleryId: number;
      downloaded: number;
      total: number;
      percent: number;
    }) => {
      get().setZipProgress(msg);
    };

    const handleZipDownloadCompleted = (msg: { galleryId: number; localPath: string; actualSize: number }) => {
      get().setZipStatus(msg.galleryId, 'extracting');
    };

    const handleZipDownloadFailed = (msg: { galleryId: number; error: string }) => {
      get().setZipStatus(msg.galleryId, 'failed');
    };

    const handleZipExtractFailed = (msg: { galleryId: number; error: string }) => {
      get().setZipStatus(msg.galleryId, 'failed');
    };

    const handleZipExtractCompleted = (msg: { galleryId: number; extractedPath: string; fileCount: number }) => {
      get().setZipStatus(msg.galleryId, 'completed');
      // 解压完成后立即刷新详情，让用户马上看到图片
      get().fetchGalleryDetail(msg.galleryId);
      scheduleRefetch();
    };

    const events: Array<[string, (...args: unknown[]) => void]> = [
      ['gallery:scrapeCompleted', (...args: unknown[]) => handleScrapeCompleted(args[0] as { galleryId: number })],
      ['gallery:scrapeFailed', (...args: unknown[]) => handleScrapeFailed(args[0] as { galleryId: number })],
      ['gallery:downloadStarted', (...args: unknown[]) => handleDownloadStarted(args[0] as { galleryId: number; total: number })],
      ['gallery:downloadProgress', (...args: unknown[]) => handleDownloadProgress(args[0] as { galleryId: number; completed: number; total: number; failed: number })],
      ['gallery:downloadCompleted', (...args: unknown[]) => handleDownloadCompleted(args[0] as { galleryId: number })],
      ['gallery:downloadFailed', (...args: unknown[]) => handleDownloadFailed(args[0] as { galleryId: number; error: string })],
      ['gallery:zipDownloadStarted', (...args: unknown[]) => handleZipDownloadStarted(args[0] as { galleryId: number; url: string })],
      ['gallery:zipDownloadProgress', (...args: unknown[]) => handleZipDownloadProgress(args[0] as { galleryId: number; downloaded: number; total: number; percent: number })],
      ['gallery:zipDownloadCompleted', (...args: unknown[]) => handleZipDownloadCompleted(args[0] as { galleryId: number; localPath: string; actualSize: number })],
      ['gallery:zipDownloadFailed', (...args: unknown[]) => handleZipDownloadFailed(args[0] as { galleryId: number; error: string })],
      ['gallery:zipExtractFailed', (...args: unknown[]) => handleZipExtractFailed(args[0] as { galleryId: number; error: string })],
      ['gallery:zipExtractCompleted', (...args: unknown[]) => handleZipExtractCompleted(args[0] as { galleryId: number; extractedPath: string; fileCount: number })],
    ];

    const attach = (socket: NonNullable<typeof currentSocket>) => {
      for (const [event, handler] of events) {
        socket.on(event, handler as (...args: unknown[]) => void);
      }
    };

    const detach = (socket: NonNullable<typeof currentSocket>) => {
      for (const [event, handler] of events) {
        socket.off(event, handler as (...args: unknown[]) => void);
      }
    };

    const initial = useSocketStore.getState().socket;
    if (initial) {
      currentSocket = initial;
      attach(initial);
    }

    const unsubSocketStore = useSocketStore.subscribe((state, prevState) => {
      if (state.socket === prevState.socket) return;
      if (currentSocket) detach(currentSocket);
      currentSocket = state.socket;
      if (currentSocket) attach(currentSocket);
    });

    return () => {
      if (refetchTimer) {
        clearTimeout(refetchTimer);
        refetchTimer = null;
      }
      if (currentSocket) detach(currentSocket);
      unsubSocketStore();
    };
  },
}));
