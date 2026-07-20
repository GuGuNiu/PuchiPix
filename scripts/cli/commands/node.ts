/**
 * node 命令 — 查看指定节点的完整详情和历史
 */

import type { Command, CommandContext } from './types';
import { C, stateLabel, statePill } from '../ui/colors';
import { formatDateTime } from '../ui/format';
import { printDivider } from '../ui/components';

export const nodeCommand: Command = {
  name: 'node',
  description: 'View node details (with full state history)',
  usage: 'dag-cli node <dagId> <nodeId>',
  execute: async ({ client, args }: CommandContext): Promise<void> => {
    const dagId = args[0];
    const nodeId = args[1];
    if (!dagId || !nodeId) {
      console.log(`${C.red}Usage: dag-cli node <dagId> <nodeId>${C.reset}`);
      process.exit(1);
    }

    const dag = await client.getDag(dagId);
    const node = dag.nodes.find((n) => n.nodeId === nodeId);

    if (!node) {
      console.log(`${C.red}Node ${nodeId} not found in DAG ${dagId}${C.reset}`);
      process.exit(1);
    }

    printDivider(`Node details: ${nodeId}`);
    console.log(`${C.bold}DAG${C.reset}: ${dagId}`);
    console.log(`${C.bold}State${C.reset}: ${stateLabel(node.state)}`);
    if (node.error) {
      console.log(`${C.bold}Error${C.reset}: ${C.red}[${node.error.code}] ${node.error.message}${C.reset}`);
      console.log(`  ${C.dim}Retryable: ${node.error.retryable}${C.reset}`);
    }
    if (node.result) {
      console.log(`${C.bold}Result${C.reset}: ${JSON.stringify(node.result, null, 2)}`);
    }
    console.log();

    printDivider('Full state history');
    for (const h of node.history) {
      console.log(
        `  ${formatDateTime(h.timestamp)} ${statePill(h.from)} → ${statePill(h.to)}`,
      );
      console.log(`    ${C.dim}Triggered by: ${h.triggeredBy}  Reason: ${h.reason}${C.reset}`);
      if (h.error) {
        console.log(`    ${C.red}Error: [${h.error.code}] ${h.error.message}${C.reset}`);
      }
    }
  },
};
