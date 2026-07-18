import { slotTypeRegistry, registerBuiltinSlotTypes } from './slot-type-registry';
import { slotPool } from './slot-pool';
import { eventStore } from '../infra/event-store';
import { dagOrchestrator } from './dag-orchestrator';
import { schedulerEngine } from './scheduler-engine';
import { dagConfig } from './dag-config';
import { eventBus } from '../infra/event-bus';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { TaskPriority, type DagDefinition } from '@/types/dag';

/** 妲戒綅瓒呮椂妫€娴嬮棿闅?*/
const SLOT_TIMEOUT_INTERVAL = 60 * 1000; // 60s

/** 浜嬩欢娓呯悊闂撮殧 */
const EVENT_CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // 6h

/** 蹇収鍒涘缓闂撮殧 */
const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5min

class DagSystem {
  private _initialized = false;
  private timers: ReturnType<typeof setInterval>[] = [];

  async initialize(): Promise<void> {
    if (this._initialized) {
      console.log('[DagSystem] 宸插垵濮嬪寲锛岃烦杩?);
      return;
    }

    try {
      await dagConfig.ensureLoaded();

      registerBuiltinSlotTypes(slotTypeRegistry);

      await slotPool.initialize();

      // 同步队列容量：确保调度器队列容量与 SlotPool 槽位上限一致
      schedulerEngine.syncQueueCapacityFromSlotPool();

      slotPool.setSchedulerCallback((slotType) => {
        schedulerEngine.onSlotFreed(slotType);
      });

      await eventStore.initialize();

      await dagOrchestrator.initialize();

      this.startTimers();

      await eventStore.append({
        seq: 0,
        type: 'dag:systemStarted',
        dagId: '__system__',
        timestamp: new Date(),
        payload: {
          dagEnabled: dagConfig.enabled,
          taskTypes: Array.from(dagConfig.taskTypes),
        },
      });

      this._initialized = true;
      console.log(
        `[DagSystem] 鍒濆鍖栧畬鎴?(鍔熻兘寮€鍏? ${dagConfig.enabled ? '宸插惎鐢? : '鏈惎鐢?})`,
      );
    } catch (err) {
      console.error('[DagSystem] 鍒濆鍖栧け璐?', err);
    }
  }

  /**
   * 鍚姩瀹氭椂浠诲姟
   */
  private startTimers(): void {
    // 璋冨害鍣ㄥ畾鏃舵壂鎻忥紙闃叉璋冨害閬楁紡锛?
    schedulerEngine.startScanTimer(2000);

    // 妲戒綅瓒呮椂妫€娴?
    this.timers.push(
      setInterval(() => {
        slotPool.checkTimeouts();
      }, SLOT_TIMEOUT_INTERVAL),
    );

    // 浜嬩欢娓呯悊
    this.timers.push(
      setInterval(async () => {
        await eventStore.cleanupOldEvents();
        await eventStore.cleanupOldSnapshots();
        await eventStore.retryPendingPersist();
      }, EVENT_CLEANUP_INTERVAL),
    );

    // 瀹氭椂蹇収
    this.timers.push(
      setInterval(async () => {
        await dagOrchestrator.createSnapshot();
      }, SNAPSHOT_INTERVAL),
    );

    console.log('[DagSystem] 瀹氭椂浠诲姟宸插惎鍔?);
  }

  /**
   * 鍋滄鎵€鏈夊畾鏃朵换鍔?
   */
  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];
    schedulerEngine.stopScanTimer();
    console.log('[DagSystem] 宸插仠姝?);
  }

  /**
   * 鍙戝皠绯荤粺鍋滄浜嬩欢
   */
  async shutdown(): Promise<void> {
    // 鍒涘缓鏈€缁堝揩鐓?
    await dagOrchestrator.createSnapshot();

    // 鍙戝皠鍋滄浜嬩欢
    await eventStore.append({
      seq: 0,
      type: 'dag:systemStopped',
      dagId: '__system__',
      timestamp: new Date(),
      payload: { reason: 'graceful shutdown' },
    });

    this.stop();
    console.log('[DagSystem] 浼橀泤鍏抽棴瀹屾垚');
  }

  get initialized(): boolean {
    return this._initialized;
  }
}

export const dagSystem = getOrCreateGlobal(
  '__puchipix_dag_system__',
  () => new DagSystem(),
);

/**
 * 鍒涘缓鍥惧簱浠诲姟 DAG 瀹氫箟
 *
 * 鍥惧簱浠诲姟鐨勬爣鍑?DAG 缁撴瀯锛?
 * create 鈫?scrape 鈫?download 鈫?finalize
 */
export function createGalleryDag(params: {
  galleryId: number;
  url: string;
  providerId: string;
  isBatch?: boolean;
}): DagDefinition {
  const { galleryId, url, providerId, isBatch = false } = params;
  const priority = isBatch ? TaskPriority.BATCH : TaskPriority.NORMAL;

  return {
    id: `gallery-${galleryId}`,
    taskType: 'gallery',
    nodes: [
      {
        id: 'create',
        phase: 'create',
        taskType: 'gallery',
        dependencies: [],
        resourceRequirements: [],
        executor: 'gallery:create',
        priority,
        config: { url, providerId, galleryId },
      },
      {
        id: 'scrape',
        phase: 'scrape',
        taskType: 'gallery',
        dependencies: ['create'],
        resourceRequirements: [
          { slotType: 'scraping', count: 1, holdUntil: 'node_complete' },
        ],
        executor: 'gallery:scrape',
        priority,
        timeout: 120_000,
        maxRetries: 2,
        config: { url, providerId, galleryId },
      },
      {
        id: 'download',
        phase: 'download',
        taskType: 'gallery',
        dependencies: ['scrape'],
        resourceRequirements: [
          { slotType: 'download', count: 1, holdUntil: 'node_complete' },
        ],
        executor: 'gallery:download',
        priority,
        timeout: 3_600_000,
        maxRetries: 3,
        config: { galleryId },
      },
      {
        id: 'finalize',
        phase: 'finalize',
        taskType: 'gallery',
        dependencies: ['download'],
        resourceRequirements: [],
        executor: 'gallery:finalize',
        priority,
        config: { galleryId },
      },
    ],
    metadata: {
      sourceUrl: url,
      providerId,
      createdAt: new Date(),
    },
  };
}
