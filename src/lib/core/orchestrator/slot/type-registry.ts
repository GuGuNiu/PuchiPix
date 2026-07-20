import { getOrCreateGlobal } from '../../infra/global-singleton';
import type { SlotTypeDefinition, SlotTypeKey } from '@/types/dag';
import { loggers } from '../../infra/logger';

const logger = loggers.slotTypeRegistry();

class SlotTypeRegistry {
  private types = new Map<SlotTypeKey, SlotTypeDefinition>();

  register(def: SlotTypeDefinition): void {
    if (this.types.has(def.key)) {
      logger.warn(`Slot type ${def.key} already exists, overwriting`);
    }
    this.types.set(def.key, def);
    logger.info(`Slot type registered: ${def.key} (label=${def.label}, defaultMax=${def.defaultMax})`);
  }

  get(key: SlotTypeKey): SlotTypeDefinition | null {
    return this.types.get(key) || null;
  }

  getAll(): SlotTypeDefinition[] {
    return Array.from(this.types.values());
  }

  has(key: SlotTypeKey): boolean {
    return this.types.has(key);
  }

  clear(): void {
    this.types.clear();
  }
}

export const slotTypeRegistry = getOrCreateGlobal(
  '__puchipix_slot_type_registry__',
  () => new SlotTypeRegistry(),
);

export function registerBuiltinSlotTypes(registry: SlotTypeRegistry = slotTypeRegistry): void {
  registry.register({
    key: 'scraping',
    label: '识别任务',
    defaultMax: 5,
    configKey: 'task_max_scraping',
    min: 1,
    max: 20,
    releasePolicy: 'node_complete',
    queueable: true,
  });

  registry.register({
    key: 'download',
    label: '下载任务',
    defaultMax: 5,
    configKey: 'task_max_concurrent',
    min: 1,
    max: 50,
    releasePolicy: 'node_complete',
    queueable: true,
  });

  registry.register({
    key: 'sniff',
    label: '嗅探任务',
    defaultMax: 1,
    configKey: 'sniff_max_concurrent',
    min: 1,
    max: 10,
    releasePolicy: 'node_complete',
    queueable: true,
  });

  registry.register({
    key: 'ts_segment',
    label: 'TS分片并发',
    defaultMax: 50,
    configKey: 'ts_segment_concurrent',
    min: 1,
    max: 200,
    releasePolicy: 'manual',
    queueable: false,
  });

  registry.register({
    key: 'gallery_image',
    label: '图片下载并发',
    defaultMax: 5,
    configKey: 'gallery_image_concurrent',
    min: 1,
    max: 50,
    releasePolicy: 'manual',
    queueable: false,
  });
}
