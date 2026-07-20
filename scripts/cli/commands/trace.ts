/**
 * trace 命令 — 查看指定 traceId 的完整链路日志
 *
 * 支持一次性查询模式（HTTP GET）和实时跟踪模式（--follow，SSE 连接）。
 * 支持 --locale=<locale> 按指定语言翻译日志 i18nKey。
 * 展示链路摘要（模块/DAG/节点/耗时/错误统计）+ 完整链路日志。
 */

import type { Command, CommandContext } from './types';
import { SseClient } from '@/lib/dag-client';
import type { LogEntryResponse } from '@/lib/dag-client';
import { C } from '../ui/colors';
import { printStructuredLog } from './logs';
import { setServerLocale } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/types';

function getArg(args: string[], flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

export const traceCommand: Command = {
  name: 'trace',
  description: '查看指定 traceId 的完整链路日志',
  usage: 'dag-cli trace <traceId> [--follow] [--locale=<locale>]',
  execute: async ({ client, args }: CommandContext): Promise<void> => {
    const traceId = args.find((a) => !a.startsWith('-'));
    if (!traceId) {
      console.error(`${C.red}Error: traceId required${C.reset}`);
      console.error(`${C.dim}Usage: dag-cli trace <traceId>${C.reset}`);
      process.exit(1);
    }

    const follow = args.includes('--follow');
    const localeArg = getArg(args, '--locale');
    if (localeArg) {
      setServerLocale(localeArg as Locale);
    }

    console.log(`${C.cyan}Tracing: ${traceId}${C.reset}\n`);

    if (follow) {
      const logUrl = client.getLogStreamUrl({ traceId });
      const sse = new SseClient(logUrl, {
        onEvent: (event) => {
          if (event.type === 'history') {
            const entries = event.data as LogEntryResponse[];
            if (Array.isArray(entries)) {
              printTraceSummary(entries);
              for (const entry of entries) {
                printStructuredLog(entry, localeArg);
              }
            }
          } else if (event.type === 'log') {
            printStructuredLog(event.data as LogEntryResponse, localeArg);
          }
        },
        onError: (err: Error) => {
          console.error(`${C.red}Connection error: ${err.message}${C.reset}`);
          process.exit(1);
        },
      });

      process.on('SIGINT', () => {
        sse.close();
        process.exit(0);
      });

      await sse.connect();
    } else {
      const logs = await client.queryLogs({ traceId, limit: 1000 });
      if (logs.length === 0) {
        console.log(`${C.dim}No logs found for traceId=${traceId}${C.reset}`);
        process.exit(0);
      }
      printTraceSummary(logs);
      for (const entry of logs) {
        printStructuredLog(entry, localeArg);
      }
    }
  },
};

function printTraceSummary(entries: LogEntryResponse[]): void {
  const modules = new Set(entries.map((e) => e.module).filter(Boolean));
  const dagIds = new Set(entries.filter((e) => e.dagId).map((e) => e.dagId));
  const nodeIds = new Set(entries.filter((e) => e.nodeId).map((e) => e.nodeId));
  const errors = entries.filter((e) => e.level === 'ERROR');
  const duration =
    entries.length > 1
      ? new Date(entries[entries.length - 1].timestamp).getTime() -
        new Date(entries[0].timestamp).getTime()
      : 0;

  console.log(`${C.bold}─── Trace Summary ───${C.reset}`);
  console.log(`  ${C.dim}Entries:${C.reset}   ${entries.length}`);
  console.log(`  ${C.dim}Modules:${C.reset}   ${Array.from(modules).join(', ') || '—'}`);
  console.log(`  ${C.dim}DAG:${C.reset}       ${Array.from(dagIds).join(', ') || '—'}`);
  console.log(`  ${C.dim}Nodes:${C.reset}     ${Array.from(nodeIds).join(', ') || '—'}`);
  console.log(`  ${C.dim}Duration:${C.reset}  ${duration}ms`);
  console.log(
    `  ${C.dim}Errors:${C.reset}    ${
      errors.length > 0 ? `${C.red}${errors.length}${C.reset}` : 'none'
    }`,
  );
  console.log(`${C.bold}─── Trace Logs ───${C.reset}\n`);
}
