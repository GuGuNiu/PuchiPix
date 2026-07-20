import { NodeState, TaskPriority } from '@/types/dag';
import type { TransitionPolicy } from '@/types/dag';
import { slotPool } from '../slot/pool';
import { createLogger } from '../../infra/logger';

const logger = createLogger('GalleryNodePolicy');


export const galleryNodePolicy: TransitionPolicy = {
  guards: {
    skipVerify: (ctx) => ctx.definition.config.skipVerify === true,
    // DefaultPath：needValidate
    shouldVerify: (ctx) => ctx.definition.config.skipVerify !== true,
    canResumeVerify: (ctx) =>
      ctx.definition.config.resumableVerify === true && ctx.retryCount < 2,
    isBatch: (ctx) => ctx.definition.priority === TaskPriority.BATCH,
  },

  actions: {
    releasePhaseResources: (ctx) => {
      const reqs = ctx.definition.resourceRequirements;
      for (const req of reqs) {
        if (req.holdUntil === 'phase_complete') {
          slotPool.release(req.slotType, ctx.definition.id);
        }
      }
    },
    cleanupTempFiles: async (ctx) => {
      const tempDir = ctx.definition.config.tempDir as string | undefined;
      if (tempDir) {
        logger.debug('Cleanup temp files', { tempDir, nodeId: ctx.definition.id });
      }
    },
    logRetry: (ctx) => {
      ctx.extras.lastRetryAt = new Date().toISOString();
    },
  },

  transitions: {
    [NodeState.RUNNING]: [
      { target: NodeState.COMPLETED, cond: 'skipVerify', actions: ['releasePhaseResources'] },
      // Default → VERIFYING ExecuteValidate
      { target: NodeState.VERIFYING, cond: 'shouldVerify' },
    ],
  },

  onPause: (ctx) => {
    if (ctx.definition.phase === 'scrape') return NodeState.READY;
    return NodeState.PAUSED;
  },

  onResume: (ctx) => {
    if (ctx.definition.phase === 'scrape') return [NodeState.READY, NodeState.QUEUED];
    return [NodeState.QUEUED];
  },

  onRestart: (ctx) => {
    if (ctx.definition.config.resumableVerify === true && ctx.retryCount < 2) {
      return NodeState.RESUME_VERIFY;
    }
    return null;
  },

  retryPolicy: {
    priority: (ctx) => {
      if (ctx.definition.priority === TaskPriority.BATCH) return TaskPriority.BATCH;
      if (ctx.extras.userTriggered) return TaskPriority.HIGH;
      return TaskPriority.CRITICAL;
    },
    backoff: (ctx) => {
      if (ctx.lastError?.code === 'NETWORK_ERROR') {
        return Math.min(1000 * Math.pow(2, ctx.retryCount), 60000);
      }
      if (ctx.lastError?.code === 'RATE_LIMIT') return 30000;
      return 1000;
    },
    maxAttempts: (ctx) => {
      if (ctx.lastError?.retryable === false) return 0;
      if (ctx.definition.phase === 'download') return 3;
      if (ctx.definition.phase === 'scrape') return 2;
      return 1;
    },
  },
};
