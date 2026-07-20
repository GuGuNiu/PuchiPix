import { getOrCreateGlobal } from './global-singleton';


export class RateLimiter {
  private windows = new Map<string, number[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly defaultWindowMs: number = 60_000,
    private readonly defaultMaxRequests: number = 10,
    cleanupIntervalMs: number = 60_000,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      (this.cleanupTimer as ReturnType<typeof setInterval>).unref?.();
    }
  }

  checkLimit(
    key: string,
    windowMs?: number,
    maxRequests?: number,
  ): boolean {
    const window = windowMs ?? this.defaultWindowMs;
    const max = maxRequests ?? this.defaultMaxRequests;
    const now = Date.now();
    const cutoff = now - window;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    const valid = timestamps.filter((t) => t > cutoff);
    this.windows.set(key, valid);

    if (valid.length >= max) {
      return false;
    }

    valid.push(now);
    return true;
  }

  getRemaining(
    key: string,
    windowMs?: number,
    maxRequests?: number,
  ): number {
    const window = windowMs ?? this.defaultWindowMs;
    const max = maxRequests ?? this.defaultMaxRequests;
    const now = Date.now();
    const cutoff = now - window;

    const timestamps = this.windows.get(key);
    if (!timestamps) return max;

    const valid = timestamps.filter((t) => t > cutoff);
    return Math.max(0, max - valid.length);
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.defaultWindowMs;

    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.windows.clear();
  }
}

export const rateLimiter = getOrCreateGlobal(
  '__puchipix_rate_limiter__',
  () => new RateLimiter(),
);
