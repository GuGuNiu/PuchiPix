/**
 * DAG NodeState i18n KeyMap
 *
 */

import { NodeState } from '@/types/dag';

const NODE_STATE_I18N_KEYS: Record<NodeState, string> = {
  [NodeState.PENDING]: 'dag.nodeState.pending',
  [NodeState.READY]: 'dag.nodeState.ready',
  [NodeState.QUEUED]: 'dag.nodeState.queued',
  [NodeState.ALLOCATED]: 'dag.nodeState.allocated',
  [NodeState.RUNNING]: 'dag.nodeState.running',
  [NodeState.PAUSED]: 'dag.nodeState.paused',
  [NodeState.VERIFYING]: 'dag.nodeState.verifying',
  [NodeState.RESUME_VERIFY]: 'dag.nodeState.resumeVerify',
  [NodeState.COMPLETED]: 'dag.nodeState.completed',
  [NodeState.FAILED]: 'dag.nodeState.failed',
  [NodeState.CANCELLED]: 'dag.nodeState.cancelled',
  [NodeState.TIMEOUT]: 'dag.nodeState.timeout',
};

/**
 *
 * @example
 * ```tsx
 * import { useI18n } from '@/lib/i18n';
 * import { getNodeStateI18nKey } from '@/lib/dag-client';
 *
 * const { t } = useI18n();
 * ```
 */
export function getNodeStateI18nKey(state: NodeState): string {
  return NODE_STATE_I18N_KEYS[state] ?? 'dag.nodeState.pending';
}
