import type { VideoInfo } from "@/types";

export interface PopupData {
  videoInfo?: VideoInfo;
  segments?: { count: number; totalDuration: number };
}

export const STATUS_KEYS: Record<string, string> = {
  pending: "batchSearch.statusPending",
  scraping: "batchSearch.statusScraping",
  downloaded: "search.statusDownloaded",
  failed: "common.failed",
};

/** Preview URL Cache */
export const previewUrlCache = new Map<string, string>();
export const previewFailCache = new Map<string, number>();
export const FAIL_CACHE_TTL = 30_000;

export const PREVIEW_PLAYBACK_RATE = 8;
export const HOVER_DEBOUNCE_MS = 400;
export const PREVIEW_TIMEOUT_MS = 8000;
export const SPEED_MONITOR_INTERVAL_MS = 500;

/** HLS previewconfig */
export const PREVIEW_HLS_CONFIG = {
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  enableWorker: true,
  startLevel: 0,
  startFragPrefetch: true,
};

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  destroy(): void;
}

declare global {
  interface Window {
    Hls?: {
      new (config: Record<string, unknown>): HlsInstance;
      isSupported(): boolean;
      Events: { MANIFEST_PARSED: string; ERROR: string; FRAG_BUFFERED: string };
    };
  }
}

/**
 * Await HLS.js globalobjectLoadComplete
 */
export function waitForHls(): Promise<typeof window.Hls | null> {
  return new Promise((resolve) => {
    if (window.Hls) {
      resolve(window.Hls);
      return;
    }
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 100;
      if (window.Hls) {
        clearInterval(interval);
        resolve(window.Hls);
      } else if (elapsed >= 3000) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}


export function toProxyUrl(m3u8Url: string, pageUrl: string): string {
  const referer = pageUrl || new URL(m3u8Url).origin + "/";
  return `/api/proxy?referer=${encodeURIComponent(referer)}&url=${encodeURIComponent(m3u8Url)}`;
}


export function parseM3U8(content: string): { count: number; totalDuration: number } {
  const lines = content.split("\n");
  let count = 0;
  let totalDuration = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXTINF:")) {
      const duration = parseFloat(trimmed.substring(8).split(",")[0]);
      if (!isNaN(duration)) {
        totalDuration += duration;
        count++;
      }
    }
  }
  return { count, totalDuration };
}

export type { HlsInstance };
