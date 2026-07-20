/**
 * watch 命令 — 实时监控 DAG 事件流（连接 SSE）
 *
 * 支持 --with-logs 选项同时连接日志 SSE 流，实现 DAG 事件 + 日志时间线交织显示。
 * 支持 --dag=<dagId> 选项按 DAG 过滤日志流。
 * 支持 --locale=<locale> 选项按指定语言翻译日志 i18nKey。
 */

import type { Command, CommandContext } from './types';
import { SseClient } from '@/lib/dag-client';
import type { LogQueryFilter } from '@/lib/dag-client';
import type { LogEntryResponse } from '@/lib/dag-client';
import type {
  SseEvent,
  SseInitialEvent,
  SseStatsEvent,
  SseNodeStateChangedEvent,
  SseDagCreatedEvent,
  SseDagCompletedEvent,
  SseNodeCompletedEvent,
  SseNodeFailedEvent,
  SseSchedulingDecisionEvent,
  SseResourceEvent,
  SseDagPausedEvent,
  SseDagResumedEvent,
  SseNodeProgressEvent,
  SseNodeRetryingEvent,
} from '@/lib/dag-client';
import { C, statePill } from '../ui/colors';
import { formatTime } from '../ui/format';
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

export const watchCommand: Command = {
  name: 'watch',
  description: '实时监控 DAG 事件流（可选关联日志 + i18n 翻译）',
  usage: 'dag-cli watch [--with-logs] [--dag=<dagId>] [--locale=<locale>]',
  execute: async ({ client, args }: CommandContext): Promise<void> => {
    const withLogs = args.includes('--with-logs');
    const dagFilter = getArg(args, '--dag');
    const localeArg = getArg(args, '--locale');
    if (localeArg) {
      setServerLocale(localeArg as Locale);
    }

    const sseUrl = client.getStreamUrl();
    console.log(`${C.cyan}⚡ Connecting to DAG SSE stream...${C.reset}`);
    console.log(`${C.dim}URL: ${sseUrl}${C.reset}`);

    let logSse: SseClient | null = null;
    if (withLogs) {
      const logFilter: LogQueryFilter = dagFilter ? { dagId: dagFilter } : {};
      const logUrl = client.getLogStreamUrl(logFilter);
      console.log(`${C.cyan}📜 Also connecting to log stream...${C.reset}`);
      console.log(`${C.dim}Log URL: ${logUrl}${C.reset}`);
      logSse = new SseClient(logUrl, {
        onEvent: (event) => {
          if (event.type === 'log') {
            const entry = event.data as LogEntryResponse;
            // 日志条目用 📜 前缀区分
            process.stdout.write(`${C.dim}📜 ${C.reset}`);
            printStructuredLog(entry, localeArg);
          }
        },
        onError: (err: Error) => {
          console.error(`${C.red}Log stream error: ${err.message}${C.reset}`);
        },
      });
      logSse.connect().catch((err: unknown) => {
        console.error(`${C.red}Log stream connection failed: ${err instanceof Error ? err.message : String(err)}${C.reset}`);
      });
    }

    console.log(`${C.dim}Press Ctrl+C to exit${C.reset}`);
    console.log();

    const sse = new SseClient(sseUrl, {
      onEvent: (event: SseEvent) => handleSseEvent(event),
      onError: (err: Error) => {
        console.error(`${C.red}SSE connection error: ${err.message}${C.reset}`);
        process.exit(1);
      },
    });

    process.on('SIGINT', () => {
      sse.close();
      logSse?.close();
      console.log(`\n${C.dim}Disconnected${C.reset}`);
      process.exit(0);
    });

    await sse.connect();
  },
};

