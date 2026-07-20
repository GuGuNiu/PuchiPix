import { eventBus } from '../infra/event-bus';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { sleep, randomDelay } from '../stealth/anti-crawler';
import { SchedulerStrategy, type SchedulerStrategyOptions } from './scheduler-strategy';
import { DagManager, type DagTaskId, type DagCapableTask, type DagStats } from './dag/manager';
import { logT } from '@/lib/i18n/server';
import { loggers } from '../infra/logger';

export interface BaseTask {
  status: BaseTaskStatus;
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
  priority?: number;
  dependsOn?: DagTaskId[];
}

export type BaseTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'cancelled';

export interface OrchestratorConfig {
  name: string;
  globalKey: string;
  defaultMaxRetries?: number;
  schedulerOptions?: SchedulerStrategyOptions;
  rateLimitKeywords?: string[];
  rateLimitCooldownMin?: number;
  rateLimitCooldownMax?: number;
  retryDelayMin?: number;
  retryDelayMax?: number;
  historyLimit?: number;
  maxQueueSize?: number;
}

export interface OrchestratorStatus {
  running: boolean;
  paused: boolean;
  rateLimited: boolean;
  queueLength: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  cooldownEndsAt: number | null;
  nextTaskAt: number | null;
  rejectedEnqueueCount: number;
  maxQueueSize: number;
}


export abstract class OrchestratorBase<T extends BaseTask> {
  protected readonly logger = loggers.orchestrator();
  protected queue: T[] = [];
  protected currentTask: T | null = null;
  protected history: T[] = [];
  protected processedCount = 0;
  protected succeededCount = 0;
  protected failedCount = 0;
  protected running = false;
  protected paused = false;
  protected rateLimitedUntil = 0;
  protected nextTaskAt = 0;
  protected abortController: AbortController | null = null;
  protected dag = new DagManager<DagCapableTask>();
  protected rejectedEnqueueCount = 0;

  protected readonly config: Required<OrchestratorConfig>;
  protected readonly scheduler: SchedulerStrategy;

  constructor(config: OrchestratorConfig) {
    this.config = {
      name: config.name,
      globalKey: config.globalKey,
      defaultMaxRetries: config.defaultMaxRetries ?? 2,
      schedulerOptions: config.schedulerOptions ?? {},
      rateLimitKeywords: config.rateLimitKeywords ?? [],
      rateLimitCooldownMin: config.rateLimitCooldownMin ?? 10 * 60_000,
      rateLimitCooldownMax: config.rateLimitCooldownMax ?? 15 * 60_000,
      retryDelayMin: config.retryDelayMin ?? 60_000,
      retryDelayMax: config.retryDelayMax ?? 120_000,
      historyLimit: config.historyLimit ?? 100,
      maxQueueSize: config.maxQueueSize ?? 50,
    };

    this.scheduler = new SchedulerStrategy({
      ...this.config.schedulerOptions,
      logPrefix: `[${this.config.name}]`,
      onRest: (reason, durationMs) => {
        this.nextTaskAt = Date.now() + durationMs;
        this.emitCooldown(reason, durationMs);
      },
    });
  }

  protected abstract processTask(task: T): Promise<boolean>;

  protected abstract getTaskId(task: T): string | number;

  protected abstract isSameTask(a: T, b: T): boolean;

  protected abstract emitTaskQueued(task: T, position: number): void;

  protected abstract emitTaskStarted(task: T): void;

  protected abstract emitTaskCompleted(task: T): void;

  protected abstract emitTaskFailed(task: T, error: string, willRetry: boolean): void;

  protected abstract emitRateLimited(task: T, cooldownMs: number): void;

  protected abstract emitCooldown(reason: string, durationMs: number): void;

  protected abstract emitQueueEmpty(): void;

  protected abstract emitStatus(): void;

