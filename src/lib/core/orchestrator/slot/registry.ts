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

export interface SlotStats {
  name: string;
  running: number;
  maxConcurrent: number;
  pendingCount: number;
}

export class SlotTypeRegistry {
  private registry = new Map<string, SlotRuntime>();

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

  async acquire(typeName: string, slotKey: string): Promise<boolean> {
    const slot = this.registry.get(typeName);
    if (!slot) {
      throw new Error(`Unregistered slot type: ${typeName}`);
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

  release(typeName: string, slotKey: string): void {
    const slot = this.registry.get(typeName);
    if (!slot) return;

    if (!slot.activeSlots.has(slotKey)) return;

    slot.activeSlots.delete(slotKey);
    slot.running = Math.max(0, slot.running - 1);

    this.tryStartNext(slot);
  }

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

  updateMax(typeName: string, max: number): void {
    const slot = this.registry.get(typeName);
    if (!slot) return;

    const min = slot.config.min ?? 1;
    const upperBound = slot.config.max ?? Infinity;
    slot.currentMax = Math.max(min, Math.min(max, upperBound));

    this.tryStartNext(slot);
  }

  getMax(typeName: string): number | undefined {
    return this.registry.get(typeName)?.currentMax;
  }

  getRunning(typeName: string): number | undefined {
    return this.registry.get(typeName)?.running;
  }

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

  has(typeName: string): boolean {
    return this.registry.has(typeName);
  }

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

  private tryStartNext(slot: SlotRuntime): void {
    while (slot.pending.length > 0 && slot.running < slot.currentMax) {
      const item = slot.pending.shift()!;
      slot.activeSlots.add(item.key);
      slot.running++;
      item.resolve(true);
    }
  }
}
