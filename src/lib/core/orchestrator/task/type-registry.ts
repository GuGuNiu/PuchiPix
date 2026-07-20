import {
  NodeState,
  type TaskType,
  type TaskPhase,
  type NodeError,
  type TransitionPolicy,
} from '@/types/dag';

interface NodeForAggregation {
  state: NodeState;
  phase: TaskPhase;
  error: NodeError | null;
}

type AggregatorFn = (nodes: NodeForAggregation[]) => string;

class TaskTypeRegistry {
  private aggregators = new Map<TaskType, AggregatorFn>();
  private transitionPolicies = new Map<TaskType, TransitionPolicy>();

  /** RegisterAggregationStrategy */
  registerAggregator(taskType: TaskType, fn: AggregatorFn): void {
    this.aggregators.set(taskType, fn);
  }

  /** RegisterConvertStrategy */
  registerTransitionPolicy(taskType: TaskType, policy: TransitionPolicy): void {
    this.transitionPolicies.set(taskType, policy);
  }

  /** GetAggregationStrategy——not RegisterReturn null */
  getAggregator(taskType: TaskType): AggregatorFn | null {
    return this.aggregators.get(taskType) ?? null;
  }

  /** GetConvertStrategy——not RegisterReturn null */
  getTransitionPolicy(taskType: TaskType): TransitionPolicy | null {
    return this.transitionPolicies.get(taskType) ?? null;
  }
}

/** GlobalSingleton */
export const taskTypeRegistry = new TaskTypeRegistry();

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Gallery typeAggregationStrategyRegister
 * ─────────────────────────────────────────────────────────────────────────────
 */

taskTypeRegistry.registerAggregator('gallery', (nodes) => {
  if (nodes.some((n) => n.state === NodeState.CANCELLED)) return 'cancelled';
  if (nodes.some((n) => n.state === NodeState.FAILED)) {
    const scrapeNode = nodes.find((n) => n.phase === 'scrape');
    if (scrapeNode?.state === NodeState.FAILED && scrapeNode?.error?.code === 'NOT_FOUND') {
      return 'not_found';
    }
    return 'failed';
  }
  if (nodes.some((n) => n.state === NodeState.TIMEOUT)) return 'failed';
  if (nodes.some((n) => n.state === NodeState.PAUSED)) return 'paused';

  if (nodes.every((n) => n.state === NodeState.COMPLETED)) return 'completed';

  /*
   * Check scrape state BEFORE download — if scrape is being retried (RUNNING/
   * QUEUED/VERIFYING), the gallery must NOT be reported as 'completed' even if
   * the download node is still COMPLETED from a previous run.  Otherwise the
   * scrape executor sees gallery.status === 'completed' and immediately aborts
   * with GALLERY_NOT_FOUND, creating an infinite verification-retry loop.
   */
  const scrapeNode = nodes.find((n) => n.phase === 'scrape');
  if (
    scrapeNode &&
    (scrapeNode.state === NodeState.RUNNING ||
      scrapeNode.state === NodeState.ALLOCATED ||
      scrapeNode.state === NodeState.VERIFYING)
  ) {
    return 'scraping';
  }
  if (
    scrapeNode &&
    (scrapeNode.state === NodeState.QUEUED || scrapeNode.state === NodeState.READY)
  ) {
    return 'scrape_pending';
  }

  const downloadNode = nodes.find((n) => n.phase === 'download');
  // Only report 'completed' when BOTH scrape and download are COMPLETED.
  if (
    downloadNode?.state === NodeState.COMPLETED &&
    scrapeNode?.state === NodeState.COMPLETED
  ) {
    return 'completed';
  }
  if (
    downloadNode &&
    (downloadNode.state === NodeState.RUNNING ||
      downloadNode.state === NodeState.ALLOCATED ||
      downloadNode.state === NodeState.VERIFYING)
  ) {
    return 'downloading';
  }
  if (
    downloadNode &&
    (downloadNode.state === NodeState.QUEUED || downloadNode.state === NodeState.READY)
  ) {
    return 'download_pending';
  }

  if (scrapeNode?.state === NodeState.COMPLETED) return 'download_pending';

  return 'pending';
});

// TaskTypeRegistry.registerAggregator('video', (nodes) => { ... });
