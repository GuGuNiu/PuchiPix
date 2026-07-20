import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../../infra/global-singleton';
import { createLogger } from '../../infra/logger';
import { slotTypeRegistry } from './type-registry';
import type {
  SlotTypeKey,
  SlotTypeDefinition,
  SlotUsage,
  SlotPoolSnapshot,
  ResourceRequirement,
} from '@/types/dag';

interface SlotPoolEntry {
  definition: SlotTypeDefinition;
  max: number;
  running: number;
  activeSlots: Set<string>;
  heldSince: Map<string, number>;
  configLoaded: boolean;
}

export class SlotPool {
  private pools = new Map<SlotTypeKey, SlotPoolEntry>();
  private schedulerCallback: ((slotType: SlotTypeKey) => void) | null = null;

  private configPromises = new Map<string, Promise<number>>();
  private _initialized = false;
  private readonly logger = createLogger('SlotPool');

  async initialize(): Promise<void> {
    if (this._initialized) return;

    const definitions = slotTypeRegistry.getAll();
    await Promise.all(definitions.map((def) => this.initSlotType(def)));

    this._initialized = true;
    this.logger.info('Initialization completed', { slotTypeCount: this.pools.size });
  }

  private async initSlotType(def: SlotTypeDefinition): Promise<void> {
    const config = await this.loadConfig(def.configKey, def.defaultMax);
    this.pools.set(def.key, {
      definition: def,
      max: config,
      running: 0,
      activeSlots: new Set(),
      heldSince: new Map(),
      configLoaded: true,
    });
    this.logger.info('Slot type registered', { slotType: def.key, max: config });
  }

  private async loadConfig(configKey: string, defaultMax: number): Promise<number> {
    if (this.configPromises.has(configKey)) {
      return this.configPromises.get(configKey)!;
    }

    const promise = (async () => {
      try {
        const record = await prisma.appConfig.findUnique({ where: { key: configKey } });
        if (record) {
          const val = parseInt(record.value, 10);
          return !isNaN(val) && val >= 1 ? val : defaultMax;
        }
        await prisma.appConfig.upsert({
          where: { key: configKey },
          create: { key: configKey, value: String(defaultMax) },
          update: {},
        });
        return defaultMax;
      } catch {
        return defaultMax;
      }
    })();

    this.configPromises.set(configKey, promise);
    try {
      return await promise;
    } finally {
      this.configPromises.delete(configKey);
    }
  }

  hasAvailable(slotType: SlotTypeKey): boolean {
    const entry = this.pools.get(slotType);
    if (!entry) return false;
    return entry.running < entry.max;
  }

  hasHolder(slotType: SlotTypeKey, holderId: string): boolean {
    const entry = this.pools.get(slotType);
    if (!entry) return false;
    return entry.activeSlots.has(holderId);
  }

  getUsage(slotType: SlotTypeKey): SlotUsage | null {
    const entry = this.pools.get(slotType);
    if (!entry) return null;
    return {
      slotType,
      current: entry.running,
      max: entry.max,
      available: entry.max - entry.running,
    };
  }

  getSnapshot(): SlotPoolSnapshot {
    const snapshot: SlotPoolSnapshot = {};
    for (const [key, entry] of this.pools) {
      snapshot[key] = {
        slotType: key,
        current: entry.running,
        max: entry.max,
        available: entry.max - entry.running,
      };
    }
    return snapshot;
  }

