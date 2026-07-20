/**
 * worker 命令 — Worker 进程管理（status / restart / logs）
 *
 * 子命令：
 *   worker status          查看 Worker 进程状态
 *   worker restart         手动重启 Worker 进程
 *   worker logs [--lines=N]  查看 Worker 最近日志
 */

import type { Command, CommandContext } from './types';
import { C } from '../ui/colors';
import { printDivider } from '../ui/components';
import { formatDuration } from '../ui/format';
import { DagClientError } from '@/lib/dag-client';

export const workerCommand: Command = {
    name: 'worker',
    description: 'Worker process management (status / restart / logs)',
    usage: 'dag-cli worker <status|restart|logs> [options]',
    aliases: ['w'],
    execute: async ({ client, args }: CommandContext): Promise<void> => {
        const subcommand = args[0];

        switch (subcommand) {
            case 'status':
                await workerStatus(client);
                break;
            case 'restart':
                await workerRestart(client);
                break;
            case 'logs':
                await workerLogs(client, args.slice(1));
                break;
            default:
                console.log(`${C.red}Unknown subcommand: ${subcommand ?? '(none)'}${C.reset}`);
                console.log(`${C.dim}Usage: ${workerCommand.usage}${C.reset}`);
                console.log(`  ${C.cyan}status${C.reset}   Show worker process status`);
                console.log(`  ${C.cyan}restart${C.reset}  Restart worker process`);
                console.log(`  ${C.cyan}logs${C.reset}     Show recent worker logs`);
        }
    },
};

async function workerStatus(client: CommandContext['client']): Promise<void> {
    const stats = await client.getWorkerStatus();

    printDivider('Worker Process Status');

    const statusColor =
        stats.status === 'ready' ? C.green :
            stats.status === 'starting' || stats.status === 'restarting' ? C.yellow :
                stats.status === 'fatal' ? C.red : C.gray;

    console.log(`  ${C.bold}Status${C.reset}        ${statusColor}${stats.status}${C.reset}`);
    console.log(`  ${C.bold}PID${C.reset}           ${stats.pid ?? '—'}`);
    console.log(`  ${C.bold}Uptime${C.reset}        ${stats.uptime != null ? formatDuration(stats.uptime) : '—'}`);
    console.log(`  ${C.bold}Restarts${C.reset}      ${stats.restartCount}`);
    console.log(`  ${C.bold}Last exit${C.reset}     ${stats.lastExitCode ?? 'null'}`);

    printDivider();
}

async function workerRestart(client: CommandContext['client']): Promise<void> {
    console.log(`${C.yellow}Restarting worker...${C.reset}`);

    try {
        const result = await client.restartWorker();
        console.log(`  ${C.gray}Worker stopped (PID ${result.oldPid})${C.reset}`);
        console.log(`  ${C.green}Worker started (PID ${result.newPid})${C.reset}`);
        console.log(`  ${C.bold}Ready in ${formatDuration(result.readyMs)}${C.reset}`);
        console.log(`${C.green}Done.${C.reset}`);
    } catch (err) {
        if (err instanceof DagClientError) {
            console.error(`${C.red}Failed to restart worker: ${err.message}${C.reset}`);
        } else {
            console.error(`${C.red}Error: ${err instanceof Error ? err.message : String(err)}${C.reset}`);
        }
        process.exit(1);
    }
}

async function workerLogs(client: CommandContext['client'], args: string[]): Promise<void> {
    let lines = 50;

    const linesArg = args.find((a) => a.startsWith('--lines='));
    if (linesArg) {
        const parsed = parseInt(linesArg.split('=')[1], 10);
        if (!Number.isNaN(parsed) && parsed > 0) {
            lines = parsed;
        }
    } else {
        const idx = args.indexOf('--lines');
        if (idx >= 0 && idx + 1 < args.length) {
            const parsed = parseInt(args[idx + 1], 10);
            if (!Number.isNaN(parsed) && parsed > 0) {
                lines = parsed;
            }
        }
    }

    const logs = await client.getWorkerLogs(lines);

    if (logs.length === 0) {
        console.log(`${C.dim}(no worker logs available)${C.reset}`);
        return;
    }

    printDivider(`Worker Logs (last ${logs.length} lines)`);
    for (const line of logs) {
        console.log(line);
    }
    printDivider();
}