  enqueue(task: T): number {
    const existing = this.queue.find(
      (t) => t.status === 'pending' && this.isSameTask(t, task),
    );
    if (existing) {
      return this.queue.indexOf(existing) + 1;
    }

    if (this.currentTask && this.isSameTask(this.currentTask, task)) {
      return 0;
    }

    const pendingCount = this.queue.filter((t) => t.status === 'pending').length;
    if (pendingCount >= this.config.maxQueueSize) {
      this.rejectedEnqueueCount++;
      this.logger.warn(
        logT('log.orchestratorBase.queueFullRejected', {
          name: this.config.name,
          pending: pendingCount,
          max: this.config.maxQueueSize,
          id: this.getTaskId(task),
          rejected: this.rejectedEnqueueCount,
        }),
      );
      return -1;
    }

    this.queue.push(task);
    this.dag.addTask({
      id: this.getTaskId(task),
      priority: task.priority,
      dependsOn: task.dependsOn,
    });
    const position = this.queue.length;

    this.emitTaskQueued(task, position);

    this.logger.info(
      logT('log.orchestratorBase.taskEnqueued', {
        name: this.config.name,
        id: this.getTaskId(task),
        position,
        current: pendingCount + 1,
        max: this.config.maxQueueSize,
      }),
    );

    if (this.running && !this.paused && !this.abortController) {
      this.startProcessingLoop();
    }

    return position;
  }

  declareDependency(taskId: DagTaskId, dependsOnId: DagTaskId): void {
    this.dag.addDependency(taskId, dependsOnId);
    this.dag.detectCycles();
  }

