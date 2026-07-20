/**
 * slots 命令 — 查看槽位池使用情况
 */

import type { Command, CommandContext } from './types';
import { C } from '../ui/colors';
import { printDivider, renderProgressBar } from '../ui/components';

export const slotsCommand: Command = {
  name: 'slots',
  description: 'View slot pool usage',
  usage: 'dag-cli slots',
  execute: async ({ client }: CommandContext): Promise<void> => {
    const data = await client.getSlotStatus();

    printDivider('Slot pool status');
    for (const [key, slot] of Object.entries(data.snapshot)) {
      console.log(
        `  ${C.bold}${key.padEnd(16)}${C.reset} ${renderProgressBar(slot.current, slot.max)}  available: ${slot.available}`,
      );
    }

    console.log();
    printDivider('Download concurrency config');
    console.log(`  TS segment concurrency: ${data.downloadConcurrency.tsSegmentConcurrent}`);
    console.log(`  Gallery image concurrency: ${data.downloadConcurrency.galleryImageConcurrent}`);
  },
};
