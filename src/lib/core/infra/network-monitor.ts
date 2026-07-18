import { getOrCreateGlobal } from './global-singleton';
import { eventBus } from './event-bus';

const SAMPLE_WINDOW_MS = 3000; // 3 秒滑动窗口
const MAX_SAMPLES = 60; // 最多保留 60 个采样点
const IDLE_TIMEOUT_MS = 5000; // 5 秒无进度 → 认为下载停止

interface SpeedSample {
  timestamp: number;
  bytesPerSec: number;
}

interface DownloadState {
  lastDownloaded: number;
  lastTimestamp: number;
}

class NetworkMonitor {
  /** 每个下载任务的进度状态（galleryId → state） */
  private activeDownloads: Map<number, DownloadState> = new Map();
  /** 速度采样历史 */
  private samples: SpeedSample[] = [];
  /** 订阅句柄 */
  private subscription: { unsubscribe: () => void } | null = null;

  constructor() {
    this.subscribe();
  }

  /**
   * 订阅 EventBus 下载进度事件
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

  /**
   * 添加速度采样
   */
  private addSample(bytesPerSec: number): void {
    const now = Date.now();
    this.samples.push({ timestamp: now, bytesPerSec });

    // 移除过期的采样
    const cutoff = now - SAMPLE_WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0].timestamp < cutoff) {
      this.samples.shift();
    }

    // 限制最大采样数
    while (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }

  /**
   * 清理超时的下载状态
   */
  private pruneOldDownloads(now: number): void {
    for (const [id, state] of this.activeDownloads) {
      if (now - state.lastTimestamp > IDLE_TIMEOUT_MS) {
        this.activeDownloads.delete(id);
      }
    }
  }

  /**
   * 获取当前网络速度（字节/秒）
   *
   * 使用滑动窗口内所有采样的平均值。
   */
  getCurrentSpeed(): number {
    this.pruneOldDownloads(Date.now());

    if (this.samples.length === 0) {
      return 0;
    }

    const total = this.samples.reduce((sum, s) => sum + s.bytesPerSec, 0);
    return Math.round(total / this.samples.length);
  }

  /**
   * 获取当前硬盘写入速度（字节/秒）
   *
   * 假设下载后即时写入硬盘，写入速度 = 网络速度。
   */
  getDiskWriteSpeed(): number {
    return this.getCurrentSpeed();
  }

  /**
   * 获取活跃下载任务数
   */
  getActiveDownloadCount(): number {
    this.pruneOldDownloads(Date.now());
    return this.activeDownloads.size;
  }

  /**
   * 销毁订阅
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
