/**
 * PuchiPix DAG CLI — DAG 任务调度系统命令行工具
 *
 * 模块化 CLI 入口，路由到 scripts/cli/commands/ 下的各命令模块。
 *
 * 用法：
 *   npx tsx scripts/dag-cli.ts <command> [args] [options]
 *
 * 架构：
 *   scripts/dag-cli.ts          ← 入口（本文件）
 *   scripts/cli/
 *     ├── config.ts             ← 配置管理
 *     ├── commands/             ← 命令模块（每个命令一个文件）
 *     │   └── index.ts          ← 命令注册表
 *     └── ui/                   ← 终端 UI 组件
 *         ├── colors.ts         ← ANSI 颜色
 *         ├── format.ts         ← 格式化工具
 *         └── components.ts     ← 可复用组件
 *   src/lib/dag-client/         ← API SDK 层（DagClient + 类型 + SSE 客户端）
 */

import { createDagClient, DagClientError } from '@/lib/dag-client';
import { parseGlobalOptions } from './cli/config';
import { findCommand, commands } from './cli/commands';
import { C } from './cli/ui/colors';
import { createHelpCommand } from './cli/commands/help';

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { config, remaining, showHelp } = parseGlobalOptions(rawArgs);

  const commandName = remaining[0];

  if (!commandName || showHelp) {
    const helpCmd = createHelpCommand(commands);
    await helpCmd.execute({ client: createDagClient(config.host, config.port), args: showHelp ? [commandName].filter(Boolean) : [] });
    return;
  }

  const command = findCommand(commandName);
  if (!command) {
    console.log(`${C.red}Unknown command: ${commandName}${C.reset}`);
    console.log(`${C.dim}Use 'dag-cli help' to see available commands${C.reset}`);
    process.exit(1);
  }

  const commandArgs = remaining.slice(1);
  const client = createDagClient(config.host, config.port);

  try {
    await command.execute({ client, args: commandArgs });
  } catch (err) {
    if (err instanceof DagClientError) {
      if (err.isNetworkError()) {
        console.error(`${C.red}Connection failed: ${err.message}${C.reset}`);
        console.error(`${C.dim}Please ensure the server is running: ${config.baseUrl}${C.reset}`);
      } else if (err.isNotFound()) {
        console.error(`${C.yellow}Not found: ${err.message}${C.reset}`);
      } else {
        console.error(`${C.red}API error${err.statusCode ? ` (HTTP ${err.statusCode})` : ''}: ${err.message}${C.reset}`);
      }
    } else {
      console.error(`${C.red}Error: ${err instanceof Error ? err.message : String(err)}${C.reset}`);
    }
    process.exit(1);
  }
}

main();
