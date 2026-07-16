import { eventBus } from './event-bus';
import { getOrCreateGlobal } from './global-singleton';
import { sleep, randomDelay } from './anti-crawler';
import { SchedulerStrategy, type SchedulerStrategyOptions } from './scheduler-strategy';
import { DagManager, type DagTaskId, type DagCapableTask, type DagStats } from './dag-manager';


/** 任务基础接口 — 所有编排器任务类型必须满足此接口 */
export interface BaseTask {
  status: BaseTaskStatus;
  /** 入队时间戳 */
  enqueuedAt: number;
  /** 开始处理时间戳 */
  startedAt?: number;
  /** 完成时间戳 */
  completedAt?: number;
  /** 错误信息 */
  error?: string;
  /** 已重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 调度优先级，数值越大优先级越高，同就绪任务中先执行 */
  priority?: number;
  /** 前置依赖任务 ID 列表，所有依赖完成后才可调度 */
  dependsOn?: DagTaskId[];
}

export type BaseTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'cancelled';

/** 编排器配置 */
export interface OrchestratorConfig {
  /** 编排器名称（用于日志和全局键） */
  name: string;
  /** 全局单例键名 */
  globalKey: string;
  /** 默认最大重试次数 */
  defaultMaxRetries?: number;
  /** 调度策略配置 */
  schedulerOptions?: SchedulerStrategyOptions;
  /** 限速关键词（错误信息中包含这些词时触发冷却） */
  rateLimitKeywords?: string[];
  /** 限速冷却最小毫秒 */
  rateLimitCooldownMin?: number;
  /** 限速冷却最大毫秒 */
  rateLimitCooldownMax?: number;
  /** 重试间隔最小毫秒 */
  retryDelayMin?: number;
  /** 重试间隔最大毫秒 */
  retryDelayMax?: number;
  /** 历史记录最大保留条数 */
  historyLimit?: number;
}

/** 编排器状态 */
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
}


export abstract class OrchestratorBase<T extends BaseTask> {
  /** 任务队列 */
  protected queue: T[] = [];
  /** 当前正在处理的任务 */
  protected currentTask: T | null = null;
  /** 历史已完成任务记录 */
  protected history: T[] = [];
  /** 已处理任务总数 */
  protected processedCount = 0;
  /** 成功任务数 */
  protected succeededCount = 0;
  /** 失败任务数 */
  protected failedCount = 0;
  /** 是否正在运行 */
  protected running = false;
  /** 是否暂停 */
  protected paused = false;
  /** 限速冷却结束时间戳 */
  protected rateLimitedUntil = 0;
  /** 下一个任务预计开始时间戳 */
  protected nextTaskAt = 0;
  /** 处理循环的 AbortController */
  protected abortController: AbortController | null = null;
  /** DAG 依赖管理器，追踪任务间前置依赖与级联状态 */
  protected dag = new DagManager<DagCapableTask>();

  /** 配置 */
  protected readonly config: Required<OrchestratorConfig>;
  /** 调度策略 */
  protected readonly scheduler: SchedulerStrategy;