  /**
   * Get all active slot holder IDs grouped by slot type.
   * Used for diagnostics to detect slot leaks.
   */
  getActiveHolders(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [slotType, entry] of this.pools) {
      // Extract unique base holder IDs (strip #N suffix from batch slots)
      const holders = new Set<string>();
      for (const key of entry.activeSlots) {
        const baseId = key.includes('#') ? key.split('#')[0] : key;
        holders.add(baseId);
      }
      result[slotType] = Array.from(holders);
    }
    return result;
  }

  acquire(slotType: SlotTypeKey, holderId: string): boolean {
    const entry = this.pools.get(slotType);
    if (!entry) {
      this.logger.error('Slot type not found', { slotType });
      return false;
    }

    if (entry.activeSlots.has(holderId)) {
      return true;
    }

    if (entry.running >= entry.max) {
      return false;
    }

    entry.activeSlots.add(holderId);
    entry.running++;
    entry.heldSince.set(holderId, Date.now());
    this.logger.debug('Slot acquired', { slotType, holderId, current: entry.running, max: entry.max });
    return true;
  }

  acquireBatch(requirements: ResourceRequirement[], holderId: string): boolean {
    for (const req of requirements) {
      const entry = this.pools.get(req.slotType);
      if (!entry) return false;
      if (entry.running + req.count > entry.max) return false;
    }

    for (const req of requirements) {
      const entry = this.pools.get(req.slotType)!;
      for (let i = 0; i < req.count; i++) {
        const slotKey = req.count === 1 ? holderId : `${holderId}#${i}`;
        entry.activeSlots.add(slotKey);
        entry.heldSince.set(slotKey, Date.now());
        entry.running++;
      }
    }

    if (requirements.length > 0) {
      this.logger.debug('Batch acquired', {
        holderId,
        requirements: requirements.map((r) => `${r.slotType}×${r.count}`).join(', '),
      });
    }
    return true;
  }

  release(slotType: SlotTypeKey, holderId: string): void {
    const entry = this.pools.get(slotType);
    if (!entry) return;

    let released = 0;
    for (const key of Array.from(entry.activeSlots)) {
      if (key === holderId || key.startsWith(`${holderId}#`)) {
        entry.activeSlots.delete(key);
        entry.heldSince.delete(key);
        released++;
      }
    }

    if (released > 0) {
      entry.running = Math.max(0, entry.running - released);
      this.logger.debug('Slot released', { slotType, holderId, released, current: entry.running, max: entry.max });

      if (this.schedulerCallback) {
        this.schedulerCallback(slotType);
      }
    }
  }

  releaseAll(holderId: string): void {
    for (const [slotType, entry] of this.pools) {
      let released = 0;
      for (const key of Array.from(entry.activeSlots)) {
        if (key === holderId || key.startsWith(`${holderId}#`)) {
          entry.activeSlots.delete(key);
          entry.heldSince.delete(key);
          released++;
        }
      }
      if (released > 0) {
        entry.running = Math.max(0, entry.running - released);
        this.logger.debug('Slot released', { slotType, holderId, released });
        if (this.schedulerCallback) {
          this.schedulerCallback(slotType);
        }
      }
    }
  }

  async updateMax(slotType: SlotTypeKey, newMax: number): Promise<void> {
    const entry = this.pools.get(slotType);
    if (!entry) return;

    const clamped = Math.max(entry.definition.min, Math.min(entry.definition.max, newMax));
    entry.max = clamped;

    await prisma.appConfig.upsert({
      where: { key: entry.definition.configKey },
      create: { key: entry.definition.configKey, value: String(clamped) },
      update: { value: String(clamped) },
    });

    this.logger.info('Slot max updated', { slotType, newMax: clamped });

    if (this.schedulerCallback) {
      this.schedulerCallback(slotType);
    }
  }

  setSchedulerCallback(callback: (slotType: SlotTypeKey) => void): void {
    this.schedulerCallback = callback;
  }

  getStats(): Record<string, SlotUsage> {
    const stats: Record<string, SlotUsage> = {};
    for (const [key, entry] of this.pools) {
      stats[key] = {
        slotType: key,
        current: entry.running,
        max: entry.max,
        available: entry.max - entry.running,
      };
    }
    return stats;
  }

  getDownloadConcurrency(): { tsSegmentConcurrent: number; galleryImageConcurrent: number } {
    const tsEntry = this.pools.get('ts_segment');
    const galleryEntry = this.pools.get('gallery_image');
    return {
      tsSegmentConcurrent: tsEntry?.max ?? 50,
      galleryImageConcurrent: galleryEntry?.max ?? 5,
    };
  }

  checkTimeouts(timeoutMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [slotType, entry] of this.pools) {
      const timedOut: string[] = [];
      for (const [holderId, since] of entry.heldSince) {
        if (now - since > timeoutMs) {
          timedOut.push(holderId);
        }
      }
      if (timedOut.length > 0) {
        this.logger.warn('Slot timeout released', { slotType, count: timedOut.length, holders: timedOut });
        for (const holderId of timedOut) {
          this.release(slotType, holderId);
        }
      }
    }
  }

  reset(): void {
    for (const [, entry] of this.pools) {
      entry.running = 0;
      entry.activeSlots.clear();
      entry.heldSince.clear();
    }
    this.logger.warn('All slots reset');
  }

  get initialized(): boolean {
    return this._initialized;
  }
}

export const slotPool = getOrCreateGlobal(
  '__puchipix_slot_pool__',
  () => new SlotPool(),
);
