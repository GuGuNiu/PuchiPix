/**
 * DagSnapshotCache — Main-process DAG snapshot cache
 *
 * The Worker process owns the live dagOrchestrator / schedulerEngine / slotPool
 * singletons. The main (Next.js) process cannot read them directly because they
 * are only initialized inside the Worker. Instead, the Worker periodically
 * pushes a `dag:snapshotSync` event via IPC → EventBus, and this cache stores
 * the latest snapshot for the API routes to query.
 *
 * Data flow:
 *   Worker dagOrchestrator → EventBus emit('dag:snapshotSync')
 *   → IPC bridge → main-process EventBus
 *   → DagSnapshotCache.update()
 *   → API routes read from DagSnapshotCache
 *
 * IPC serialises Date objects to ISO strings, so `rehydrateDates` converts them
 * back to Date instances to keep the existing serialization functions working.
 */

import { getOrCreateGlobal } from '../../infra/global-singleton';
import { createLogger } from '../../infra/logger';
import type {
  DagSnapshot,
  SchedulerStats,
  SlotPoolSnapshot,
  SlotUsage,
} from '@/types/dag';

type DagSnapshotSyncPayload = {
  dags: DagSnapshot[];
  dagStats: { totalDags: number; activeDags: number; totalNodes: number };
  schedulerStats: SchedulerStats;
  slotSnapshot: SlotPoolSnapshot;
  slotStats: Record<string, SlotUsage>;
  activeHolders: Record<string, string[]>;
  downloadConcurrency: { tsSegmentConcurrent: number; galleryImageConcurrent: number };
  currentSeq: number;
  timestamp: string;
};

/**
 * Convert ISO-string Date fields (produced by IPC JSON serialisation) back to
 * Date instances inside the deeply-nested DagSnapshot structure.
 */
function rehydrateDates(snapshot: DagSnapshot): DagSnapshot {
  const restored = JSON.parse(JSON.stringify(snapshot)) as DagSnapshot;

  if (typeof restored.createdAt === 'string') {
    restored.createdAt = new Date(restored.createdAt);
  }
  if (restored.definition?.metadata) {
    const meta = restored.definition.metadata as { createdAt: Date | string };
    if (typeof meta.createdAt === 'string') {
      meta.createdAt = new Date(meta.createdAt);
    }
  }
  for (const ns of restored.nodeStates ?? []) {
    for (const h of ns.history ?? []) {
      if (typeof h.timestamp === 'string') {
        h.timestamp = new Date(h.timestamp);
      }
    }
  }
  return restored;
}

class DagSnapshotCache {
  private dags: Map<string, DagSnapshot> = new Map();
  private dagStats: { totalDags: number; activeDags: number; totalNodes: number } = {
    totalDags: 0,
    activeDags: 0,
    totalNodes: 0,
  };
  private schedulerStats: SchedulerStats = {
    queueSize: 0,
    byPriority: {},
    byTaskType: {},
    strategy: '',
  };
  private slotSnapshot: SlotPoolSnapshot = {};
  private slotStats: Record<string, SlotUsage> = {};
  private activeHolders: Record<string, string[]> = {};
  private downloadConcurrency = {
    tsSegmentConcurrent: 50,
    galleryImageConcurrent: 5,
  };
  private currentSeq = 0;
  private lastUpdated = 0;
  private readonly logger = createLogger('DagSnapshotCache');

  /** Replace the entire cache with a fresh snapshot from the Worker. */
  update(data: DagSnapshotSyncPayload): void {
    const next = new Map<string, DagSnapshot>();
    for (const raw of data.dags) {
      try {
        next.set(raw.dagId, rehydrateDates(raw));
      } catch (err) {
        this.logger.error('Failed to rehydrate DAG snapshot', {
          dagId: raw.dagId,
          error: err,
        });
      }
    }

    this.dags = next;
    this.dagStats = data.dagStats;
    this.schedulerStats = data.schedulerStats;
    this.slotSnapshot = data.slotSnapshot;
    this.slotStats = data.slotStats;
    this.activeHolders = data.activeHolders;
    this.downloadConcurrency = data.downloadConcurrency;
    this.currentSeq = data.currentSeq;
    this.lastUpdated = Date.now();

    this.logger.debug('Snapshot cache updated', {
      dagCount: this.dags.size,
      age: 0,
    });
  }

  /** Clear the cache (e.g. on Worker restart to avoid stale data). */
  clear(): void {
    this.dags.clear();
    this.dagStats = { totalDags: 0, activeDags: 0, totalNodes: 0 };
    this.schedulerStats = { queueSize: 0, byPriority: {}, byTaskType: {}, strategy: '' };
    this.slotSnapshot = {};
    this.slotStats = {};
    this.activeHolders = {};
    this.currentSeq = 0;
    this.lastUpdated = 0;
  }

  getAllDagSnapshots(): DagSnapshot[] {
    return Array.from(this.dags.values());
  }

  getDagSnapshot(dagId: string): DagSnapshot | null {
    return this.dags.get(dagId) ?? null;
  }

  getDagStats(): { totalDags: number; activeDags: number; totalNodes: number } {
    return this.dagStats;
  }

  getSchedulerStats(): SchedulerStats {
    return this.schedulerStats;
  }

  getSlotSnapshot(): SlotPoolSnapshot {
    return this.slotSnapshot;
  }

  getSlotStats(): Record<string, SlotUsage> {
    return this.slotStats;
  }

  getActiveHolders(): Record<string, string[]> {
    return this.activeHolders;
  }

  getDownloadConcurrency(): { tsSegmentConcurrent: number; galleryImageConcurrent: number } {
    return this.downloadConcurrency;
  }

  getCurrentSeq(): number {
    return this.currentSeq;
  }

  /** Whether the cache has received at least one snapshot from the Worker. */
  isAvailable(): boolean {
    return this.lastUpdated > 0;
  }

  /** Cache age in milliseconds (since last update). */
  getAge(): number {
    return this.lastUpdated > 0 ? Date.now() - this.lastUpdated : Infinity;
  }
}

export const dagSnapshotCache = getOrCreateGlobal(
  '__puchipix_dag_snapshot_cache__',
  () => new DagSnapshotCache(),
);
