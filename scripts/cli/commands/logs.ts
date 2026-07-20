/**
 * logs 命令 — 实时查看系统日志（支持结构化过滤 + i18n 翻译）
 *
 * 支持 --dag/--node/--trace/--module/--level 结构化过滤参数，
 * 支持 --locale=<locale> 按指定语言翻译 i18nKey，
 * 连接 /api/logs SSE 流实时推送日志。
 */

import type { Command, CommandContext } from './types';
import { SseClient } from '@/lib/dag-client';
import type { LogQueryFilter } from '@/lib/dag-client';
import type { LogEntryResponse } from '@/lib/dag-client';
import { C, logLevelLabel } from '../ui/colors';
import { formatTime } from '../ui/format';
import { t as translate, setServerLocale } from '@/lib/i18n/server';
import type { TranslationKey } from '@/lib/i18n/server';
import type { Locale } from '@/lib/i18n/types';

function getArg(args: string[], flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

export const logsCommand: Command = {
  name: 'logs',
  description: '实时查看系统日志（支持按 DAG/模块/链路过滤 + i18n 翻译）',
  usage: 'dag-cli logs [--dag=<dagId>] [--node=<nodeId>] [--trace=<traceId>] [--module=<name>] [--level=<debug|info|warn|error>] [--locale=<locale>]',
  execute: async ({ client, args }: CommandContext): Promise<void> => {
    const filter: LogQueryFilter = {
      dagId: getArg(args, '--dag'),
      nodeId: getArg(args, '--node'),
      traceId: getArg(args, '--trace'),
      module: getArg(args, '--module'),
      level: getArg(args, '--level'),
    };

    const localeArg = getArg(args, '--locale');
    if (localeArg) {
      setServerLocale(localeArg as Locale);
    }

    const cleanFilter = Object.fromEntries(
      Object.entries(filter).filter(([, v]) => v !== undefined),
    );

    const logUrl = client.getLogStreamUrl(cleanFilter);

    console.log(`${C.cyan}📜 Connecting to log stream...${C.reset}`);

    const filterParts = Object.entries(cleanFilter)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`);
    if (filterParts.length > 0) {
      console.log(`${C.dim}Filter: ${filterParts.join(', ')}${C.reset}`);
    }
    if (localeArg) {
      console.log(`${C.dim}Locale: ${localeArg}${C.reset}`);
    }
    console.log(`${C.dim}Press Ctrl+C to exit${C.reset}`);
    console.log();

    const sse = new SseClient(logUrl, {
      onEvent: (event) => {
        if (event.type === 'history') {
          const entries = event.data as LogEntryResponse[];
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              printStructuredLog(entry, localeArg);
            }
          }
        } else if (event.type === 'log') {
          printStructuredLog(event.data as LogEntryResponse, localeArg);
        }
      },
      onError: (err: Error) => {
        console.error(`${C.red}Log stream error: ${err.message}${C.reset}`);
        process.exit(1);
      },
    });

    process.on('SIGINT', () => {
      sse.close();
      console.log(`\n${C.dim}Disconnected from log stream${C.reset}`);
      process.exit(0);
    });

    await sse.connect();
  },
};

/**
 * 打印结构化日志条目
 *
 * @param entry - 日志条目
 * @param locale - 可选 locale，指定时按该 locale 翻译 i18nKey
 */
export function printStructuredLog(entry: LogEntryResponse, locale?: string): void {
  const ts = formatTime(entry.timestamp);
  const level = logLevelLabel(entry.level);
  const moduleLabel = `${C.cyan}[${entry.module ?? entry.source}]${C.reset}`;

  const ctxParts: string[] = [];
  if (entry.dagId) ctxParts.push(`${C.blue}dag=${entry.dagId}${C.reset}`);
  if (entry.nodeId) ctxParts.push(`${C.blue}node=${entry.nodeId}${C.reset}`);
  if (entry.traceId) ctxParts.push(`${C.magenta}trace=${entry.traceId.slice(0, 12)}${C.reset}`);
  const ctxStr = ctxParts.length > 0 ? ` ${ctxParts.join(' ')}` : '';

  let displayMessage = entry.message;
  if (entry.i18nKey && locale) {
    try {
      displayMessage = translate(entry.i18nKey as TranslationKey, entry.i18nParams);
    } catch {
    }
  }

  console.log(`${C.dim}${ts}${C.reset} ${level} ${moduleLabel}${ctxStr} ${displayMessage}`);

  if (entry.data !== undefined && entry.data !== null) {
    if (typeof entry.data === 'object') {
      console.log(`  ${C.dim}${JSON.stringify(entry.data)}${C.reset}`);
    } else {
      console.log(`  ${C.dim}${String(entry.data)}${C.reset}`);
    }
  }

  if (entry.details) {
    console.log(`  ${C.dim}${entry.details}${C.reset}`);
  }
}
