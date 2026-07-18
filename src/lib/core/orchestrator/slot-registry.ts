export interface SlotTypeConfig {
  name: string;
  configKey: string;
  defaultMax: number;
  min?: number;
  max?: number;
}

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

/** 鎻掓Ы缁熻淇℃伅 */
export interface SlotStats {
  name: string;
  running: number;
  maxConcurrent: number;
  pendingCount: number;
}

/**
 * 鎻掓Ы绫诲瀷娉ㄥ唽鍣?
 *
 * 绠＄悊澶氱骞跺彂鎻掓Ы绫诲瀷鐨勬敞鍐屻€佽幏鍙栧拰閲婃斁銆?
 * 姣忕鎻掓Ы绫诲瀷鐙珛璁℃暟锛屼簰涓嶅奖鍝嶃€?
 */
export class SlotTypeRegistry {
  private registry = new Map<string, SlotRuntime>();

  /**
   * 娉ㄥ唽鏂扮殑鎻掓Ы绫诲瀷
   *
   * 娉ㄥ唽鍚庡彲閫氳繃 acquire/release 鏂规硶绠＄悊璇ョ被鍨嬬殑骞跺彂妲戒綅銆?
   * 閲嶅娉ㄥ唽鍚屽悕绫诲瀷浼氭洿鏂伴厤缃絾淇濈暀杩愯鏃剁姸鎬併€?
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
   * 鑾峰彇鎻掓Ы锛堣嫢宸叉弧鍒欓樆濉炵瓑寰咃級
   *
   * @param typeName - 鎻掓Ы绫诲瀷鍚嶇О
   * @param slotKey - 鎻掓Ы鍞竴鏍囪瘑锛堝 `${taskType}-${taskId}`锛?
   * @returns true=鎴愬姛鑾峰彇锛宖alse=琚彇娑?
   * @throws {Error} 鏈敞鍐岀殑鎻掓Ы绫诲瀷
   */
  async acquire(typeName: string, slotKey: string): Promise<boolean> {
    const slot = this.registry.get(typeName);
    if (!slot) {
      throw new Error(`鏈敞鍐岀殑鎻掓Ы绫诲瀷: ${typeName}`);
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
   * 閲婃斁鎻掓Ы
   *
   * 閲婃斁鍚庤嚜鍔ㄥ皾璇曞惎鍔ㄧ瓑寰呴槦鍒椾腑鐨勪笅涓€涓换鍔°€?
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
   * 鍙栨秷鎺掗槦涓殑璇锋眰
   *
   * @returns 鏄惁鎴愬姛鍙栨秷
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
   * 鏇存柊鎻掓Ы绫诲瀷鐨勫苟鍙戜笂闄?
   *
   * 鏇存柊鍚庣珛鍗冲皾璇曞惎鍔ㄥ彲鑳藉洜涓婇檺鎻愰珮鑰屽彲鎵ц鐨勪换鍔°€?
   */
  updateMax(typeName: string, max: number): void {
    const slot = this.registry.get(typeName);
    if (!slot) return;

    const min = slot.config.min ?? 1;
    const upperBound = slot.config.max ?? Infinity;
    slot.currentMax = Math.max(min, Math.min(max, upperBound));

    this.tryStartNext(slot);
  }

  /** 鑾峰彇鎸囧畾绫诲瀷鐨勫綋鍓嶅苟鍙戜笂闄?*/
  getMax(typeName: string): number | undefined {
    return this.registry.get(typeName)?.currentMax;
  }

  /** 鑾峰彇鎸囧畾绫诲瀷鐨勫綋鍓嶈繍琛屾暟 */
  getRunning(typeName: string): number | undefined {
    return this.registry.get(typeName)?.running;
  }

  /** 鑾峰彇鎵€鏈夊凡娉ㄥ唽绫诲瀷鐨勭粺璁′俊鎭?*/
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

  /** 鏄惁宸叉敞鍐屾寚瀹氱被鍨?*/
  has(typeName: string): boolean {
    return this.registry.has(typeName);
  }

  /** 閲嶇疆鎸囧畾绫诲瀷锛堟垨鍏ㄩ儴锛夌殑杩愯鏃剁姸鎬?*/
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
   * 灏濊瘯鍚姩绛夊緟闃熷垪涓笅涓€涓彲鎵ц鐨勪换鍔?
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