  start(): void {
    if (this.running) {
      this.logger.infoT('log.orchestratorBase.alreadyRunning', { name: this.config.name });
      return;
    }

    this.running = true;
    this.paused = false;
    this.logger.infoT('log.orchestratorBase.started', { name: this.config.name });

    this.emitStatus();

    if (this.queue.length > 0) {
      this.startProcessingLoop();
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.abortController?.abort();
    this.logger.infoT('log.orchestratorBase.stopping', { name: this.config.name });

    if (this.currentTask) {
      this.logger.info(
        logT('log.orchestratorBase.waitingForTask', {
          name: this.config.name,
          taskId: this.getTaskId(this.currentTask),
        }),
      );
      const waitStart = Date.now();
      while (this.currentTask && Date.now() - waitStart < 15000) {
        await sleep(500);
      }
    }

    for (const task of this.queue) {
      if (task.status === 'pending') {
        task.status = 'cancelled';
      }
    }

    this.emitStatus();
    this.logger.infoT('log.orchestratorBase.stopped', { name: this.config.name });
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.logger.infoT('log.orchestratorBase.paused', { name: this.config.name });
    this.emitStatus();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.logger.infoT('log.orchestratorBase.resumed', { name: this.config.name });
    this.emitStatus();

    if (this.queue.length > 0 && !this.abortController) {
      this.startProcessingLoop();
    }
  }

  cancel(id: string | number): boolean {
    const idx = this.queue.findIndex(
      (t) => t.status === 'pending' && this.getTaskId(t) === id,
    );
    if (idx >= 0) {
      this.queue[idx].status = 'cancelled';
      this.queue.splice(idx, 1);
      this.logger.infoT('log.orchestratorBase.taskCancelled', { name: this.config.name, id });
      return true;
    }
    return false;
  }

  clearQueue(): number {
    const count = this.queue.filter((t) => t.status === 'pending').length;
    this.queue = [];
    this.logger.infoT('log.orchestratorBase.queueCleared', { name: this.config.name, count });
    return count;
  }

  getHistory(limit: number = 20): T[] {
    return this.history.slice(-limit).reverse();
  }

  getBaseStatus(): OrchestratorStatus {
    const now = Date.now();
    return {
      running: this.running,
      paused: this.paused,
      rateLimited: this.rateLimitedUntil > now,
      queueLength: this.queue.filter((t) => t.status === 'pending').length,
      processedCount: this.processedCount,
      succeededCount: this.succeededCount,
      failedCount: this.failedCount,
      cooldownEndsAt: this.rateLimitedUntil > now ? this.rateLimitedUntil : null,
      nextTaskAt: this.nextTaskAt > now ? this.nextTaskAt : null,
      rejectedEnqueueCount: this.rejectedEnqueueCount,
      maxQueueSize: this.config.maxQueueSize,
    };
  }

  getDagStats(): DagStats {
    return this.dag.getStats();
  }

  private getNextTask(): T | null {
    const pendingTasks = this.queue.filter((t) => t.status === 'pending');
    if (pendingTasks.length === 0) return null;

    if (!this.dag.hasDependencies()) {
      return pendingTasks[0];
    }

    const dagCandidates: DagCapableTask[] = pendingTasks.map((t) => ({
      id: this.getTaskId(t),
      priority: t.priority,
      dependsOn: t.dependsOn,
    }));
    const next = this.dag.getNextExecutable(dagCandidates);
    if (!next) return null;

    return pendingTasks.find((t) => this.getTaskId(t) === next.id) ?? null;
  }

  private cancelCascadedTasks(cascadedIds: DagTaskId[]): void {
    for (const id of cascadedIds) {
      const idx = this.queue.findIndex(
        (t) => t.status === 'pending' && this.getTaskId(t) === id,
      );
      if (idx >= 0) {
        this.queue[idx].status = 'cancelled';
        this.queue.splice(idx, 1);
        this.logger.info(
          logT('log.orchestratorBase.taskDependencyFailed', { name: this.config.name, id }),
        );
      }
    }
  }

  private startProcessingLoop(): void {
    if (this.abortController) return;

    this.abortController = new AbortController();
    this.processQueue(this.abortController.signal).catch((err) => {
      this.logger.errorT('log.orchestratorBase.processingLoopError', { name: this.config.name }, { error: err });
    });
  }

  private async processQueue(signal: AbortSignal): Promise<void> {
    while (this.running && !signal.aborted) {
      if (this.paused) {
        await sleep(2000);
        continue;
      }

      const now = Date.now();
      if (this.rateLimitedUntil > now) {
        const waitMs = this.rateLimitedUntil - now;
        this.logger.info(
          logT('log.orchestratorBase.rateLimitWaiting', {
            name: this.config.name,
            waitMs: Math.ceil(waitMs / 1000),
          }),
        );
        await sleep(Math.min(waitMs, 5000));
        continue;
      }

      const task = this.getNextTask();
      if (!task) {
        this.abortController = null;
        this.logger.info(
          logT('log.orchestratorBase.queueSummary', {
            name: this.config.name,
            total: this.processedCount,
            success: this.succeededCount,
            failed: this.failedCount,
          }),
        );

        this.emitQueueEmpty();
        this.emitStatus();
        return;
      }

      await this.executeTask(task, signal);

      if (this.running && !signal.aborted && !this.paused) {
        await this.scheduler.waitIfNeeded(() => this.running && !signal.aborted && !this.paused);
      }
    }

    this.abortController = null;
  }

  private async executeTask(task: T, signal: AbortSignal): Promise<void> {
    task.status = 'processing';
    task.startedAt = Date.now();
    this.currentTask = task;

    this.logger.info(
      logT('log.orchestratorBase.startProcessing', {
        name: this.config.name,
        taskId: this.getTaskId(task),
        count: this.processedCount + 1,
      }),
    );

    this.emitTaskStarted(task);
    this.emitStatus();

    try {
      const success = await this.processTask(task);
      task.completedAt = Date.now();

      if (success) {
        task.status = 'completed';
        this.succeededCount++;
        this.dag.markCompleted(this.getTaskId(task));
        this.logger.info(
          logT('log.orchestratorBase.taskSuccess', {
            name: this.config.name,
            taskId: this.getTaskId(task),
          }),
        );
        this.emitTaskCompleted(task);
      } else {
        const errorMsg = task.error || logT('log.orchestratorBase.taskFailedDefault');
        if (this.isRateLimitError(errorMsg)) {
          await this.handleRateLimit(task);
          return;
        }

        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          task.status = 'pending';
          const retryDelay = randomDelay(this.config.retryDelayMin, this.config.retryDelayMax);
          this.logger.info(
            logT('log.orchestratorBase.taskFailedRetry', {
              name: this.config.name,
              retryCount: task.retryCount,
              taskId: this.getTaskId(task),
              waitSec: (retryDelay / 1000).toFixed(0),
            }),
          );
          this.emitTaskFailed(task, errorMsg, true);
          this.nextTaskAt = Date.now() + retryDelay;
          await this.scheduler.interruptibleSleep(retryDelay, () => this.running && !signal.aborted && !this.paused);
          return;
        }

        task.status = 'failed';
        this.failedCount++;
        const cascaded = this.dag.markFailed(this.getTaskId(task));
        this.cancelCascadedTasks(cascaded);
        this.logger.error(
          logT('log.orchestratorBase.taskFailedExhausted', {
            name: this.config.name,
            taskId: this.getTaskId(task),
            errorMsg,
          }),
        );
        this.emitTaskFailed(task, errorMsg, false);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      task.error = errorMsg;
      task.completedAt = Date.now();

      if (this.isRateLimitError(errorMsg)) {
        await this.handleRateLimit(task);
        return;
      }

      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = 'pending';
        task.error = undefined;
        const retryDelay = randomDelay(this.config.retryDelayMin, this.config.retryDelayMax);
        this.logger.info(
          logT('log.orchestratorBase.taskExceptionRetry', {
            name: this.config.name,
            retryCount: task.retryCount,
            taskId: this.getTaskId(task),
            waitSec: (retryDelay / 1000).toFixed(0),
          }),
        );
        this.emitTaskFailed(task, errorMsg, true);
        this.nextTaskAt = Date.now() + retryDelay;
        await this.scheduler.interruptibleSleep(retryDelay, () => this.running && !signal.aborted && !this.paused);
        return;
      }

      task.status = 'failed';
      this.failedCount++;
      const cascaded = this.dag.markFailed(this.getTaskId(task));
      this.cancelCascadedTasks(cascaded);
      this.logger.error(
        logT('log.orchestratorBase.taskExceptionExhausted', {
          name: this.config.name,
          taskId: this.getTaskId(task),
          errorMsg,
        }),
      );
      this.emitTaskFailed(task, errorMsg, false);
    } finally {
      if ((task.status as string) !== 'rate_limited') {
        this.processedCount++;
      }
      this.currentTask = null;

      const idx = this.queue.indexOf(task);
      if (idx >= 0) {
        if (task.status === 'completed' || task.status === 'failed') {
          this.queue.splice(idx, 1);
          this.dag.removeTask(this.getTaskId(task));
          this.history.push({ ...task });
          if (this.history.length > this.config.historyLimit) {
            this.history.shift();
          }
        }
      }

      this.emitStatus();
    }
  }

