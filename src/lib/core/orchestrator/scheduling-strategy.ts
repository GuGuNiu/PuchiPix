import {
  type SchedulableNode,
  type SlotPoolSnapshot,
  type ResourceRequirement,
  TaskPriority,
} from '@/types/dag';
import { loggers } from '../infra/logger';

const logger = loggers.schedulingStrategy();

export interface SchedulingStrategy {

  name: string;

  selectNext(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
  ): SchedulableNode | null;

  selectBatch(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
    maxCount: number,
  ): SchedulableNode[];
}

const STARVATION_THRESHOLD = 30 * 60 * 1000;

const STARVATION_LOTTERY_RATE = 0.1;

export class PriorityFairStrategy implements SchedulingStrategy {
  name = 'priority_fair';

  selectNext(
    readyNodes: SchedulableNode[],
    slotPool: SlotPoolSnapshot,
  ): SchedulableNode | null {
    if (readyNodes.length === 0) return null;

    const schedulable = readyNodes.filter((node) =>
      this.canSatisfyResources(node.resourceRequirements, slotPool),
    );
    if (schedulable.length === 0) return null;

    schedulable.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.submittedAt.getTime() - b.submittedAt.getTime();
    });

    const highest = schedulable[0];
    const lowPriority = schedulable.find(
      (n) =>
        n.priority <= TaskPriority.LOW &&
        Date.now() - n.submittedAt.getTime() > STARVATION_THRESHOLD,
    );

    if (lowPriority && Math.random() < STARVATION_LOTTERY_RATE) {
      logger.info(
        `Strategy ${this.name}: starvation lottery picked ${lowPriority.nodeId}`,
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

      candidates = candidates.filter((n) => n.nodeId !== next.nodeId);

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
