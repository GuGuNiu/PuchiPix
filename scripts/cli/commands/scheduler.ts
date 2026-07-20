/**
 * scheduler 命令 — 查看调度器队列统计
 */

import type { Command, CommandContext } from './types';
import { C } from '../ui/colors';
import { printDivider } from '../ui/components';

export const schedulerCommand: Command = {
  name: 'scheduler',
  description: 'View scheduler queue stats',
  usage: 'dag-cli scheduler',
  execute: async ({ client }: CommandContext): Promise<void> => {
    const s = await client.getSchedulerStats();

    printDivider('Scheduler stats');
    console.log(`${C.bold}Strategy${C.reset}: ${s.strategy}`);
    console.log(`${C.bold}Queue length${C.reset}: ${s.queueSize}`);
    console.log();

    if (s.byPriority && Object.keys(s.byPriority).length > 0) {
      printDivider('By priority');
      for (const [prio, count] of Object.entries(s.byPriority)) {
        console.log(`  ${prio.padEnd(12)} ${count}`);
      }
      console.log();
    }

    if (s.byTaskType && Object.keys(s.byTaskType).length > 0) {
      printDivider('By task type');
      for (const [type, count] of Object.entries(s.byTaskType)) {
        console.log(`  ${type.padEnd(12)} ${count}`);
      }
    }
  },
};
