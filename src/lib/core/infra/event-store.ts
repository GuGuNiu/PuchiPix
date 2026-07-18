import prisma from '@/lib/db/prisma';
import { eventBus } from './event-bus';
import { getOrCreateGlobal } from './global-singleton';
import type { DagEvent, DagEventType, DagSnapshot } from '@/types/dag';

/** 内存事件日志最大长度 */
const MAX_IN_MEMORY_LOG = 10000;

/** 快照创建间隔（每 N 个事件创建一次快照） */
const SNAPSHOT_INTERVAL = 100;

class EventStore {
  private currentSeq = 0;
  private inMemoryLog: DagEvent[] = [];
  private pendingPersist: DagEvent[] = [];
  private eventsSinceSnapshot = 0;

  /**
   * 追加事件
   *
   * 同步追加到内存日志 + 异步持久化到 DB。
   * 内存日志保证顺序，DB 持久化保证不丢失。
   */
  async append(event: DagEvent): Promise<void> {
    // 1. 分配事件序列号（单调递增）
    event.seq = ++this.currentSeq;
    if (!event.timestamp) {
      event.timestamp = new Date();
    }

    // 2. 追加到内存日志
    this.inMemoryLog.push(event);
    if (this.inMemoryLog.length > MAX_IN_MEMORY_LOG) {
      this.inMemoryLog.shift(); // 滑动窗口
    }

    // 3. 异步持久化到 DB
    this.persistToDB(event).catch((err) => {
      console.error('[EventStore] DB 持久化失败:', err);
      this.pendingPersist.push(event);
    });

    // 4. 发射到 EventBus（供实时订阅者）
    this.emitToEventBus(event);

    // 5. 检查是否需要创建快照
    this.eventsSinceSnapshot++;
    if (this.eventsSinceSnapshot >= SNAPSHOT_INTERVAL) {
      this.eventsSinceSnapshot = 0;
      // 异步创建快照，不阻塞
      this.snapshot().catch((err) => {
        console.error('[EventStore] 快照创建失败:', err);
      });
    }
  }

  /**
   * 批量追加（用于高效写入）
   */
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

