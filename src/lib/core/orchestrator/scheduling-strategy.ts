import type {
  SchedulableNode,
  SlotPoolSnapshot,
  ResourceRequirement,
  TaskPriority,
} from '@/types/dag';

/**
 * 璋冨害绛栫暐鎺ュ彛
 */
export interface SchedulingStrategy {
  /** 绛栫暐鍚嶇О */
  name: string;

  /**
   * 浠庡氨缁妭鐐逛腑閫夋嫨涓嬩竴涓鎵ц鐨勮妭鐐?
   *
   * @param readyNodes - 鎵€鏈夊氨缁殑鑺傜偣锛堜緷璧栧凡婊¤冻 + 璧勬簮闇€姹傚凡澹版槑锛?
   * @param slotPool - 褰撳墠妲戒綅姹犵姸鎬?
   * @returns 閫変腑鐨勮妭鐐癸紝鎴?null锛堟棤鍙皟搴﹁妭鐐癸級
   */
  selectNext(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
  ): SchedulableNode | null;

  /**
   * 鎵归噺閫夋嫨 鈥?涓€娆￠€夋嫨澶氫釜鑺傜偣锛堢敤浜庡苟琛岃皟搴︼級
   */
  selectBatch(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
    maxCount: number,
  ): SchedulableNode[];
}

/** 浣庝紭鍏堢骇浠诲姟楗ラタ瓒呮椂锛坢s锛?*/
const STARVATION_THRESHOLD = 30 * 60 * 1000; // 30 鍒嗛挓

/** 楗ラタ浠诲姟琚皟搴︾殑姒傜巼 */
const STARVATION_LOTTERY_RATE = 0.1;

/**
 * 浼樺厛绾у叕骞宠皟搴︾瓥鐣?鈥?榛樿绛栫暐
 *
 * 绠楁硶锛?
 * 1. 鎸変紭鍏堢骇鍒嗙粍
 * 2. 楂樹紭鍏堢骇缁勫唴 FIFO 閫夋嫨
 * 3. 浣庝紭鍏堢骇缁勪娇鐢ㄥ姞鏉冭疆杞槻姝㈤ゥ楗?
 *
 * 鐗圭偣锛氶珮浼樺厛绾т紭鍏堬紝浣嗕綆浼樺厛绾т笉浼氭案涔呴ゥ楗?
 */
export class PriorityFairStrategy implements SchedulingStrategy {
  name = 'priority_fair';

  selectNext(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
  ): SchedulableNode | null {
    if (readyNodes.length === 0) return null;

    // 1. 杩囨护鍑鸿祫婧愬彲婊¤冻鐨勮妭鐐?
    const schedulable = readyNodes.filter((node) =>
      this.canSatisfyResources(node.resourceRequirements, slotPool),
    );
    if (schedulable.length === 0) return null;

    // 2. 鎸変紭鍏堢骇闄嶅簭鎺掑簭锛屽悓浼樺厛绾ф寜鎻愪氦鏃堕棿 FIFO
    schedulable.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.submittedAt.getTime() - b.submittedAt.getTime();
    });

    // 3. 妫€鏌ヤ綆浼樺厛绾чゥ楗?
    const highest = schedulable[0];
    const lowPriority = schedulable.find(
      (n) =>
        n.priority <= TaskPriority.LOW &&
        Date.now() - n.submittedAt.getTime() > STARVATION_THRESHOLD,
    );

    // 濡傛灉浣庝紭鍏堢骇浠诲姟绛夊緟瓒呰繃闃堝€硷紝缁欏畠涓€娆¤皟搴︽満浼?
    if (lowPriority && Math.random() < STARVATION_LOTTERY_RATE) {
      console.log(
        `[Strategy:${this.name}] 楗ラタ璋冨害: 鑺傜偣 ${lowPriority.nodeId} 绛夊緟瓒呮椂锛屼紭鍏堣皟搴,
      );
      return lowPriority;
    }

    return highest;
  }

  selectBatch(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
    maxCount: number,
  ): SchedulableNode[] {
    const result: SchedulableNode[] = [];
    let remaining = maxCount;
    const snapshot: SlotPoolSnapshot = JSON.parse(JSON.stringify(slotPool));
    let candidates = [...readyNodes];

    while (remaining > 0 && candidates.length > 0) {
      const next = this.selectNext(candidates, snapshot);
      if (!next) break;

      result.push(next);
      // 浠庡緟閫夊垪琛ㄤ腑绉婚櫎
      candidates = candidates.filter((n) => n.nodeId !== next.nodeId);
      // 棰勬墸璧勬簮
      this.deductResources(next.resourceRequirements, snapshot);
      remaining--;
    }

    return result;
  }

  protected canSatisfyResources(
    requirements: ResourceRequirement[],
    slotPool: SlotPoolSnapshot,
  ): boolean {
    return requirements.every((req) => {
      const available = slotPool[req.slotType]?.available ?? 0;
      return available >= req.count;
    });
  }

  protected deductResources(
    requirements: ResourceRequirement[],
    snapshot: SlotPoolSnapshot,
  ): void {
    for (const req of requirements) {
      if (snapshot[req.slotType]) {
        snapshot[req.slotType].available -= req.count;
      }
    }
  }
}

/**
 * 绾紭鍏堢骇璋冨害绛栫暐 鈥?涓ユ牸鎸変紭鍏堢骇鎺掑簭锛屾棤鍏钩鎬т繚璇?
 *
 * 閫傜敤浜庯細鐢ㄦ埛鏄庣‘瑕佹眰楂樹紭鍏堢骇浠诲姟缁濆浼樺厛鐨勫満鏅?
 */
export class PriorityOnlyStrategy implements SchedulingStrategy {
  name = 'priority_only';

  selectNext(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
  ): SchedulableNode | null {
    const schedulable = readyNodes
      .filter((n) =>
        n.resourceRequirements.every((req) => {
          const available = slotPool[req.slotType]?.available ?? 0;
          return available >= req.count;
        }),
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.submittedAt.getTime() - b.submittedAt.getTime();
      });
    return schedulable[0] || null;
  }

  selectBatch(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
    maxCount: number,
  ): SchedulableNode[] {
    const result: SchedulableNode[] = [];
    let remaining = maxCount;
    const snapshot: SlotPoolSnapshot = JSON.parse(JSON.stringify(slotPool));
    let candidates = [...readyNodes];

    while (remaining > 0 && candidates.length > 0) {
      const next = this.selectNext(candidates, snapshot);
      if (!next) break;
      result.push(next);
      candidates = candidates.filter((n) => n.nodeId !== next.nodeId);
      for (const req of next.resourceRequirements) {
        if (snapshot[req.slotType]) {
          snapshot[req.slotType].available -= req.count;
        }
      }
      remaining--;
    }
    return result;
  }
}