function handleSseEvent(event: SseEvent): void {
  const ts = formatTime(new Date().toISOString());
  const data = event.data;

  switch (event.type) {
    case 'initial': {
      const d = data as SseInitialEvent;
      console.log(`${C.dim}${ts}${C.reset} ${C.bold}[Initial]${C.reset} DAG count: ${d.count}`);
      break;
    }

    case 'stats': {
      const d = data as SseStatsEvent;
      console.log(
        `${C.dim}${ts}${C.reset} ${C.blue}[Stats]${C.reset} DAG: ${d.dags?.totalDags ?? '?'} Active: ${d.dags?.activeDags ?? '?'} Queue: ${d.scheduler?.queueSize ?? '?'} Strategy: ${d.scheduler?.strategy ?? '?'}`,
      );
      break;
    }

    case 'dag:created': {
      const d = data as SseDagCreatedEvent;
      console.log(`${C.dim}${ts}${C.reset} ${C.green}[DAG Created]${C.reset} ${d.dagId} [${d.taskType}]`);
      break;
    }

    case 'dag:completed': {
      const d = data as SseDagCompletedEvent;
      console.log(`${C.dim}${ts}${C.reset} ${C.green}[DAG Completed]${C.reset} ${d.dagId}`);
      break;
    }

    case 'dag:cancelled': {
      console.log(`${C.dim}${ts}${C.reset} ${C.gray}[DAG Cancelled]${C.reset} ${(data as { dagId?: string }).dagId ?? ''}`);
      break;
    }

    case 'dag:paused': {
      const d = data as SseDagPausedEvent;
      console.log(`${C.dim}${ts}${C.reset} ${C.magenta}[DAG Paused]${C.reset} ${d.dagId} pausedCount=${d.pausedCount}`);
      break;
    }

    case 'dag:resumed': {
      const d = data as SseDagResumedEvent;
      console.log(`${C.dim}${ts}${C.reset} ${C.green}[DAG Resumed]${C.reset} ${d.dagId} resumedCount=${d.resumedCount}`);
      break;
    }

    case 'dag:nodeProgress': {
      const d = data as SseNodeProgressEvent;
      const pct = d.total > 0 ? Math.round((d.current / d.total) * 100) : 0;
      console.log(
        `${C.dim}${ts}${C.reset} ${C.yellow}[Progress]${C.reset} ${d.dagId}/${d.nodeId} ${d.phase} ${d.current}/${d.total} (${pct}%)${d.speed ? ` ${d.speed}` : ''}`,
      );
      break;
    }

    case 'dag:nodeRetrying': {
      const d = data as SseNodeRetryingEvent;
      console.log(
        `${C.dim}${ts}${C.reset} ${C.yellow}[Retrying]${C.reset} ${d.dagId}/${d.nodeId} retry=${d.retryCount} ${d.error?.message ?? ''}`,
      );
      break;
    }

    case 'dag:nodeStateChanged': {
      const d = data as SseNodeStateChangedEvent;
      console.log(
        `${C.dim}${ts}${C.reset} ${C.magenta}[Node State]${C.reset} ${d.dagId}/${d.nodeId} ${statePill(d.from)} → ${statePill(d.to)}`,
      );
      break;
    }

    case 'dag:nodeCompleted': {
      const d = data as SseNodeCompletedEvent;
      console.log(`${C.dim}${ts}${C.reset} ${C.green}[Node Completed]${C.reset} ${d.dagId}/${d.nodeId}`);
      break;
    }

    case 'dag:nodeFailed': {
      const d = data as SseNodeFailedEvent;
      console.log(
        `${C.dim}${ts}${C.reset} ${C.red}[Node Failed]${C.reset} ${d.dagId}/${d.nodeId} ${d.error?.message ?? ''}`,
      );
      break;
    }

    case 'dag:schedulingDecision': {
      const d = data as SseSchedulingDecisionEvent;
      console.log(
        `${C.dim}${ts}${C.reset} ${C.cyan}[Scheduling]${C.reset} ${d.dagId}/${d.nodeId} Strategy: ${d.strategy}`,
      );
      break;
    }

    case 'dag:resourceAllocated': {
      const d = data as SseResourceEvent;
      const resStr = Array.isArray(d.resources)
        ? d.resources.map((r) => (typeof r === 'string' ? r : `${r.slotType}×${r.count}`)).join(', ')
        : '';
      console.log(`${C.dim}${ts}${C.reset} ${C.blue}[Resource Allocated]${C.reset} ${d.dagId}/${d.nodeId} ${resStr}`);
      break;
    }

    case 'dag:resourceReleased': {
      const d = data as SseResourceEvent;
      const resStr = Array.isArray(d.resources)
        ? d.resources.map((r) => (typeof r === 'string' ? r : r.slotType)).join(', ')
        : '';
      console.log(`${C.dim}${ts}${C.reset} ${C.gray}[Resource Released]${C.reset} ${d.dagId}/${d.nodeId} ${resStr}`);
      break;
    }

    case 'worker:restarting': {
      const d = data as { restartCount?: number; reason?: string };
      console.log(`${C.dim}${ts}${C.reset} ${C.yellow}\u26a0 Worker restarting (attempt ${d.restartCount ?? '?'})...${C.reset}`);
      break;
    }

    case 'worker:ready': {
      const d = data as { pid?: number; uptime?: number };
      console.log(`${C.dim}${ts}${C.reset} ${C.green}\u2713 Worker ready${d.pid ? ` (PID ${d.pid})` : ''}${C.reset}`);
      break;
    }

    case 'task:stateReset': {
      const d = data as { count?: number };
      console.log(`${C.dim}${ts}${C.reset} ${C.blue}[Task State Reset]${C.reset} ${d.count ?? 0} tasks reset to paused`);
      break;
    }

    default: {
      const payloadStr = typeof data === 'object' ? JSON.stringify(data).slice(0, 100) : String(data);
      console.log(`${C.dim}${ts}${C.reset} ${C.dim}[${event.type}]${C.reset} ${payloadStr}`);
    }
  }
}
