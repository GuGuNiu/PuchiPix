import { getOrCreateGlobal } from './global-singleton';
import { eventBus } from './event-bus';

const SAMPLE_WINDOW_MS = 3000;
const MAX_SAMPLES = 60;
const IDLE_TIMEOUT_MS = 5000;

interface SpeedSample {
  timestamp: number;
  bytesPerSec: number;
}

interface DownloadState {
  lastDownloaded: number;
  lastTimestamp: number;
}

class NetworkMonitor {
  private activeDownloads: Map<number, DownloadState> = new Map();
  private samples: SpeedSample[] = [];
  private subscription: { unsubscribe: () => void } | null = null;

  constructor() {
    this.subscribe();
  }

  /**
   * Subscribe EventBus DownloadProgressEvent
   */
  private subscribe(): void {
    this.subscription = eventBus.on('gallery:zipDownloadProgress', (payload) => {
      const { galleryId, downloaded } = payload;
      const now = Date.now();

      const existing = this.activeDownloads.get(galleryId);
      if (existing) {
        const deltaBytes = downloaded - existing.lastDownloaded;
        const deltaTime = now - existing.lastTimestamp;

        if (deltaTime > 0 && deltaBytes >= 0) {
          const bytesPerSec = Math.round((deltaBytes / deltaTime) * 1000);
          this.addSample(bytesPerSec);
        }
      }

      this.activeDownloads.set(galleryId, { lastDownloaded: downloaded, lastTimestamp: now });
      this.pruneOldDownloads(now);
    });
  }

  private addSample(bytesPerSec: number): void {
    const now = Date.now();
    this.samples.push({ timestamp: now, bytesPerSec });

    const cutoff = now - SAMPLE_WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0].timestamp < cutoff) {
      this.samples.shift();
    }

    while (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  /**
   * Clean upTimeout DownloadState
   */
  private pruneOldDownloads(now: number): void {
    for (const [id, state] of this.activeDownloads) {
      if (now - state.lastTimestamp > IDLE_TIMEOUT_MS) {
        this.activeDownloads.delete(id);
      }
    }
  }

  getCurrentSpeed(): number {
    this.pruneOldDownloads(Date.now());

    if (this.samples.length === 0) {
      return 0;
    }

    const total = this.samples.reduce((sum, s) => sum + s.bytesPerSec, 0);
    return Math.round(total / this.samples.length);
  }

  getDiskWriteSpeed(): number {
    return this.getCurrentSpeed();
  }

  getActiveDownloadCount(): number {
    this.pruneOldDownloads(Date.now());
    return this.activeDownloads.size;
  }

  /**
   * DestroySubscribe
   */
  destroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}

const GLOBAL_KEY = '__puchipix_network_monitor__';

export function getNetworkMonitor(): NetworkMonitor {
  return getOrCreateGlobal(GLOBAL_KEY, () => new NetworkMonitor());
}
