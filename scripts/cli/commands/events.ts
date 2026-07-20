/**
 * events 命令 — 查看指定 DAG 的事件历史
 */

import type { Command, CommandContext } from './types';
import { C } from '../ui/colors';
import { formatDateTime } from '../ui/format';
import { printDivider } from '../ui/components';
import { extractFlag } from '../config';

export const eventsCommand: Command = {
  name: 'events',
  description: 'View event history for a specific DAG',
  usage: 'dag-cli events <dagId> [--limit N] [--from-seq N]',
  execute: async ({ client, args }: CommandContext): Promise<void> => {
    const dagId = args[0];
    if (!dagId) {
      console.log(`${C.yellow}Please specify DAG ID: dag-cli events <dagId>${C.reset}`);
      console.log(`${C.dim}Use 'dag-cli status' to see all DAG IDs${C.reset}`);
      return;
    }

    const limitStr = extractFlag(args, '--limit', '50');
    const fromSeqStr = extractFlag(args, '--from-seq');
    const limit = limitStr ? parseInt(limitStr, 10) || 50 : 50;
    const fromSeq = fromSeqStr ? parseInt(fromSeqStr, 10) || 0 : undefined;

    const data = await client.getDagEvents(dagId, { limit, fromSeq });

    printDivider(`DAG ${dagId} event history (${data.events.length}/${data.totalEvents})`);
    for (const e of data.events) {
      console.log(
        `  ${C.dim}${formatDateTime(e.timestamp)}${C.reset} #${e.seq} ${C.cyan}${e.type}${C.reset}`,
      );
      if (e.nodeId) {
        console.log(`    ${C.dim}node: ${e.nodeId}${C.reset}`);
      }
      if (e.payload && Object.keys(e.payload).length > 0) {
        console.log(`    ${C.dim}payload: ${JSON.stringify(e.payload).slice(0, 120)}${C.reset}`);
      }
    }

    if (data.events.length === 0) {
      console.log(`${C.dim}(no event records)${C.reset}`);
    }
  },
};
