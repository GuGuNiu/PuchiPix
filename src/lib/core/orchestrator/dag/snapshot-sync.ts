/**
 * Worker-side DAG snapshot sync helper.
 *
 * Collects the live state from dagOrchestrator / schedulerEngine / slotPool
 * and emits it as a single `dag:snapshotSync` event. The main process
 * caches this via DagSnapshotCache so that API routes can serve DAG data
 * without touching the Worker-only singletons.
 *
 * Also re-emits on significant DAG state changes for low-latency updates.
 */

import { eventBus } from '../../infra/event-bus';
import { createLogger } from '../../infra/logger';
import { dagOrchestrator } from './orchestrator';
import { schedulerEngine } from '../scheduler-engine';
import { slotPool } from '../slot/pool';
import { eventStore } from '../../infra/event-store';
import { getOrCreateGlobal } from '../../infra/global-singleton';

const logger = createLogger('DagSnapshotSync');

const SNAPSHOT_EVENTS = [
  'dag:created',
  'dag:completed',
  'dag:cancelled',
  'dag:paused',
  'dag:resumed',
  'dag:nodeStateChanged',
  'dag:nodeCompleted',
  'dag:nodeFailed',
  'dag:nodeRetrying',
  'dag:resourceAllocated',
  'dag:resourceReleased',
] as const;

export function collectDagSystemSnapshot() {
  const dags = dagOrchestrator.getAllDagSnapshots();
  const dagStats = dagOrchestrator.getStats();
  const schedulerStats = schedulerEngine.getQueueStats();
  const slotSnapshot = slotPool.getSnapshot();
  const slotStats = slotPool.getStats();
  const activeHolders = slotPool.getActiveHolders();
  const downloadConcurrency = slotPool.getDownloadConcurrency();
  const currentSeq = eventStore.currentSequence;

  return {
    dags,
    dagStats,
    schedulerStats,
    slotSnapshot,
    slotStats,
    activeHolders,
    downloadConcurrency,
    currentSeq,
    timestamp: new Date().toISOString(),
  };
}

export function emitDagSnapshotSync(): void {
  try {
    eventBus.emit('dag:snapshotSync', collectDagSystemSnapshot());
  } catch (err) {
    logger.error('Failed to emit DAG snapshot sync', { error: err });
  }
}

class DagSnapshotSyncManager {
  private eventSubs: Array<{ unsubscribe: () => void }> = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs = 200;
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    for (const evt of SNAPSHOT_EVENTS) {
      this.eventSubs.push(
        eventBus.on(evt, () => {
          this.scheduleDebouncedEmit();
        }),
      );
    }

    logger.info('Snapshot sync manager initialized', {
      subscribedEvents: SNAPSHOT_EVENTS.length,
    });
  }

  private scheduleDebouncedEmit(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      emitDagSnapshotSync();
    }, this.debounceMs);
  }

  dispose(): void {
    for (const sub of this.eventSubs) {
      sub.unsubscribe();
    }
    this.eventSubs = [];
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.initialized = false;
  }
}

export const dagSnapshotSyncManager = getOrCreateGlobal(
  '__puchipix_dag_snapshot_sync_manager__',
  () => new DagSnapshotSyncManager(),
);
