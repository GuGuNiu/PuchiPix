/**
 * 命令注册表
 *
 * 统一管理所有命令模块，提供按名称查找的能力。
 * 新增命令只需在此文件中导入并注册。
 */

import type { Command } from './types';
import { statusCommand } from './status';
import { dagCommand } from './dag';
import { nodeCommand } from './node';
import { schedulerCommand } from './scheduler';
import { slotsCommand } from './slots';
import { eventsCommand } from './events';
import { pauseCommand, resumeCommand, retryCommand, cancelCommand } from './control';
import { watchCommand } from './watch';
import { logsCommand } from './logs';
import { traceCommand } from './trace';
import { workerCommand } from './worker';
import { createHelpCommand } from './help';

/** 所有注册的命令（help 在最后动态创建） */
const baseCommands: Command[] = [
  statusCommand,
  dagCommand,
  nodeCommand,
  schedulerCommand,
  slotsCommand,
  eventsCommand,
  pauseCommand,
  resumeCommand,
  retryCommand,
  cancelCommand,
  watchCommand,
  logsCommand,
  traceCommand,
  workerCommand,
];

/** 完整命令列表（含 help） */
export const commands: Command[] = [...baseCommands, createHelpCommand(baseCommands)];

/**
 * 按名称或别名查找命令
 */
export function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name || c.aliases?.includes(name));
}
