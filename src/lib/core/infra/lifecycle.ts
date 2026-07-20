import { getOrCreateGlobal } from './global-singleton';
import { loggers } from './logger';

const logger = loggers.lifecycle();

export type LifecyclePhase = 'booting' | 'ready' | 'draining' | 'shutdown';
export type LifecycleStatus = LifecyclePhase | 'error';
export type LifecycleMode = 'main' | 'worker';

export interface LifecycleHook {
  name: string;
  fn: () => Promise<void>;
  timeout?: number;
}

class LifecycleManager {
  private status: LifecycleStatus = 'booting';
  private initHooks: LifecycleHook[] = [];
  private shutdownHooks: LifecycleHook[] = [];
  private signalHandlersBound = false;
  private shuttingDown = false;
  private startedAt: number = 0;
  private lastError: Error | null = null;
  private registeredInitNames = new Set<string>();
  private registeredShutdownNames = new Set<string>();
  private mode: LifecycleMode = 'main';

  setMode(mode: LifecycleMode): void {
    this.mode = mode;
  }

  get currentMode(): LifecycleMode {
    return this.mode;
  }

  get currentStatus(): LifecycleStatus {
    return this.status;
  }

  get uptime(): number {
    return this.startedAt > 0 ? Date.now() - this.startedAt : 0;
  }

  get isReady(): boolean {
    return this.status === 'ready';
  }

  isHealthy(): boolean {
    return this.status === 'ready';
  }

  onInit(hook: LifecycleHook): void {
    if (this.registeredInitNames.has(hook.name)) {
      return;
    }
    this.registeredInitNames.add(hook.name);

    if (this.status === 'ready') {
      this.runWithTimeout(hook.fn(), hook.timeout ?? 10000, hook.name)
        .then(() => logger.info(`Hook ${hook.name} completed (HMR)`))
        .catch((err) => logger.error(`Hook ${hook.name} failed (HMR)`, { error: err }));
      return;
    }

    if (this.status !== 'booting') {
      logger.warn(`onInit("${hook.name}") called in ${this.status} phase, ignored`);
      return;
    }
    this.initHooks.push(hook);
  }

  onShutdown(hook: LifecycleHook): void {
    if (this.registeredShutdownNames.has(hook.name)) {
      return;
    }
    this.registeredShutdownNames.add(hook.name);
    this.shutdownHooks.push(hook);
  }

  async boot(): Promise<void> {
    if (this.status === 'ready') {
      this.bindSignalHandlers();
      return;
    }

    if (this.status !== 'booting') {
      throw new Error(`Cannot boot in ${this.status} phase`);
    }

    logger.info(`Boot sequence started, ${this.initHooks.length} init hooks`);

    for (const hook of this.initHooks) {
      const timeout = hook.timeout ?? 10000;
      logger.info(`Executing init hook: ${hook.name} (timeout: ${timeout}ms)`);

      try {
        await this.runWithTimeout(hook.fn(), timeout, hook.name);
        logger.info(`Hook ${hook.name} completed`);
      } catch (err) {
        this.status = 'error';
        this.lastError = err instanceof Error ? err : new Error(String(err));
        logger.error(`Hook ${hook.name} failed`, { error: this.lastError.message });
        throw this.lastError;
      }
    }

    this.status = 'ready';
    this.startedAt = Date.now();
    this.bindSignalHandlers();
    logger.info('Application ready (uptime counter started)');
  }

  /**
   * Transition to draining state (reject new requests), execute shutdown hooks
   * in reverse order, then transition to shutdown state and exit the process.
   */
  async shutdown(exitCode: number = 0): Promise<void> {
    if (this.shuttingDown) {
      logger.info('Shutdown already in progress, skipping');
      return;
    }

    this.shuttingDown = true;
    this.status = 'draining';
    logger.info(`Graceful shutdown started, ${this.shutdownHooks.length} shutdown hooks`);

    const reversed = [...this.shutdownHooks].reverse();
    for (const hook of reversed) {
      const timeout = hook.timeout ?? 10000;
      logger.info(`Executing shutdown hook: ${hook.name} (timeout: ${timeout}ms)`);

      try {
        await this.runWithTimeout(hook.fn(), timeout, hook.name);
        logger.info(`Hook ${hook.name} completed`);
      } catch (err) {
        logger.error(
          `Hook ${hook.name} failed`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    this.status = 'shutdown';
    logger.info('Graceful shutdown completed, exiting process');
    process.exit(exitCode);
  }

  /**
   */
  getHealthInfo(): {
    status: string;
    uptime: number;
    uptimeStr: string;
    startedAt: string | null;
    initHooks: number;
    shutdownHooks: number;
    lastError: string | null;
  } {
    return {
      status: this.status,
      uptime: this.uptime,
      uptimeStr: this.formatUptime(this.uptime),
      startedAt: this.startedAt > 0 ? new Date(this.startedAt).toISOString() : null,
      initHooks: this.initHooks.length,
      shutdownHooks: this.shutdownHooks.length,
      lastError: this.lastError?.message ?? null,
    };
  }

  private runWithTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Hook "${name}" timed out (${ms}ms)`));
      }, ms);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private bindSignalHandlers(): void {
    if (this.signalHandlersBound) return;
    this.signalHandlersBound = true;

    if (this.mode === 'worker') {
      process.on('uncaughtException', (err) => {
        logger.error('uncaughtException', { error: err instanceof Error ? err.message : String(err) });
        this.lastError = err;
      });

      process.on('unhandledRejection', (reason) => {
        logger.error('unhandledRejection', { error: reason });
      });
      return;
    }

    const handler = (signal: string): void => {
      logger.info(`Received ${signal} signal, starting graceful shutdown...`);
      this.shutdown(0).catch((err) => {
        logger.error('Graceful shutdown failed', { error: err });
        process.exit(1);
      });
    };

    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGHUP', () => handler('SIGHUP'));

    process.on('uncaughtException', (err) => {
      logger.error('uncaughtException', { error: err instanceof Error ? err.message : String(err) });
      this.lastError = err;
    });

    process.on('unhandledRejection', (reason) => {
      logger.error('unhandledRejection', { error: reason });
    });
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
}

/**
 * HMR security globalSingletonExport。
 *
 */
export const lifecycle = getOrCreateGlobal('__puchipix_lifecycle__', () => new LifecycleManager());