    // 批量写入 DB
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
      console.error('[EventStore] 批量持久化失败:', err);
      this.pendingPersist.push(...events);
    }

    // 发射事件
    for (const event of events) {
      this.emitToEventBus(event);
    }
  }

  /**
   * 从指定序列号开始回放事件
   *
   * 用于：服务重启后恢复 DAG 状态
   */
  async replay(fromSeq: number, dagId?: string): Promise<DagEvent[]> {
    // 1. 先从内存日志读取
    const inMemory = this.inMemoryLog.filter(
      (e) => e.seq > fromSeq && (!dagId || e.dagId === dagId),
    );

    // 2. 如果内存日志不完整，从 DB 读取
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

  /**
   * 获取指定 DAG 的所有事件
   */
  async getDagEvents(dagId: string): Promise<DagEvent[]> {
    const fromDB = await prisma.dagEvent.findMany({
      where: { dagId },
      orderBy: { seq: 'asc' },
    });
    return fromDB.map((r) => this.deserializeEvent(r));
  }

  /**
   * 创建快照
   *
   * 将当前所有 DAG 的状态序列化存储。
   * 用于：加速恢复（从快照恢复而非回放全部事件）。
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
      console.log(`[EventStore] 快照创建完成: ${dagSnapshots.length} 个 DAG`);
    } catch (err) {
      console.error('[EventStore] 快照创建失败:', err);
    }
  }

  /**
   * 从快照恢复
   */
  async restoreFromSnapshot(
    restoreDag: (snapshot: DagSnapshot) => Promise<void>,
    applyEvent: (event: DagEvent) => Promise<void>,
  ): Promise<void> {
    try {
      const latestSnapshots = await prisma.dagSnapshot.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // 最近24小时
          },
        },
        orderBy: { createdAt: 'desc' },
        // distinct: ['dagId'], // SQLite 可能不支持 distinct + orderBy 组合
      });

      // 手动去重，保留每个 dagId 的最新快照
      const seen = new Set<string>();
      const uniqueSnapshots = latestSnapshots.filter((r) => {
        if (seen.has(r.dagId)) return false;
        seen.add(r.dagId);
        return true;
      });

      for (const record of uniqueSnapshots) {
        try {
          const snapshot = JSON.parse(record.state) as DagSnapshot;
          await restoreDag(snapshot);

          // 回放快照之后的事件
          const events = await this.replay(record.lastSeq, snapshot.dagId);
          for (const event of events) {
            await applyEvent(event);
          }
        } catch (err) {
          console.error(`[EventStore] 恢复 DAG ${record.dagId} 失败:`, err);
        }
      }

      console.log(`[EventStore] 从快照恢复: ${uniqueSnapshots.length} 个 DAG`);
    } catch (err) {
      console.error('[EventStore] 快照恢复失败:', err);
    }
  }

  /**
   * 获取当前序列号
   */
  get currentSequence(): number {
    return this.currentSeq;
  }

  /**
   * 重试持久化失败的事件
   */
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
      console.log(`[EventStore] 重试持久化 ${toRetry.length} 个事件成功`);
    } catch (err) {
      console.error('[EventStore] 重试持久化失败:', err);
      this.pendingPersist.push(...toRetry);
    }
  }

  /**
   * 清理旧事件（保留最近 N 天）
   */
  async cleanupOldEvents(retentionDays: number = 30): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      const result = await prisma.dagEvent.deleteMany({
        where: { timestamp: { lt: cutoff } },
      });
      if (result.count > 0) {
        console.log(`[EventStore] 清理 ${result.count} 条过期事件`);
      }
      return result.count;
    } catch (err) {
      console.error('[EventStore] 清理事件失败:', err);
      return 0;
    }
  }

  /**
   * 清理旧快照（保留最近 N 天）
   */
  async cleanupOldSnapshots(retentionDays: number = 7): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    try {
      const result = await prisma.dagSnapshot.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (result.count > 0) {
        console.log(`[EventStore] 清理 ${result.count} 条过期快照`);
      }
      return result.count;
    } catch (err) {
      console.error('[EventStore] 清理快照失败:', err);
      return 0;
    }
  }

  /**
   * 初始化 — 从 DB 恢复当前序列号
   */
  async initialize(): Promise<void> {
    try {
      const lastEvent = await prisma.dagEvent.findFirst({
        orderBy: { seq: 'desc' },
      });
      if (lastEvent) {
        this.currentSeq = lastEvent.seq;
        console.log(`[EventStore] 初始化完成: 当前序列号 = ${this.currentSeq}`);
      } else {
        console.log('[EventStore] 初始化完成: 无历史事件');
      }
    } catch (err) {
      console.error('[EventStore] 初始化失败:', err);
    }
  }

  // ===== 私有方法 =====

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
    // 将 DAG 事件映射到 EventBus 事件
    const eventName = event.type as keyof typeof eventBus extends never ? never : string;
    try {
      // 使用通配符发射，让 SSE 桥接等通配符订阅者接收
      eventBus.emit('*', { name: event.type, payload: event.payload } as never);
    } catch {
      // EventBus 的 emit 不支持 '*' 作为事件名，这里用通配符订阅者机制
      // 实际上 EventBus 的 emit 只支持 EventMap 中定义的事件
      // DAG 事件已在 EventMap 中定义，但类型映射比较复杂
      // 这里简化处理：关键状态变更通过 dag:nodeStateChanged 事件发射
    }

    // 对已定义在 EventMap 中的 DAG 事件，直接发射
    const dagEvents: DagEventType[] = [
      'dag:created',
      'dag:cancelled',
      'dag:completed',
      'dag:nodeStateChanged',
      'dag:nodeCompleted',
      'dag:nodeFailed',
    ];
    if (dagEvents.includes(event.type)) {
      try {
        // 类型安全的 emit
        (eventBus as unknown as {
          emit: (event: string, payload: unknown) => void;
        }).emit(event.type, event.payload);
      } catch (err) {
        console.error(`[EventStore] emit ${event.type} 失败:`, err);
      }
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