  private async handleRateLimit(task: T): Promise<void> {
    const cooldownMs = randomDelay(
      this.config.rateLimitCooldownMin,
      this.config.rateLimitCooldownMax,
    );
    this.rateLimitedUntil = Date.now() + cooldownMs;
    task.status = 'rate_limited';
    task.error = logT('log.orchestratorBase.ipRateLimited');

    this.logger.warn(
      logT('log.orchestratorBase.rateLimitTriggered', {
        name: this.config.name,
        id: this.getTaskId(task),
        minutes: Math.ceil(cooldownMs / 60_000),
      }),
    );

    this.emitRateLimited(task, cooldownMs);
    this.emitCooldown(logT('log.orchestratorBase.ipRateLimited'), cooldownMs);

    await this.scheduler.interruptibleSleep(cooldownMs, () => this.running && !this.paused);
    this.rateLimitedUntil = 0;

    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      task.status = 'pending';
      task.error = undefined;
      this.logger.info(
        logT('log.orchestratorBase.cooldownResumeRequeue', {
          name: this.config.name,
          id: this.getTaskId(task),
          retryCount: task.retryCount,
        }),
      );
    } else {
      task.status = 'failed';
      task.error = logT('log.orchestratorBase.ipRateLimitExhausted');
      this.failedCount++;
      this.logger.error(
        logT('log.orchestratorBase.cooldownEndExhausted', {
          name: this.config.name,
          id: this.getTaskId(task),
        }),
      );
    }
  }

  protected isRateLimitError(errorMsg: string): boolean {
    if (this.config.rateLimitKeywords.length === 0) return false;
    const lower = errorMsg.toLowerCase();
    return this.config.rateLimitKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  protected static createSingleton<T extends OrchestratorBase<BaseTask>>(
    key: string,
    factory: () => T,
  ): T {
    return getOrCreateGlobal(key, factory);
  }
}


export { eventBus };
