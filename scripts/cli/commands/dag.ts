/**
 * dag 命令 — 查看指定 DAG 详情（含节点定义和状态历史）
 *
 * 支持 --logs 选项查看该 DAG 的全部关联日志。
 */

import type { Command, CommandContext } from './types';
import { C, stateLabel, statePill } from '../ui/colors';
import { formatTime, formatDateTime } from '../ui/format';
import { printDivider } from '../ui/components';
import { printStructuredLog } from './logs';

export const dagCommand: Command = {
  name: 'dag',
  description: '查看指定 DAG 详情（含节点状态历史）',
  usage: 'dag-cli dag <dagId> [--logs]',
  execute: async ({ client, args }: CommandContext): Promise<void> => {
    const dagId = args.find((a) => !a.startsWith('-'));
    if (!dagId) {
      console.log(`${C.red}Usage: dag-cli dag <dagId>${C.reset}`);
      process.exit(1);
    }

    const withLogs = args.includes('--logs');

    const dag = await client.getDag(dagId);

    if ((dag as { workerDown?: boolean }).workerDown) {
      console.log(`${C.yellow}\u26a0 Worker offline, data may be stale${C.reset}`);
      console.log();
    }

    printDivider(`DAG Detail: ${dag.dagId}`);
    console.log(`${C.bold}Type${C.reset}:      ${dag.taskType}`);
    console.log(`${C.bold}Source URL${C.reset}: ${dag.sourceUrl}`);
    console.log(`${C.bold}Created${C.reset}:    ${formatDateTime(dag.createdAt)}`);
    if (dag.providerId) {
      console.log(`${C.bold}Provider${C.reset}:   ${dag.providerId}`);
    }
    console.log();

    printDivider('Node Definition');
    for (const node of dag.definition.nodes) {
      console.log(
        `  ${C.cyan}${node.id}${C.reset} [${node.phase}] executor=${node.executor} prio=${node.priority}`,
      );
      if (node.dependencies.length > 0) {
        console.log(`    ${C.dim}Depends: ${node.dependencies.join(', ')}${C.reset}`);
      }
      if (node.resourceRequirements.length > 0) {
        console.log(
          `    ${C.dim}Resources: ${node.resourceRequirements.map((r) => `${r.slotType}×${r.count}`).join(', ')}${C.reset}`,
        );
      }
      if (node.timeout) {
        console.log(`    ${C.dim}Timeout: ${node.timeout}ms  Retry: ${node.maxRetries ?? 0}${C.reset}`);
      }
    }
    console.log();

    printDivider('Node Status');
    for (const node of dag.nodes) {
      console.log(`  ${C.bold}${node.nodeId}${C.reset} ${stateLabel(node.state)}`);
      if (node.error) {
        console.log(`    ${C.red}Error: [${node.error.code}] ${node.error.message}${C.reset}`);
        if (node.error.retryable) {
          console.log(`    ${C.yellow}Retryable${C.reset}`);
        }
      }
      if (node.result) {
        console.log(`    ${C.dim}Result: success=${node.result.success}${C.reset}`);
      }
      if (node.history.length > 0) {
        console.log(`    ${C.dim}History (${node.history.length} entries):${C.reset}`);
        for (const h of node.history.slice(-5)) {
          console.log(
            `      ${formatTime(h.timestamp)} ${statePill(h.from)} → ${statePill(h.to)} ${C.dim}(${h.triggeredBy}: ${h.reason})${C.reset}`,
          );
        }
      }
      console.log();
    }

    if (withLogs) {
      console.log(`\n${C.bold}─── DAG Logs ───${C.reset}\n`);
      try {
        const logs = await client.queryLogs({ dagId, limit: 200 });
        if (logs.length === 0) {
          console.log(`${C.dim}No associated logs${C.reset}`);
        } else {
          for (const entry of logs) {
            printStructuredLog(entry);
          }
        }
      } catch (err) {
        console.error(`${C.red}Failed to query logs: ${err instanceof Error ? err.message : String(err)}${C.reset}`);
      }
    }
  },
};
