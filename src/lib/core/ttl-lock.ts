import { getOrCreateGlobal } from './global-singleton';

/** 锁句柄 — 获取锁后返回，用于释放和续期 */
export interface LockHandle {
  lockId: string;
  key: string;
  expiresAt: number;
  /** 持有者标识，用于可重入判断 */
  owner?: string;
  /** 当前重入深度（1 = 首次获取，2 = 一次重入，依此类推） */
  reentrancy?: number;
}

/** 获取锁的选项 */
export interface AcquireOptions {
  /** TTL 毫秒数，默认 30000（30s） */
  ttl?: number;
  /** 等待超时毫秒数，0 表示不等待，默认 0 */
  waitTimeout?: number;
  /** 持有者标识，相同 owner 的重复 acquire 视为重入 */
  owner?: string;
}

/** 锁统计信息 */
export interface LockStats {
  activeLocks: number;
  totalWaiters: number;
  reentrantLocks: number;
}

/** withLock 获取失败时抛出 */
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
  /** 所有活跃的 lockId 集合，支持可重入引用计数 */
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
  /** 每个 key 的等待队列，FIFO 公平调度 */
  private waiters: Map<string, WaiterEntry[]> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly cleanupInterval = 5000;

  /**
   * 尝试获取锁。
   *
   * - key 未被锁定（或锁已过期）：立即获取
   * - key 已被锁定但 owner 相同：重入获取，引用计数 +1
   * - key 已被锁定且 owner 不同：等待或返回 null
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
   * 释放锁。
   *
   * 重入锁需要多次 release 直到引用计数归零才会真正释放。
   * 同一 lockId 重复 release 会被安全忽略。
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

  /**
   * 续期锁（延长 TTL）。
   */
  refresh(key: string, lockId: string, ttl: number): boolean {
    const entry = this.locks.get(key);
    if (!entry || !entry.lockIds.has(lockId)) {
      return false;
    }
    entry.expiresAt = Date.now() + ttl;
    return true;
  }

  /**
   * 续期锁（通过 handle）。
   */
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

  /**
   * RAII 风格：自动获取 → 执行 → 释放。
   *
   * 获取失败时抛出 LockAcquisitionError。
   */
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

  /**
   * RAII 风格（静默版）：获取失败返回 null 而非抛出。
   */
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
   * 同步尝试获取锁（含重入判断）。
   *
   * 重入时续期 TTL 为 max(当前剩余, 新 ttl)，
   * 避免重入操作因原 TTL 过期而丢失锁。
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

  /**
   * 加入等待队列，锁释放后通过 Promise 立即通知。
   *
   * 相比旧版轮询（setTimeout 100ms 间隔），
   * 事件驱动方式在锁释放后 0ms 即可唤醒等待者。
   */
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

  /**
   * 锁释放后唤醒队列首部的等待者。
   *
   * FIFO 公平调度：先排队的先获取锁。
   * 跳过已超时的等待者。
   */
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

      // 极端情况：锁在释放和通知之间被其他同步调用获取
      // 将等待者放回队列头部，等待下次通知
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
 * HMR 安全的全局单例导出。
 *
 * 使用 globalThis 存储实例，确保 HMR 热重载时不会重新创建 TTLQueueLock，
 * 从而保留活跃锁、等待者队列和清理定时器。
 */
export const ttlLock = getOrCreateGlobal('__puchipix_ttl_lock__', () => {
  const lock = new TTLQueueLock();
  lock.startCleanup();
  return lock;
});
