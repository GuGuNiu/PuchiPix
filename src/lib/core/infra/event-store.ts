import prisma from '@/lib/db/prisma';
import { eventBus } from './event-bus';
import type { EventMap } from './event-bus';
import { getOrCreateGlobal } from './global-singleton';
import { createLogger } from './logger';
import type { DagEvent, DagEventType, DagSnapshot } from '@/types/dag';

/** MemoryEventlogmaxlength */
const MAX_IN_MEMORY_LOG = 10000;

const SNAPSHOT_INTERVAL = 100;

export class EventStore {
  private currentSeq = 0;
  private inMemoryLog: DagEvent[] = [];
  private pendingPersist: DagEvent[] = [];
  private eventsSinceSnapshot = 0;
  private readonly logger = createLogger('EventStore');

  /**
   * AppendEvent
   *
   */
  async append(event: DagEvent): Promise<void> {
    event.seq = ++this.currentSeq;
    if (!event.timestamp) {
      event.timestamp = new Date();
    }

    this.inMemoryLog.push(event);
    if (this.inMemoryLog.length > MAX_IN_MEMORY_LOG) {
      this.inMemoryLog.shift();
    }

    this.persistToDB(event).catch((err) => {
      this.logger.error('DB persistence failed', { eventSeq: event.seq, error: err });
      this.pendingPersist.push(event);
    });

    this.emitToEventBus(event);

    this.eventsSinceSnapshot++;
    if (this.eventsSinceSnapshot >= SNAPSHOT_INTERVAL) {
      this.eventsSinceSnapshot = 0;
      this.snapshot().catch((err) => {
        this.logger.error('Snapshot creation failed', { error: err });
      });
    }
  }

  
  async appendBatch(events: DagEvent[]): Promise<void> {
    for (const event of events) {
      event.seq = ++this.currentSeq;
      if (!event.timestamp) {
        event.timestamp = new Date();
      }
      this.inMemoryLog.push(event);
    }

    if (this.inMemoryLog.length > MAX_IN_MEMORY_LOG) {
      this.inMemoryLog = this.inMemoryLog.slice(-MAX_IN_MEMORY_LOG);
    }

    try {
      await prisma.dagEvent.createMany({
        data: events.map((e) => ({
          dagId: e.dagId,
          nodeId: e.nodeId || null,
          type: e.type,
          seq: e.seq,
          payload: JSON.stringify(e.payload),
          timestamp: e.timestamp,
        })),
      });
    } catch (err) {
      this.logger.error('Batch persistence failed', { eventCount: events.length, error: err });
      this.pendingPersist.push(...events);
    }

    for (const event of events) {
      this.emitToEventBus(event);
    }
  }

  
  async replay(fromSeq: number, dagId?: string): Promise<DagEvent[]> {
    const inMemory = this.inMemoryLog.filter(
      (e) => e.seq > fromSeq && (!dagId || e.dagId === dagId),
    );

    if (inMemory.length === 0 || inMemory[0].seq > fromSeq + 1) {
      const fromDB = await prisma.dagEvent.findMany({
        where: {
          seq: { gt: fromSeq },
          ...(dagId ? { dagId } : {}),
        },
        orderBy: { seq: 'asc' },
      });
      return fromDB.map((r) => this.deserializeEvent(r));
    }

    return inMemory;
  }

  
  async getDagEvents(dagId: string): Promise<DagEvent[]> {
    const fromDB = await prisma.dagEvent.findMany({
      where: { dagId },
      orderBy: { seq: 'asc' },
    });
    return fromDB.map((r) => this.deserializeEvent(r));
  }

  /**
   * CreateSnapshot
   *
   */
  async snapshot(dagSnapshots?: DagSnapshot[]): Promise<void> {
    if (!dagSnapshots || dagSnapshots.length === 0) return;

    try {
      await prisma.dagSnapshot.createMany({
        data: dagSnapshots.map((s) => ({
          dagId: s.dagId,
          state: JSON.stringify(s),
          lastSeq: this.currentSeq,
          createdAt: new Date(),
        })),
      });
      this.logger.info('Snapshot created', { dagCount: dagSnapshots.length });
    } catch (err) {
      this.logger.error('Snapshot creation failed', { error: err });
    }
  }

