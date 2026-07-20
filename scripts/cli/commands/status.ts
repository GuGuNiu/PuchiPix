/**
 * status 命令 — 列出所有 DAG 及节点状态概要
 *
 * 支持 --logs 选项显示每个活跃 DAG 的最近关联日志。
 */

import type { Command, CommandContext } from './types';
import { C, statePill } from '../ui/colors';
import { truncate, formatDateTime } from '../ui/format';
import { printDivider, renderProgressBar } from '../ui/components';
import { printStructuredLog } from './logs';

export const statusCommand: Command = {
  name: 'status',
  description: '列出所有 DAG 及节点状态概要',
  usage: 'dag-cli status [--logs]',
  execute: async ({ client, args }: CommandContext): Promise<void> => {
    const withLogs = args.includes('--logs');

    const data = await client.getAllDags();
    const { dags, stats } = data;

    if ((data as { workerDown?: boolean }).workerDown) {
      console.log(`${C.yellow}\u26a0 Worker offline, data may be stale${C.reset}`);
      console.log();
    }

    printDivider('DAG System Overview');
    console.log(
      `${C.bold}Total${C.reset}: ${stats.totalDags}  ${C.bold}Active${C.reset}: ${stats.activeDags}  ${C.bold}Nodes${C.reset}: ${stats.totalNodes}`,
    );
    console.log(
      `${C.bold}Strategy${C.reset}: ${stats.scheduler.strategy}  ${C.bold}Queue${C.reset}: ${stats.scheduler.queueSize}`,
    );
    console.log();

    printDivider('Slot Pool');
    for (const [key, slot] of Object.entries(stats.slots)) {
      console.log(`  ${key.padEnd(16)} ${renderProgressBar(slot.current, slot.max)}`);
    }
    console.log();

    if (dags.length === 0) {
      console.log(`${C.dim}(no DAG records)${C.reset}`);
      return;
    }

    printDivider('DAG List');
    for (const dag of dags) {
      const p = dag.progress;
      const progressStr = `${C.green}✅${p.completed}${C.reset} ${C.cyan}⚡${p.running}${C.reset} ${C.yellow}⏸${p.paused}${C.reset} ${C.red}❌${p.failed}${C.reset} ${C.gray}⏳${p.queued}${C.reset}`;
      console.log(`  ${C.bold}${dag.dagId}${C.reset}  [${dag.taskType}]  ${progressStr}`);
      console.log(
        `    ${C.dim}URL: ${truncate(dag.sourceUrl, 60)}  Created: ${formatDateTime(dag.createdAt)}${C.reset}`,
      );

      for (const node of dag.nodes) {
        const transition = node.lastTransition;
        const reason = transition ? transition.reason : '';
        console.log(
          `    ${C.dim}├─${C.reset} ${node.nodeId.padEnd(12)} ${statePill(node.state)} ${C.dim}${reason}${C.reset}`,
        );
      }
      console.log();
    }

    if (withLogs) {
      console.log(`\n${C.bold}─── Associated Logs ───${C.reset}\n`);
      for (const dag of dags) {
        const p = dag.progress;
        if (p.completed === dag.nodeCount || p.failed === dag.nodeCount) continue;
        try {
          const logs = await client.queryLogs({ dagId: dag.dagId, limit: 5 });
          if (logs.length > 0) {
            console.log(`${C.cyan}${dag.dagId}${C.reset} ${C.dim}last ${logs.length} logs:${C.reset}`);
            for (const entry of logs) {
              printStructuredLog(entry);
            }
            console.log();
          }
        } catch {
          // 查询失败时静默跳过
        }
      }
    }
  },
};
