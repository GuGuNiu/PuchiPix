/**
 * 控制命令 — pause / resume / retry / cancel
 *
 * 四个 DAG 控制操作合并到一个模块中，
 * 通过 action 参数区分行为。
 */

import type { Command, CommandContext } from './types';
import type { DagControlAction } from '@/lib/dag-client';
import { DagClientError } from '@/lib/dag-client';
import { C, statePill } from '../ui/colors';
import { printDivider } from '../ui/components';

function createControlCommand(
  action: DagControlAction,
  label: string,
  successIcon: string,
  color: string,
  requiresNodeId?: boolean,
): Command {
  const usage = requiresNodeId
    ? `dag-cli ${action} <dagId> [nodeId]`
    : `dag-cli ${action} <dagId>`;

  return {
    name: action,
    description: `${label} DAG${requiresNodeId ? ' (node optional)' : ''}`,
    usage,
    execute: async ({ client, args }: CommandContext): Promise<void> => {
      const dagId = args[0];
      if (!dagId) {
        console.log(`${C.red}Usage: ${usage}${C.reset}`);
        process.exit(1);
      }
      const nodeId = args[1];

      console.log(`${color}${label} DAG ${dagId}${nodeId ? ` node ${nodeId}` : ''}...${C.reset}`);

      let result;
      try {
        result = await (async () => {
          switch (action) {
            case 'pause':
              return client.pauseDag(dagId);
            case 'resume':
              return client.resumeDag(dagId, nodeId);
            case 'retry':
              return client.retryDag(dagId, nodeId);
            case 'cancel':
              return client.cancelDag(dagId);
          }
        })();
      } catch (err) {
        if (err instanceof DagClientError && err.statusCode === 503) {
          console.log(`${C.red}Worker offline, cannot execute control command${C.reset}`);
          process.exit(1);
        }
        throw err;
      }

      console.log(`${successIcon} DAG ${dagId} ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'retry' ? 'retry triggered' : 'cancelled'}${C.reset}`);

      if (result.snapshot) {
        const dag = result.snapshot;
        printDivider('Current node status');
        for (const node of dag.nodes) {
          console.log(`  ${node.nodeId.padEnd(12)} ${statePill(node.state)}`);
        }
      }
    },
  };
}

export const pauseCommand = createControlCommand(
  'pause',
  'Pause',
  `${C.green}✅`,
  C.yellow,
);

export const resumeCommand = createControlCommand(
  'resume',
  'Resume',
  `${C.green}✅`,
  C.yellow,
  true,
);

export const retryCommand = createControlCommand(
  'retry',
  'Retry',
  `${C.green}✅`,
  C.yellow,
  true,
);

export const cancelCommand = createControlCommand(
  'cancel',
  'Cancel',
  `${C.red}🚫`,
  C.yellow,
);