  constructor(config: OrchestratorConfig) {
    // 填充默认值
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

  // ─── 抽象方法 — 子类必须实现 ───

  /** 处理单个任务，返回是否成功 */
  protected abstract processTask(task: T): Promise<boolean>;

  /** 获取任务唯一标识 */
  protected abstract getTaskId(task: T): string | number;

  /** 判断两个任务是否为同一任务（用于去重） */
  protected abstract isSameTask(a: T, b: T): boolean;

  /** 发射任务入队事件 */
  protected abstract emitTaskQueued(task: T, position: number): void;

  /** 发射任务开始事件 */
  protected abstract emitTaskStarted(task: T): void;

  /** 发射任务完成事件 */
  protected abstract emitTaskCompleted(task: T): void;

  /** 发射任务失败事件 */
  protected abstract emitTaskFailed(task: T, error: string, willRetry: boolean): void;

  /** 发射限速事件 */
  protected abstract emitRateLimited(task: T, cooldownMs: number): void;

  /** 发射冷却/休息事件 */
  protected abstract emitCooldown(reason: string, durationMs: number): void;

  /** 发射队列空事件 */
  protected abstract emitQueueEmpty(): void;

  /** 发射编排器状态事件 */
  protected abstract emitStatus(): void;

  // ─── 公共方法 ───

  /**
   * 将任务加入队列
   *
   * 如果队列中已存在相同任务（由 isSameTask 判断），则跳过。
   *
   * @returns 队列位置（从 1 开始），0 表示已存在
   */
  enqueue(task: T): number {
    // 检查是否已在队列中
    const existing = this.queue.find(
      (t) => t.status === 'pending' && this.isSameTask(t, task),
    );
    if (existing) {
      return this.queue.indexOf(existing) + 1;
    }

    // 检查当前正在处理的任务
    if (this.currentTask && this.isSameTask(this.currentTask, task)) {
      return 0;
    }

    this.queue.push(task);
    this.dag.addTask({
      id: this.getTaskId(task),
      priority: task.priority,
      dependsOn: task.dependsOn,
    });
    const position = this.queue.length;

    this.emitTaskQueued(task, position);

    console.log(
      `[${this.config.name}] 任务入队: ID=${this.getTaskId(task)}, 位置 ${position}`,
    );

    // 如果编排器正在运行但处理循环已退出（队列为空时），重新启动
    if (this.running && !this.paused && !this.abortController) {
      this.startProcessingLoop();
    }

    return position;
  }

  /**
   * 声明任务间依赖关系
   *
   * 被依赖的任务完成后，依赖任务才可被调度。
   * 添加依赖后自动执行循环检测，存在环路时抛出 DagCycleError。
   */
  declareDependency(taskId: DagTaskId, dependsOnId: DagTaskId): void {
    this.dag.addDependency(taskId, dependsOnId);
    this.dag.detectCycles();
  }

  /**
   * 启动编排器
   *
   * 设置 running=true，如果有待处理任务则启动处理循环。
   * 幂等：重复调用安全。
   */
  start(): void {
    if (this.running) {
      console.log(`[${this.config.name}] 已在运行中，跳过`);
      return;
    }

    this.running = true;
    this.paused = false;
    console.log(`[${this.config.name}] 编排器已启动`);

    this.emitStatus();

    if (this.queue.length > 0) {
      this.startProcessingLoop();
    }
  }

  /** 停止编排器，等待当前任务完成后退出 */
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.abortController?.abort();
    console.log(`[${this.config.name}] 编排器停止中...`);

    if (this.currentTask) {
      console.log(
        `[${this.config.name}] 等待当前任务 #${this.getTaskId(this.currentTask)} 完成...`,
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
    console.log(`[${this.config.name}] 编排器已停止`);
  }

  /** 暂停编排器 */
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    console.log(`[${this.config.name}] 编排器已暂停`);
    this.emitStatus();
  }

  /** 恢复编排器 */
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    console.log(`[${this.config.name}] 编排器已恢复`);
    this.emitStatus();

    if (this.queue.length > 0 && !this.abortController) {
      this.startProcessingLoop();
    }
  }

  /**
   * 从队列中移除指定任务
   *
   * @param id - 任务标识
   * @returns 是否成功移除
   */
  cancel(id: string | number): boolean {
    const idx = this.queue.findIndex(
      (t) => t.status === 'pending' && this.getTaskId(t) === id,
    );
    if (idx >= 0) {
      this.queue[idx].status = 'cancelled';
      this.queue.splice(idx, 1);
      console.log(`[${this.config.name}] 任务已取消: ID=${id}`);
      return true;
    }
    return false;
  }

  /** 清空队列 */
  clearQueue(): number {
    const count = this.queue.filter((t) => t.status === 'pending').length;
    this.queue = [];
    console.log(`[${this.config.name}] 队列已清空（移除 ${count} 个待处理任务）`);
    return count;
  }

  /** 获取历史记录 */
  getHistory(limit: number = 20): T[] {
    return this.history.slice(-limit).reverse();
  }

