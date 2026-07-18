import { getOrCreateGlobal } from '../infra/global-singleton';
import type { SlotTypeDefinition, SlotTypeKey } from '@/types/dag';

class SlotTypeRegistry {
  private types = new Map<SlotTypeKey, SlotTypeDefinition>();

  /**
   * 娉ㄥ唽妲戒綅绫诲瀷
   */
  register(def: SlotTypeDefinition): void {
    if (this.types.has(def.key)) {
      console.warn(`[SlotRegistry] 妲戒綅绫诲瀷 ${def.key} 宸插瓨鍦紝瑕嗙洊`);
    }
    this.types.set(def.key, def);
    console.log(`[SlotRegistry] 娉ㄥ唽妲戒綅绫诲瀷: ${def.key} (label=${def.label}, defaultMax=${def.defaultMax})`);
  }

  /**
   * 鑾峰彇妲戒綅绫诲瀷瀹氫箟
   */
  get(key: SlotTypeKey): SlotTypeDefinition | null {
    return this.types.get(key) || null;
  }

  /**
   * 鑾峰彇鎵€鏈夊凡娉ㄥ唽鐨勬Ы浣嶇被鍨?
   */
  getAll(): SlotTypeDefinition[] {
    return Array.from(this.types.values());
  }

  /**
   * 妫€鏌ユЫ浣嶇被鍨嬫槸鍚﹀凡娉ㄥ唽
   */
  has(key: SlotTypeKey): boolean {
    return this.types.has(key);
  }

  /**
   * 娓呴櫎鎵€鏈夋敞鍐岋紙鐢ㄤ簬娴嬭瘯锛?
   */
  clear(): void {
    this.types.clear();
  }
}

export const slotTypeRegistry = getOrCreateGlobal(
  '__puchipix_slot_type_registry__',
  () => new SlotTypeRegistry(),
);

/**
 * 娉ㄥ唽鎵€鏈夊唴缃Ы浣嶇被鍨?
 *
 * 鍦ㄧ郴缁熷垵濮嬪寲鏃惰皟鐢ㄤ竴娆?
 */
export function registerBuiltinSlotTypes(registry: SlotTypeRegistry = slotTypeRegistry): void {
  // 璇嗗埆妲戒綅 鈥?璇嗗埆闃舵浣跨敤
  registry.register({
    key: 'scraping',
    label: '璇嗗埆浠诲姟',
    defaultMax: 5,
    configKey: 'task_max_scraping',
    min: 1,
    max: 20,
    releasePolicy: 'node_complete',
    queueable: true,
  });

  // 涓嬭浇妲戒綅 鈥?涓嬭浇闃舵浣跨敤
  registry.register({
    key: 'download',
    label: '涓嬭浇浠诲姟',
    defaultMax: 5,
    configKey: 'task_max_concurrent',
    min: 1,
    max: 50,
    releasePolicy: 'node_complete',
    queueable: true,
  });

  // 鍡呮帰妲戒綅 鈥?鍡呮帰浠诲姟浣跨敤
  registry.register({
    key: 'sniff',
    label: '鍡呮帰浠诲姟',
    defaultMax: 1,
    configKey: 'sniff_max_concurrent',
    min: 1,
    max: 10,
    releasePolicy: 'node_complete',
    queueable: true,
  });

  // TS 鍒嗙墖骞跺彂 鈥?瑙嗛鍒嗙墖涓嬭浇绾э紙鐢变笅杞藉櫒鍐呴儴绠＄悊锛?
  registry.register({
    key: 'ts_segment',
    label: 'TS鍒嗙墖骞跺彂',
    defaultMax: 50,
    configKey: 'ts_segment_concurrent',
    min: 1,
    max: 200,
    releasePolicy: 'manual',
    queueable: false,
  });

  // 鍥惧簱鍥剧墖骞跺彂 鈥?鍥剧墖涓嬭浇绾э紙鐢变笅杞藉櫒鍐呴儴绠＄悊锛?
  registry.register({
    key: 'gallery_image',
    label: '鍥剧墖涓嬭浇骞跺彂',
    defaultMax: 5,
    configKey: 'gallery_image_concurrent',
    min: 1,
    max: 50,
    releasePolicy: 'manual',
    queueable: false,
  });
}
