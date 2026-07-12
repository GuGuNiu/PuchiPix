/**
 * 模块：TTL 队列锁
 *
 * 基于 key 的分布式锁，带自动过期（TTL）和队列等待能力。
 *
 * 核心能力：
 * 1. 互斥锁：同一 key 同时只能有一个持有者
 * 2. 自动过期：TTL 到期后锁自动释放，防止死锁
 * 3. 续期：持有者可刷新 TTL 延长持有时间
 * 4. 队列等待：竞争者可排队等待，带超时
 * 5. 后台清理：定期扫描过期锁，释放资源
 *
 * 使用场景：
 * - 防止同一视频被重复爬取/下载
 * - 搜索任务去重（同一关键词不重复搜索）
 * - 资源互斥（同一时间只允许一个嗅探任务）
 *
 * @author PuchiPix Team
 * @date 2026-07-09
 * @lastModified 2026-07-09
 */

// ============================================================
// 类型定义
// ============================================================

/** 锁句柄 — 获取锁后返回，用于释放和续期 */
export interface LockHandle {
  /** 锁的唯一标识 */
  lockId: string;
  /** 锁定的资源 key */
  key: string;
  /** 过期时间戳（毫秒） */
  expiresAt: number;
}

/** 获取锁的选项 */
export interface AcquireOptions {
  /** TTL 毫秒数，默认 30000（30s） */
  ttl?: number;
  /** 等待超时毫秒数，0 表示不等待，默认 0 */
  waitTimeout?: number;
  /** 轮询间隔毫秒数，默认 100 */
  pollInterval?: number;
}

// ============================================================
// 内部锁条目
// ============================================================

interface LockEntry {
  lockId: string;
  key: string;
  expiresAt: number;
  createdAt: number;
}

// ============================================================
// TTLQueueLock 实现
// ============================================================

class TTLQueueLock {
  private locks: Map<string, LockEntry> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly cleanupInterval = 5000;

  /**
   * 尝试获取锁。
   *
   * - 如果 key 未被锁定（或锁已过期），立即获取成功
   * - 如果 key 已被锁定且 waitTimeout > 0，则轮询等待
   * - 如果 waitTimeout = 0（默认），立即返回 null
   *
   * @param key - 资源标识（如 "scrape:https://..."）
   * @param options - 获取选项
   * @returns 锁句柄，获取失败返回 null
   */
  async acquire(key: string, options: AcquireOptions = {}): Promise<LockHandle | null> {
    const ttl = options.ttl ?? 30000;
    const waitTimeout = options.waitTimeout ?? 0;
    const pollInterval = options.pollInterval ?? 100;

    // 尝试立即获取
    const handle = this.tryAcquire(key, ttl);
    if (handle) return handle;

    // 不等待
    if (waitTimeout <= 0) return null;

    // 轮询等待
    const deadline = Date.now() + waitTimeout;
    return new Promise<LockHandle | null>((resolve) => {
      const tryAgain = () => {
        const handle = this.tryAcquire(key, ttl);
        if (handle) {
          resolve(handle);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(tryAgain, pollInterval);
      };
      setTimeout(tryAgain, pollInterval);
    });
  }

  /**
   * 释放锁。
   *
   * 只有持有正确 lockId 的调用者才能释放锁，
   * 防止过期锁被错误的持有者释放。
   *
   * @param key - 资源标识
   * @param lockId - 锁的唯一标识
   * @returns 是否成功释放
   */
  release(key: string, lockId: string): boolean {
    const entry = this.locks.get(key);
    if (!entry || entry.lockId !== lockId) {
      return false;
    }
    this.locks.delete(key);
    return true;
  }

  /**
   * 释放锁（通过 handle）。
   */
  releaseHandle(handle: LockHandle): boolean {
    return this.release(handle.key, handle.lockId);
  }

  /**
   * 续期锁（延长 TTL）。
   *
   * @param key - 资源标识
   * @param lockId - 锁的唯一标识
   * @param ttl - 新的 TTL 毫秒数
   * @returns 是否成功续期
   */
  refresh(key: string, lockId: string, ttl: number): boolean {
    const entry = this.locks.get(key);
    if (!entry || entry.lockId !== lockId) {
      return false;
    }
    entry.expiresAt = Date.now() + ttl;
    return true;
  }

  /**
   * 检查 key 是否被锁定。
   */
  isLocked(key: string): boolean {
    const entry = this.locks.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      this.locks.delete(key);
      return false;
    }
    return true;
  }

  /**
   * 获取当前所有活跃锁的信息。
   */
  getActiveLocks(): Array<{ key: string; lockId: string; expiresAt: number; remaining: number }> {
    this.cleanupExpired();
    return Array.from(this.locks.values()).map((entry) => ({
      key: entry.key,
      lockId: entry.lockId,
      expiresAt: entry.expiresAt,
      remaining: Math.max(0, entry.expiresAt - Date.now()),
    }));
  }

  /**
   * 清理所有锁（用于测试或关闭）。
   */
  clear(): void {
    this.locks.clear();
  }

  /**
   * 启动后台清理定时器。
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, this.cleanupInterval);
  }

  /**
   * 停止后台清理定时器。
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private tryAcquire(key: string, ttl: number): LockHandle | null {
    const now = Date.now();

    // 检查是否存在未过期的锁
    const existing = this.locks.get(key);
    if (existing && now < existing.expiresAt) {
      return null;
    }

    // 创建新锁
    const lockId = this.generateLockId();
    const expiresAt = now + ttl;
    this.locks.set(key, {
      lockId,
      key,
      expiresAt,
      createdAt: now,
    });

    return { lockId, key, expiresAt };
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks) {
      if (now >= entry.expiresAt) {
        this.locks.delete(key);
      }
    }
  }

  private generateLockId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ============================================================
// 单例导出
// ============================================================

export const ttlLock = new TTLQueueLock();
ttlLock.startCleanup();