  /** 获取编排器基础状态 */
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
    };
  }

  /** 获取 DAG 依赖管理器统计数据 */
  getDagStats(): DagStats {
    return this.dag.getStats();
  }

  // ─── 内部方法 ───

  /**
   * 从队列中选出下一个可执行任务
   *
   * 无依赖关系时退化为 FIFO；有依赖时通过 DAG 选出
   * 依赖就绪且优先级最高的任务。
   */
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

  /**
   * 取消因前置依赖失败而级联取消的任务
   */
  private cancelCascadedTasks(cascadedIds: DagTaskId[]): void {
    for (const id of cascadedIds) {
      const idx = this.queue.findIndex(
        (t) => t.status === 'pending' && this.getTaskId(t) === id,
      );
      if (idx >= 0) {
        this.queue[idx].status = 'cancelled';
        this.queue.splice(idx, 1);
        console.log(
          `[${this.config.name}] 任务因依赖失败而级联取消: ID=${id}`,
        );
      }
    }
  }

  /**
   * 启动处理循环
   */
  private startProcessingLoop(): void {
    if (this.abortController) return;

    this.abortController = new AbortController();
    this.processQueue(this.abortController.signal).catch((err) => {
      console.error(`[${this.config.name}] 处理循环异常:`, err);
    });
  }

  /**
   * 处理队列主循环
   */
  private async processQueue(signal: AbortSignal): Promise<void> {
    while (this.running && !signal.aborted) {
      // 暂停时等待恢复
      if (this.paused) {
        await sleep(2000);
        continue;
      }

      // 限速冷却期
      const now = Date.now();
      if (this.rateLimitedUntil > now) {
        const waitMs = this.rateLimitedUntil - now;
        console.log(
          `[${this.config.name}] 限速冷却中，等待 ${Math.ceil(waitMs / 1000)}s...`,
        );
        await sleep(Math.min(waitMs, 5000));
        continue;
      }

      // 取出下一个待处理任务（DAG 感知调度）
      const task = this.getNextTask();
      if (!task) {
        this.abortController = null;
        console.log(
          `[${this.config.name}] 队列已空（共处理 ${this.processedCount} 个任务，成功 ${this.succeededCount}，失败 ${this.failedCount}）`,
        );

        this.emitQueueEmpty();
        this.emitStatus();
        return;
      }

      await this.executeTask(task, signal);

      // 任务处理完成后，检查是否需要休息
      if (this.running && !signal.aborted && !this.paused) {
        await this.scheduler.waitIfNeeded(() => this.running && !signal.aborted && !this.paused);
      }
    }

    this.abortController = null;
  }

  /**
   * 执行单个任务（含重试和限速处理）
   */
  private async executeTask(task: T, signal: AbortSignal): Promise<void> {
    task.status = 'processing';
    task.startedAt = Date.now();
    this.currentTask = task;

    console.log(
      `[${this.config.name}] 开始处理: ID=${this.getTaskId(task)} (第 ${this.processedCount + 1} 个任务)`,
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
        console.log(`[${this.config.name}] 任务成功: ID=${this.getTaskId(task)}`);
        this.emitTaskCompleted(task);
      } else {
        const errorMsg = task.error || '任务失败';
        if (this.isRateLimitError(errorMsg)) {
          await this.handleRateLimit(task);
          return;
        }

        // 检查是否需要重试
        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          task.status = 'pending';
          const retryDelay = randomDelay(this.config.retryDelayMin, this.config.retryDelayMax);
          console.log(
            `[${this.config.name}] 任务失败，将重试（第 ${task.retryCount} 次）: ID=${this.getTaskId(task)}, 等待 ${(retryDelay / 1000).toFixed(0)}s`,
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
        console.error(`[${this.config.name}] 任务失败（已耗尽重试）: ID=${this.getTaskId(task)}: ${errorMsg}`);
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
        console.log(
          `[${this.config.name}] 任务异常，将重试（第 ${task.retryCount} 次）: ID=${this.getTaskId(task)}, 等待 ${(retryDelay / 1000).toFixed(0)}s`,
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
      console.error(`[${this.config.name}] 任务异常（已耗尽重试）: ID=${this.getTaskId(task)}: ${errorMsg}`);
      this.emitTaskFailed(task, errorMsg, false);
    } finally {
      if ((task.status as string) !== 'rate_limited') {
        this.processedCount++;
      }
      this.currentTask = null;

      // 从队列中移除已完成或已失败的任务，并清理 DAG 状态
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

  /**
   * 处理限速
   */
  private async handleRateLimit(task: T): Promise<void> {
    const cooldownMs = randomDelay(
      this.config.rateLimitCooldownMin,
      this.config.rateLimitCooldownMax,
    );
    this.rateLimitedUntil = Date.now() + cooldownMs;
    task.status = 'rate_limited';
    task.error = 'IP 限速';

    console.warn(
      `[${this.config.name}] 限速触发: ID=${this.getTaskId(task)}, 冷却 ${Math.ceil(cooldownMs / 60_000)} 分钟`,
    );

    this.emitRateLimited(task, cooldownMs);
    this.emitCooldown('IP 限速', cooldownMs);

    await this.scheduler.interruptibleSleep(cooldownMs, () => this.running && !this.paused);
    this.rateLimitedUntil = 0;

    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      task.status = 'pending';
      task.error = undefined;
      console.log(
        `[${this.config.name}] 冷却结束，任务重新入队: ID=${this.getTaskId(task)} (重试第 ${task.retryCount} 次)`,
      );
    } else {
      task.status = 'failed';
      task.error = 'IP 限速（已耗尽重试）';
      this.failedCount++;
      console.error(`[${this.config.name}] 冷却结束但已耗尽重试: ID=${this.getTaskId(task)}`);
    }
  }

  /**
   * 检测错误信息是否表示限速
   * 子类可覆盖此方法实现自定义检测逻辑。
   */
  protected isRateLimitError(errorMsg: string): boolean {
    if (this.config.rateLimitKeywords.length === 0) return false;
    const lower = errorMsg.toLowerCase();
    return this.config.rateLimitKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  // ─── HMR 安全单例辅助 ───

  /**
   * 创建 HMR 安全的全局单例
   *
   * 子类可使用此方法实现自己的 getOrchestrator() 函数。
   */
  protected static createSingleton<T extends OrchestratorBase<BaseTask>>(
    key: string,
    factory: () => T,
  ): T {
    return getOrCreateGlobal(key, factory);
  }
}


export { eventBus };
