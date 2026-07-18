import prisma from '@/lib/db/prisma';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { slotTypeRegistry } from './slot-type-registry';
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

  async initialize(): Promise<void> {
    if (this._initialized) return;

    const definitions = slotTypeRegistry.getAll();
    await Promise.all(definitions.map((def) => this.initSlotType(def)));

    this._initialized = true;
    console.log(`[SlotPool] 鍒濆鍖栧畬鎴? ${this.pools.size} 涓Ы浣嶇被鍨媊);
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
    console.log(`[SlotPool] 妲戒綅绫诲瀷 ${def.key} 鍒濆鍖? max=${config}`);
  }

  /**
   * 閰嶇疆鍔犺浇 鈥?Promise 缂撳瓨妯″紡娑堥櫎绔炴€?
   *
   * 瑙ｅ喅鐜版湁 ensureSettingsLoaded 绔炴€侀棶棰橈細
   * settingsLoaded 鍦?await 鍓嶈涓?true 鈫?骞跺彂璇锋眰浣跨敤榛樿鍊?
   */
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

  /**
   * 鍚屾妫€鏌ユЫ浣嶅彲鐢ㄦ€э紙闈為樆濉烇級
   */
  hasAvailable(slotType: SlotTypeKey): boolean {
    const entry = this.pools.get(slotType);
    if (!entry) return false;
    return entry.running < entry.max;
  }

  /**
   * 检查指定 holder 是否持有指定槽位类型的槽位（同步）
   *
   * 替代 task-queue-manager 对私有 pools 字段的直接访问。
   */
  hasHolder(slotType: SlotTypeKey, holderId: string): boolean {
    const entry = this.pools.get(slotType);
    if (!entry) return false;
    return entry.activeSlots.has(holderId);
  }

  /**
   * 鑾峰彇妲戒綅浣跨敤鎯呭喌锛堝悓姝ワ級
   */
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

  /**
   * 鑾峰彇鎵€鏈夋Ы浣嶅揩鐓э紙鍚屾锛?
   */
  getSnapshot(): SlotPoolSnapshot {
    const snapshot: SlotPoolSnapshot = {};
    for (const [key, entry] of this.pools) {
      snapshot[key] = {
        current: entry.running,
        max: entry.max,
        available: entry.max - entry.running,
      };
    }
    return snapshot;
  }

  /**
   * 鍒嗛厤妲戒綅锛堝悓姝ワ紝绔嬪嵆杩斿洖锛?
   *
   * 鏇夸唬鐜版湁鐨?async acquireSlot銆?
   * 濡傛灉妲戒綅宸叉弧锛岃繑鍥?false锛岀敱璋冨害鍣ㄥ喅瀹氭槸鍚︽帓闃熴€?
   *
   * @returns true=鍒嗛厤鎴愬姛, false=妲戒綅宸叉弧
   */
  acquire(slotType: SlotTypeKey, holderId: string): boolean {
    const entry = this.pools.get(slotType);
    if (!entry) {
      console.error(`[SlotPool] 鏈煡妲戒綅绫诲瀷: ${slotType}`);
      return false;
    }

    // 骞傜瓑妫€鏌?
    if (entry.activeSlots.has(holderId)) {
      return true;
    }

    // 鍚屾妫€鏌?+ 淇敼锛堟棤 await锛屼繚璇佸師瀛愭€э級
    if (entry.running >= entry.max) {
      return false;
    }

    entry.activeSlots.add(holderId);
    entry.running++;
    entry.heldSince.set(holderId, Date.now());
    console.log(`[SlotPool] ${slotType} 鍒嗛厤缁?${holderId} (${entry.running}/${entry.max})`);
    return true;
  }

  /**
   * 鎵归噺鍒嗛厤澶氫釜妲戒綅
   *
   * 鐢ㄤ簬涓€涓妭鐐归渶瑕佸绉嶈祫婧愮殑鍦烘櫙銆?
   * 瑕佷箞鍏ㄩ儴鍒嗛厤鎴愬姛锛岃涔堝叏閮ㄤ笉鍒嗛厤锛堝師瀛愭€э級銆?
   */
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
      console.log(
        `[SlotPool] 鎵归噺鍒嗛厤缁?${holderId}: ${requirements.map((r) => `${r.slotType}脳${r.count}`).join(', ')}`,
      );
    }
    return true;
  }

  /**
   * 閲婃斁妲戒綅
   */
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
      console.log(`[SlotPool] ${slotType} 閲婃斁 ${holderId} 鐨?${released} 涓Ы浣?(${entry.running}/${entry.max})`);

      if (this.schedulerCallback) {
        this.schedulerCallback(slotType);
      }
    }
  }

  /**
   * 閲婃斁 holder 鎸佹湁鐨勬墍鏈夋Ы浣?
   */
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
        console.log(`[SlotPool] ${slotType} 閲婃斁 ${holderId} 鐨?${released} 涓Ы浣峘);
        if (this.schedulerCallback) {
          this.schedulerCallback(slotType);
        }
      }
    }
  }

  /**
   * 鏇存柊妲戒綅涓婇檺
   */
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

    console.log(`[SlotPool] ${slotType} 涓婇檺鏇存柊涓?${clamped}`);

    if (this.schedulerCallback) {
      this.schedulerCallback(slotType);
    }
  }

  /**
   * 璁剧疆璋冨害鍣ㄥ洖璋?鈥?妲戒綅閲婃斁鏃堕€氱煡璋冨害鍣ㄩ噸鏂拌皟搴?
   */
  setSchedulerCallback(callback: (slotType: SlotTypeKey) => void): void {
    this.schedulerCallback = callback;
  }

  /**
   * 鑾峰彇鎵€鏈夋Ы浣嶇粺璁?
   */
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

  /**
   * 鑾峰彇涓嬭浇绾у苟鍙戦厤缃紙鍏煎鐜版湁涓嬭浇鍣級
   */
  getDownloadConcurrency(): { tsSegmentConcurrent: number; galleryImageConcurrent: number } {
    const tsEntry = this.pools.get('ts_segment');
    const galleryEntry = this.pools.get('gallery_image');
    return {
      tsSegmentConcurrent: tsEntry?.max ?? 50,
      galleryImageConcurrent: galleryEntry?.max ?? 5,
    };
  }

  /**
   * 妲戒綅瓒呮椂妫€娴?
   *
   * 瀹氭湡妫€鏌ユ椿璺冩Ы浣嶆槸鍚﹁秴鏃讹紝鑷姩閲婃斁骞堕€氱煡璋冨害鍣ㄣ€?
   * 瑙ｅ喅锛氭Ы浣嶈闀挎椂闂存寔鏈変笉閲婃斁鐨勯棶棰樸€?
   */
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
        console.warn(`[SlotPool] ${slotType} 瓒呮椂閲婃斁 ${timedOut.length} 涓Ы浣? ${timedOut.join(', ')}`);
        for (const holderId of timedOut) {
          this.release(slotType, holderId);
        }
      }
    }
  }

  /**
   * 閲嶇疆锛堜粎鐢ㄤ簬寮傚父鎭㈠锛?
   */
  reset(): void {
    for (const [, entry] of this.pools) {
      entry.running = 0;
      entry.activeSlots.clear();
      entry.heldSince.clear();
    }
    console.warn('[SlotPool] 鎵€鏈夋Ы浣嶅凡閲嶇疆');
  }

  /**
   * 鏄惁宸插垵濮嬪寲
   */
  get initialized(): boolean {
    return this._initialized;
  }
}

export const slotPool = getOrCreateGlobal(
  '__puchipix_slot_pool__',
  () => new SlotPool(),
);
