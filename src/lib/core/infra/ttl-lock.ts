import { getOrCreateGlobal } from './global-singleton';

export interface LockHandle {
  lockId: string;
  key: string;
  expiresAt: number;
  owner?: string;
  reentrancy?: number;
}

/** GetLock option */
export interface AcquireOptions {
  ttl?: number;
  waitTimeout?: number;
  owner?: string;
}

export interface LockStats {
  activeLocks: number;
  totalWaiters: number;
  reentrantLocks: number;
}

export class LockAcquisitionError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`Failed to acquire lock: ${key}`);
    this.name = 'LockAcquisitionError';
    this.key = key;
  }
}

interface LockEntry {
  key: string;
  owner?: string;
  lockIds: Set<string>;
  expiresAt: number;
  createdAt: number;
}

interface WaiterEntry {
  resolve: (handle: LockHandle | null) => void;
  deadline: number;
  ttl: number;
  owner?: string;
}

class TTLQueueLock {
  private locks: Map<string, LockEntry> = new Map();
  private waiters: Map<string, WaiterEntry[]> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly cleanupInterval = 5000;

  /**
   * TryGetLock。
   *
   */
  async acquire(key: string, options: AcquireOptions = {}): Promise<LockHandle | null> {
    const ttl = options.ttl ?? 30000;
    const waitTimeout = options.waitTimeout ?? 0;
    const owner = options.owner || undefined;

    const handle = this.tryAcquire(key, ttl, owner);
    if (handle) return handle;

    if (waitTimeout <= 0) return null;

    return this.enqueueWaiter(key, ttl, waitTimeout, owner);
  }

  /**
   * Release lock。
   *
   */
  release(key: string, lockId: string): boolean {
    const entry = this.locks.get(key);
    if (!entry || !entry.lockIds.has(lockId)) {
      return false;
    }

    entry.lockIds.delete(lockId);

    if (entry.lockIds.size > 0) {
      return true;
    }

    this.locks.delete(key);
    this.notifyWaiter(key);
    return true;
  }

  releaseHandle(handle: LockHandle): boolean {
    return this.release(handle.key, handle.lockId);
  }

  
  refresh(key: string, lockId: string, ttl: number): boolean {
    const entry = this.locks.get(key);
    if (!entry || !entry.lockIds.has(lockId)) {
      return false;
    }
    entry.expiresAt = Date.now() + ttl;
    return true;
  }

  
  refreshHandle(handle: LockHandle, ttl: number): boolean {
    return this.refresh(handle.key, handle.lockId, ttl);
  }

  isLocked(key: string): boolean {
    const entry = this.locks.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      this.locks.delete(key);
      this.notifyWaiter(key);
      return false;
    }
    return true;
  }

  getActiveLocks(): Array<{
    key: string;
    owner?: string;
    reentrancy: number;
    expiresAt: number;
    remaining: number;
  }> {
    this.cleanupExpired();
    return Array.from(this.locks.values()).map((entry) => ({
      key: entry.key,
      owner: entry.owner,
      reentrancy: entry.lockIds.size,
      expiresAt: entry.expiresAt,
      remaining: Math.max(0, entry.expiresAt - Date.now()),
    }));
  }

  getStats(): LockStats {
    this.cleanupExpired();
    let totalWaiters = 0;
    for (const queue of this.waiters.values()) {
      totalWaiters += queue.length;
    }
    let reentrantLocks = 0;
    for (const entry of this.locks.values()) {
      if (entry.lockIds.size > 1) reentrantLocks++;
    }
    return {
      activeLocks: this.locks.size,
      totalWaiters,
      reentrantLocks,
    };
  }

  
  async withLock<T>(
    key: string,
    options: AcquireOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const handle = await this.acquire(key, options);
    if (!handle) {
      throw new LockAcquisitionError(key);
    }
    try {
      return await fn();
    } finally {
      this.releaseHandle(handle);
    }
  }

  
  async tryWithLock<T>(
    key: string,
    options: AcquireOptions,
    fn: () => Promise<T>,
  ): Promise<T | null> {
    const handle = await this.acquire(key, options);
    if (!handle) return null;
    try {
      return await fn();
    } finally {
      this.releaseHandle(handle);
    }
  }

  clear(): void {
    for (const queue of this.waiters.values()) {
      for (const waiter of queue) {
        waiter.resolve(null);
      }
    }
    this.waiters.clear();
    this.locks.clear();
  }

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupInterval);
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * TryGetLock internalImplementation。
   *
   */
  private tryAcquire(key: string, ttl: number, owner?: string): LockHandle | null {
    const now = Date.now();

    const existing = this.locks.get(key);

    if (existing && now < existing.expiresAt) {
      if (owner && existing.owner === owner) {
        const lockId = this.generateLockId();
        existing.lockIds.add(lockId);
        existing.expiresAt = Math.max(existing.expiresAt, now + ttl);
        return {
          lockId,
          key,
          owner,
          expiresAt: existing.expiresAt,
          reentrancy: existing.lockIds.size,
        };
      }
      return null;
    }

    if (existing) {
      this.locks.delete(key);
      this.notifyWaiter(key);
    }

    const lockId = this.generateLockId();
    const expiresAt = now + ttl;
    this.locks.set(key, {
      key,
      owner,
      lockIds: new Set([lockId]),
      expiresAt,
      createdAt: now,
    });

    return { lockId, key, owner, expiresAt, reentrancy: 1 };
  }

  
  private enqueueWaiter(
    key: string,
    ttl: number,
    waitTimeout: number,
    owner?: string,
  ): Promise<LockHandle | null> {
    return new Promise<LockHandle | null>((resolve) => {
      const deadline = Date.now() + waitTimeout;

      const waiter: WaiterEntry = {
        resolve,
        deadline,
        ttl,
        owner,
      };

      let queue = this.waiters.get(key);
      if (!queue) {
        queue = [];
        this.waiters.set(key, queue);
      }
      queue.push(waiter);

      const timer = setTimeout(() => {
        const q = this.waiters.get(key);
        if (q) {
          const idx = q.indexOf(waiter);
          if (idx !== -1) q.splice(idx, 1);
          if (q.length === 0) this.waiters.delete(key);
        }
        resolve(null);
      }, waitTimeout);

      const originalResolve = waiter.resolve;
      waiter.resolve = (handle: LockHandle | null) => {
        clearTimeout(timer);
        originalResolve(handle);
      };
    });
  }

  
  private notifyWaiter(key: string): void {
    const queue = this.waiters.get(key);
    if (!queue || queue.length === 0) return;

    while (queue.length > 0) {
      const waiter = queue.shift()!;

      if (queue.length === 0) {
        this.waiters.delete(key);
      }

      if (Date.now() >= waiter.deadline) continue;

      const handle = this.tryAcquire(key, waiter.ttl, waiter.owner);
      if (handle) {
        waiter.resolve(handle);
        return;
      }

      queue.unshift(waiter);
      this.waiters.set(key, queue);
      return;
    }
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks) {
      if (now >= entry.expiresAt) {
        this.locks.delete(key);
        this.notifyWaiter(key);
      }
    }
  }

  private generateLockId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * HMR security globalSingletonExport。
 *
 */
export const ttlLock = getOrCreateGlobal('__puchipix_ttl_lock__', () => {
  const lock = new TTLQueueLock();
  lock.startCleanup();
  return lock;
});
