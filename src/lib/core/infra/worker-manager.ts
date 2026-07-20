import { fork, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { resolve } from 'path';
import { getOrCreateGlobal } from './global-singleton';
import { createLogger } from './logger';
import { isWorkerEvent, type WorkerCommand, type WorkerEvent, type WorkerStats, type WorkerStatus } from './ipc-protocol';

const logger = createLogger('WorkerManager');

const MAX_RESTARTS = 10;
const RESTART_DELAY_MS = 5_000;
const STABLE_UPTIME_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 30_000;
const LOG_BUFFER_SIZE = 1000;

class WorkerManager extends EventEmitter {
  private worker: ChildProcess | null = null;
  private restartCount = 0;
  private isShuttingDown = false;
  private isReady = false;
  private readyAt = 0;
  private lastExitCode: number | null = null;
  private status: WorkerStatus = 'down';
  private logBuffer: string[] = [];
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private readyWaiters: Array<() => void> = [];
  private readyRejecters: Array<(err: Error) => void> = [];

  start(): void {
    if (this.worker) {
      logger.warn('Worker already running, skipping start');
      return;
    }

    this.isShuttingDown = false;
    this.isReady = false;
    this.status = 'starting';

    const workerPath = this.resolveWorkerPath();
    logger.info('Starting worker process', { path: workerPath });

    try {
      this.worker = fork(workerPath, [], {
        stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          PUCHIPIX_PROCESS_MODE: 'worker',
        },
      });
    } catch (err) {
      logger.error('Failed to fork worker process', { error: err });
      this.status = 'down';
      this.scheduleRestart();
      return;
    }

    this.worker.unref();

    this.attachWorkerEvents();
  }

  /**
   * To Worker SendCommand
   *
   */
  send(cmd: WorkerCommand): boolean {
    if (!this.worker || !this.isReady) {
      logger.warn('Cannot send command, worker not ready', { cmd: cmd.type });
      return false;
    }
    try {
      return this.worker.send(cmd);
    } catch (err) {
      logger.error('Failed to send command to worker', { cmd: cmd.type, error: err });
      return false;
    }
  }

  /**
   *
   * Send shutdown Command，Await Worker Exit，Timeoutafter SIGKILL
   */
  async stop(): Promise<void> {
    if (!this.worker) {
      return;
    }

    this.isShuttingDown = true;
    this.status = 'down';

    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    const worker = this.worker;
    this.worker = null;
    this.isReady = false;

    logger.info('Stopping worker, sending shutdown command');

    const exitPromise = new Promise<void>((resolveStop) => {
      const onExit = (): void => {
        resolveStop();
      };
      worker.once('exit', onExit);
    });

    try {
      worker.send({ type: 'shutdown' });
    } catch {
      // Worker mayalreadyExit
    }

    const timeout = new Promise<void>((resolveTimeout) => {
      setTimeout(() => {
        if (worker.exitCode === null && worker.killed === false) {
          logger.warn('Worker shutdown timed out, sending SIGKILL');
          worker.kill('SIGKILL');
        }
        resolveTimeout();
      }, SHUTDOWN_TIMEOUT_MS);
    });

    await Promise.race([exitPromise, timeout]);
    logger.info('Worker stopped');
  }

  
  async restart(): Promise<{ oldPid: number; newPid: number; readyMs: number }> {
    const oldPid = this.worker?.pid ?? 0;
    await this.stop();
    this.isShuttingDown = false;
    this.status = 'restarting';

    const startMs = Date.now();
    this.start();
    await this.waitForReady(READY_TIMEOUT_MS);
    const readyMs = Date.now() - startMs;
    const newPid = this.worker?.pid ?? 0;

    logger.info('Worker restarted', { oldPid, newPid, readyMs });
    return { oldPid, newPid, readyMs };
  }

  /**
   * Await Worker Send ready message
   *
   * @throws TimeoutafterThrow Error
   */
  async waitForReady(timeoutMs: number = READY_TIMEOUT_MS): Promise<void> {
    if (this.isReady) return;

    return new Promise<void>((resolveWait, rejectWait) => {
      const timer = setTimeout(() => {
        const idx = this.readyWaiters.indexOf(resolveWait);
        if (idx >= 0) this.readyWaiters.splice(idx, 1);
        const rIdx = this.readyRejecters.indexOf(rejectWait);
        if (rIdx >= 0) this.readyRejecters.splice(rIdx, 1);
        rejectWait(new Error(`Worker did not become ready within ${timeoutMs}ms`));
      }, timeoutMs);

      this.readyWaiters.push(() => {
        clearTimeout(timer);
        resolveWait();
      });
      this.readyRejecters.push((err: Error) => {
        clearTimeout(timer);
        rejectWait(err);
      });
    });
  }

  getStats(): WorkerStats {
    return {
      status: this.status,
      pid: this.worker?.pid ?? null,
      uptime: this.readyAt > 0 ? Date.now() - this.readyAt : null,
      restartCount: this.restartCount,
      lastExitCode: this.lastExitCode,
    };
  }

  getRecentLogs(lines: number = 50): string[] {
    const count = Math.min(lines, this.logBuffer.length);
    return this.logBuffer.slice(-count);
  }

  private resolveWorkerPath(): string {
    return resolve(process.cwd(), 'worker.ts');
  }

  private attachWorkerEvents(): void {
    if (!this.worker) return;

    const worker = this.worker;

    worker.on('message', (msg: unknown) => {
      if (!isWorkerEvent(msg)) {
        logger.warn('Received non-event message from worker', { msg });
        return;
      }
      this.handleWorkerEvent(msg);
    });

    worker.on('exit', (code, signal) => {
      this.onWorkerExit(code, signal);
    });

    worker.on('error', (err) => {
      logger.error('Worker process error', { error: err });
    });

    if (worker.stdout) {
      worker.stdout.on('data', (data: Buffer) => {
        const line = data.toString().trimEnd();
        if (line) {
          this.pushLog(line);
          process.stdout.write(line + '\n');
        }
      });
    }

    if (worker.stderr) {
      worker.stderr.on('data', (data: Buffer) => {
        const line = data.toString().trimEnd();
        if (line) {
          this.pushLog(line);
          process.stderr.write(line + '\n');
        }
      });
    }
  }

  private handleWorkerEvent(msg: WorkerEvent): void {
    switch (msg.type) {
      case 'ready':
        this.onWorkerReady();
        break;

      case 'event':
        this.emit('event', msg.event, msg.payload);
        break;

      case 'error':
        logger.error('Worker reported error', { message: msg.payload.message, stack: msg.payload.stack });
        break;

      case 'shutdown:complete':
        logger.info('Worker shutdown complete acknowledged');
        break;
    }
  }

  private onWorkerReady(): void {
    this.isReady = true;
    this.readyAt = Date.now();
    this.status = 'ready';
    logger.info('Worker ready', { pid: this.worker?.pid });

    this.emit('event', 'worker:ready', { pid: this.worker?.pid ?? 0, uptime: 0 });

    // NotifyallAwait ready Promise
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) {
      waiter();
    }

    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      if (this.isReady && this.restartCount > 0) {
        logger.info('Worker stable, resetting restart count', { previousCount: this.restartCount });
        this.restartCount = 0;
      }
    }, STABLE_UPTIME_MS);
  }

  private onWorkerExit(code: number | null, signal: string | null): void {
    this.worker = null;
    this.isReady = false;
    this.lastExitCode = code;

    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }

    // NotifyAwait ready Promise Fail
    const rejecters = this.readyRejecters;
    this.readyRejecters = [];
    for (const rejecter of rejecters) {
      rejecter(new Error(`Worker exited with code ${code}, signal ${signal}`));
    }

    if (this.isShuttingDown) {
      this.status = 'down';
      logger.info('Worker exited during graceful shutdown', { code, signal });
      return;
    }

    logger.warn('Worker exited unexpectedly', { code, signal, restartCount: this.restartCount });
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    if (this.isShuttingDown) {
      this.status = 'down';
      return;
    }

    if (this.restartCount >= MAX_RESTARTS) {
      logger.error('Max restart count reached, giving up', { maxRestarts: MAX_RESTARTS });
      this.status = 'fatal';
      this.emit('fatal', { reason: 'max_restarts', count: this.restartCount });
      return;
    }

    this.restartCount++;
    this.status = 'restarting';

    logger.info('Scheduling worker restart', { attempt: this.restartCount, delayMs: RESTART_DELAY_MS });

    this.emit('event', 'worker:restarting', { restartCount: this.restartCount, reason: `exit code ${this.lastExitCode}` });

    setTimeout(() => {
      if (!this.isShuttingDown) {
        logger.info('Restarting worker', { attempt: this.restartCount });
        this.start();
      }
    }, RESTART_DELAY_MS);
  }

  private pushLog(line: string): void {
    this.logBuffer.push(line);
    if (this.logBuffer.length > LOG_BUFFER_SIZE) {
      this.logBuffer.shift();
    }
  }
}

export const workerManager = getOrCreateGlobal('__puchipix_worker_manager__', () => new WorkerManager());