  /**
   * FromSnapshotResume
   */
  async restoreFromSnapshot(
    restoreDag: (snapshot: DagSnapshot) => Promise<void>,
    applyEvent: (event: DagEvent) => Promise<void>,
  ): Promise<void> {
    try {
      const latestSnapshots = await prisma.dagSnapshot.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const seen = new Set<string>();
      const uniqueSnapshots = latestSnapshots.filter((r) => {
        if (seen.has(r.dagId)) return false;
        seen.add(r.dagId);
        return true;
      });

      for (const record of uniqueSnapshots) {
        try {
          const snapshot = JSON.parse(record.state) as DagSnapshot;
          snapshot.createdAt = new Date(snapshot.createdAt);
          for (const ns of snapshot.nodeStates) {
            for (const h of ns.history) {
              h.timestamp = new Date(h.timestamp);
            }
          }
          await restoreDag(snapshot);

          const events = await this.replay(record.lastSeq, snapshot.dagId);
          for (const event of events) {
            await applyEvent(event);
          }
        } catch (err) {
          this.logger.error('DAG restore failed', { dagId: record.dagId, error: err });
        }
      }

      this.logger.info('Snapshot restore completed', { dagCount: uniqueSnapshots.length });
    } catch (err) {
      this.logger.error('Snapshot restore failed', { error: err });
    }
  }

  
  get currentSequence(): number {
    return this.currentSeq;
  }

  
  async retryPendingPersist(): Promise<void> {
    if (this.pendingPersist.length === 0) return;

    const toRetry = [...this.pendingPersist];
    this.pendingPersist = [];

    try {
      await prisma.dagEvent.createMany({
        data: toRetry.map((e) => ({
          dagId: e.dagId,
          nodeId: e.nodeId || null,
          type: e.type,
          seq: e.seq,
          payload: JSON.stringify(e.payload),
          timestamp: e.timestamp,
        })),
      });
      this.logger.info('Retry persistence succeeded', { eventCount: toRetry.length });
    } catch (err) {
      this.logger.error('Retry persistence failed', { error: err });
      this.pendingPersist.push(...toRetry);
    }
  }

  /**
   * Clean up expiredEvent
   */
  async cleanupOldEvents(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      const result = await prisma.dagEvent.deleteMany({
        where: { timestamp: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.logger.info('Expired events cleaned', { count: result.count });
      }
      return result.count;
    } catch (err) {
      this.logger.error('Event cleanup failed', { error: err });
      return 0;
    }
  }

  /**
   * Clean up expiredSnapshot
   */
  async cleanupOldSnapshots(retentionDays: number = 7): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      const result = await prisma.dagSnapshot.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        this.logger.info('Expired snapshots cleaned', { count: result.count });
      }
      return result.count;
    } catch (err) {
      this.logger.error('Snapshot cleanup failed', { error: err });
      return 0;
    }
  }

  
  async initialize(): Promise<void> {
    try {
      const lastEvent = await prisma.dagEvent.findFirst({
        orderBy: { seq: 'desc' },
      });
      if (lastEvent) {
        this.currentSeq = lastEvent.seq;
        this.logger.info('Initialization completed', { currentSeq: this.currentSeq });
      } else {
        this.logger.info('Initialization completed: no historical events');
      }
    } catch (err) {
      this.logger.error('Initialization failed', { error: err });
    }
  }

  private async persistToDB(event: DagEvent): Promise<void> {
    await prisma.dagEvent.create({
      data: {
        dagId: event.dagId,
        nodeId: event.nodeId || null,
        type: event.type,
        seq: event.seq,
        payload: JSON.stringify(event.payload),
        timestamp: event.timestamp,
      },
    });
  }

  private emitToEventBus(event: DagEvent): void {
    if (!event.type.startsWith('dag:')) return;
    try {
      const payload = {
        ...event.payload,
        seq: event.seq,
        dagId: event.dagId,
        nodeId: event.nodeId,
        timestamp: event.timestamp,
      };
      eventBus.emit(event.type, payload as EventMap[typeof event.type]);
    } catch (err) {
      this.logger.error('EventBus emit failed', { eventType: event.type, error: err });
    }
  }

  private deserializeEvent(row: {
    seq: number;
    dagId: string;
    nodeId: string | null;
    type: string;
    payload: string;
    timestamp: Date;
  }): DagEvent {
    return {
      seq: row.seq,
      type: row.type as DagEventType,
      dagId: row.dagId,
      nodeId: row.nodeId || undefined,
      timestamp: row.timestamp,
      payload: JSON.parse(row.payload),
    };
  }
}

export const eventStore = getOrCreateGlobal(
  '__puchipix_event_store__',
  () => new EventStore(),
);
