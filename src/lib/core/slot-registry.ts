/**
 * 动态插槽类型注册器
 *
 * 提供可扩展的并发插槽管理，允许在运行时注册新的插槽类型
 * （如转码插槽、上传插槽），无需修改 TaskQueueManager 核心逻辑。
 *
 * 当前 TaskQueueManager 的 5 种硬编码插槽已覆盖主要场景，
 * 此注册器为未来扩展预留基础设施。
 */

/** 插槽类型配置 */
export interface SlotTypeConfig {
  /** 插槽类型名称（如 'transcode'、'upload'） */
  name: string;
  /** AppConfig 中的配置键 */
  configKey: string;
  /** 默认并发上限 */
  defaultMax: number;
  /** 允许的最小值 */
  min?: number;
  /** 允许的最大值 */
  max?: number;
}

/** 插槽运行时状态 */
interface SlotRuntime {
  config: SlotTypeConfig;
  currentMax: number;
  running: number;
  activeSlots: Set<string>;
  pending: Array<{
    key: string;
    resolve: (acquired: boolean) => void;
  }>;
}

/** 插槽统计信息 */
export interface SlotStats {
  name: string;
  running: number;
  maxConcurrent: number;
  pendingCount: number;
}

/**
 * 插槽类型注册器
 *
 * 管理多种并发插槽类型的注册、获取和释放。
 * 每种插槽类型独立计数，互不影响。
 */
export class SlotTypeRegistry {
  private registry = new Map<string, SlotRuntime>();

  /**
   * 注册新的插槽类型
   *
   * 注册后可通过 acquire/release 方法管理该类型的并发槽位。
   * 重复注册同名类型会更新配置但保留运行时状态。
   */
  register(config: SlotTypeConfig): void {
    const existing = this.registry.get(config.name);
    if (existing) {
      existing.config = config;
      existing.currentMax = Math.max(
        config.min ?? 1,
        Math.min(existing.currentMax, config.max ?? Infinity),
      );
      return;
    }

    this.registry.set(config.name, {
      config,
      currentMax: config.defaultMax,
      running: 0,
      activeSlots: new Set(),
      pending: [],
    });
  }

  /**
   * 获取插槽（若已满则阻塞等待）
   *
   * @param typeName - 插槽类型名称
   * @param slotKey - 插槽唯一标识（如 `${taskType}-${taskId}`）
   * @returns true=成功获取，false=被取消
   * @throws {Error} 未注册的插槽类型
   */
  async acquire(typeName: string, slotKey: string): Promise<boolean> {
    const slot = this.registry.get(typeName);
    if (!slot) {
      throw new Error(`未注册的插槽类型: ${typeName}`);
    }

    if (slot.activeSlots.has(slotKey)) {
      return true;
    }

    if (slot.running < slot.currentMax) {
      slot.activeSlots.add(slotKey);
      slot.running++;
      return true;
    }

    return new Promise<boolean>((resolve) => {
      slot.pending.push({ key: slotKey, resolve });
    });
  }

  /**
   * 释放插槽
   *
   * 释放后自动尝试启动等待队列中的下一个任务。
   */
  release(typeName: string, slotKey: string): void {
    const slot = this.registry.get(typeName);
    if (!slot) return;

    if (!slot.activeSlots.has(slotKey)) return;

    slot.activeSlots.delete(slotKey);
    slot.running = Math.max(0, slot.running - 1);

    this.tryStartNext(slot);
  }

  /**
   * 取消排队中的请求
   *
   * @returns 是否成功取消
   */
  cancelAcquire(typeName: string, slotKey: string): boolean {
    const slot = this.registry.get(typeName);
    if (!slot) return false;

    const idx = slot.pending.findIndex((p) => p.key === slotKey);
    if (idx >= 0) {
      const [item] = slot.pending.splice(idx, 1);
      item.resolve(false);
      return true;
    }
    return false;
  }

  /**
   * 更新插槽类型的并发上限
   *
   * 更新后立即尝试启动可能因上限提高而可执行的任务。
   */
  updateMax(typeName: string, max: number): void {
    const slot = this.registry.get(typeName);
    if (!slot) return;

    const min = slot.config.min ?? 1;
    const upperBound = slot.config.max ?? Infinity;
    slot.currentMax = Math.max(min, Math.min(max, upperBound));

    this.tryStartNext(slot);
  }

  /** 获取指定类型的当前并发上限 */
  getMax(typeName: string): number | undefined {
    return this.registry.get(typeName)?.currentMax;
  }

  /** 获取指定类型的当前运行数 */
  getRunning(typeName: string): number | undefined {
    return this.registry.get(typeName)?.running;
  }

  /** 获取所有已注册类型的统计信息 */
  getAllStats(): SlotStats[] {
    const stats: SlotStats[] = [];
    for (const [name, slot] of this.registry) {
      stats.push({
        name,
        running: slot.running,
        maxConcurrent: slot.currentMax,
        pendingCount: slot.pending.length,
      });
    }
    return stats;
  }

  /** 是否已注册指定类型 */
  has(typeName: string): boolean {
    return this.registry.has(typeName);
  }

  /** 重置指定类型（或全部）的运行时状态 */
  reset(typeName?: string): void {
    if (typeName) {
      const slot = this.registry.get(typeName);
      if (slot) {
        slot.running = 0;
        slot.activeSlots.clear();
        for (const p of slot.pending) p.resolve(false);
        slot.pending = [];
      }
    } else {
      for (const slot of this.registry.values()) {
        slot.running = 0;
        slot.activeSlots.clear();
        for (const p of slot.pending) p.resolve(false);
        slot.pending = [];
      }
    }
  }

  /**
   * 尝试启动等待队列中下一个可执行的任务
   */
  private tryStartNext(slot: SlotRuntime): void {
    while (slot.pending.length > 0 && slot.running < slot.currentMax) {
      const item = slot.pending.shift()!;
      slot.activeSlots.add(item.key);
      slot.running++;
      item.resolve(true);
    }
  }
}
