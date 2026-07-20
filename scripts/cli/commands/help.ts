/**
 * help 命令 — 显示帮助信息
 */

import type { Command } from './types';
import { C } from '../ui/colors';
import type { Command as CommandDef } from './types';

export function createHelpCommand(commands: CommandDef[]): Command {
  return {
    name: 'help',
    description: 'Show help information',
    usage: 'dag-cli help [command]',
    execute: async ({ args }): Promise<void> => {
      if (args[0]) {
        const cmd = commands.find(
          (c) => c.name === args[0] || c.aliases?.includes(args[0]),
        );
        if (cmd) {
          console.log(`\n${C.bold}${cmd.name}${C.reset} — ${cmd.description}`);
          console.log(`\n${C.bold}Usage:${C.reset} ${cmd.usage}`);
          if (cmd.aliases && cmd.aliases.length > 0) {
            console.log(`${C.bold}Aliases:${C.reset} ${cmd.aliases.join(', ')}`);
          }
          console.log();
          return;
        }
        console.log(`${C.red}Unknown command: ${args[0]}${C.reset}`);
      }

      printFullHelp(commands);
    },
  };
}

function printFullHelp(commands: CommandDef[]): void {
  console.log(`
${C.bold}PuchiPix DAG CLI${C.reset} — DAG task scheduling CLI tool

${C.bold}Usage:${C.reset}
  npx tsx scripts/dag-cli.ts <command> [args] [options]

${C.bold}Commands:${C.reset}`);

  const maxName = Math.max(...commands.map((c) => c.name.length));

  for (const cmd of commands) {
    const padded = cmd.name.padEnd(maxName + 2);
    console.log(`  ${C.cyan}${padded}${C.reset} ${cmd.description}`);
  }

  console.log(`
${C.bold}Global options:${C.reset}
  ${C.dim}--host <addr>${C.reset}   Server address (default localhost, or PUCHIPIX_HOST env var)
  ${C.dim}--port <port>${C.reset}   Server port (default 10540, or PUCHIPIX_PORT env var)
  ${C.dim}-h, --help${C.reset}      Show help

${C.bold}Environment variables:${C.reset}
  ${C.dim}PUCHIPIX_HOST${C.reset}  Server address (default localhost)
  ${C.dim}PUCHIPIX_PORT${C.reset}  Server port (default 10540)

${C.bold}Examples:${C.reset}
  ${C.dim}# View all DAG statuses${C.reset}
  npx tsx scripts/dag-cli.ts status

  ${C.dim}# View specific DAG details${C.reset}
  npx tsx scripts/dag-cli.ts dag gallery-123

  ${C.dim}# View node full state history${C.reset}
  npx tsx scripts/dag-cli.ts node gallery-123 scrape

  ${C.dim}# View event history (with limit and from-seq)${C.reset}
  npx tsx scripts/dag-cli.ts events gallery-123 --limit 20 --from-seq 100

  ${C.dim}# Pause DAG${C.reset}
  npx tsx scripts/dag-cli.ts pause gallery-123

  ${C.dim}# Resume specific node of DAG${C.reset}
  npx tsx scripts/dag-cli.ts resume gallery-123 scrape

  ${C.dim}# Watch DAG event stream in real-time${C.reset}
  npx tsx scripts/dag-cli.ts watch

  ${C.dim}# View system logs in real-time (filter by error level)${C.reset}
  npx tsx scripts/dag-cli.ts logs --level=error

  ${C.dim}# View worker process status${C.reset}
  npx tsx scripts/dag-cli.ts worker status

  ${C.dim}# Restart worker process${C.reset}
  npx tsx scripts/dag-cli.ts worker restart

  ${C.dim}# Connect to remote server${C.reset}
  npx tsx scripts/dag-cli.ts --host 192.168.1.100 --port 10540 status
`);
}
