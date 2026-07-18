import { eventBus } from '../infra/event-bus';
import { getOrCreateGlobal } from '../infra/global-singleton';
import { sleep, randomDelay } from '../stealth/anti-crawler';
import { SchedulerStrategy, type SchedulerStrategyOptions } from './scheduler-strategy';
import { DagManager, type DagTaskId, type DagCapableTask, type DagStats } from './dag-manager';


/** 浠诲姟鍩虹鎺ュ彛 */
export interface BaseTask {
  status: BaseTaskStatus;
  /** 鍏ラ槦鏃堕棿鎴?*/
  enqueuedAt: number;
  /** 寮€濮嬪鐞嗘椂闂存埑 */
  startedAt?: number;
  /** 瀹屾垚鏃堕棿鎴?*/
  completedAt?: number;
  /** 閿欒淇℃伅 */
  error?: string;
  /** 宸查噸璇曟鏁?*/
  retryCount: number;
  /** 鏈€澶ч噸璇曟鏁?*/
  maxRetries: number;
  /** 璋冨害浼樺厛绾э紝鏁板€艰秺澶т紭鍏堢骇瓒婇珮锛屽悓灏辩华浠诲姟涓厛鎵ц */
  priority?: number;
  /** 鍓嶇疆渚濊禆浠诲姟 ID 鍒楄〃锛屾墍鏈変緷璧栧畬鎴愬悗鎵嶅彲璋冨害 */
  dependsOn?: DagTaskId[];
}

export type BaseTaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'rate_limited'
  | 'cancelled';

/** 缂栨帓鍣ㄩ厤缃?*/
export interface OrchestratorConfig {
  /** 缂栨帓鍣ㄥ悕绉帮紙鐢ㄤ簬鏃ュ織鍜屽叏灞€閿級 */
  name: string;
  /** 鍏ㄥ眬鍗曚緥閿悕 */
  globalKey: string;
  /** 榛樿鏈€澶ч噸璇曟鏁?*/
  defaultMaxRetries?: number;
  /** 璋冨害绛栫暐閰嶇疆 */
  schedulerOptions?: SchedulerStrategyOptions;
  /** 闄愰€熷叧閿瘝锛堥敊璇俊鎭腑鍖呭惈杩欎簺璇嶆椂瑙﹀彂鍐峰嵈锛?*/
  rateLimitKeywords?: string[];
  /** 闄愰€熷喎鍗存渶灏忔绉?*/
  rateLimitCooldownMin?: number;
  /** 闄愰€熷喎鍗存渶澶ф绉?*/
  rateLimitCooldownMax?: number;
  /** 閲嶈瘯闂撮殧鏈€灏忔绉?*/
  retryDelayMin?: number;
  /** 閲嶈瘯闂撮殧鏈€澶ф绉?*/
  retryDelayMax?: number;
  /** 鍘嗗彶璁板綍鏈€澶т繚鐣欐潯鏁?*/
  historyLimit?: number;
  /** 闃熷垪鏈€澶ч暱搴︼紙鑳屽帇闃堝€硷紝瓒呰繃鏃舵嫆缁濆叆闃燂級 */
  maxQueueSize?: number;
}

/** 缂栨帓鍣ㄧ姸鎬?*/
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
  /** 鍥犻槦鍒楀凡婊¤€岃鎷掔粷鍏ラ槦鐨勬鏁?*/
  rejectedEnqueueCount: number;
  /** 闃熷垪鏈€澶ч暱搴?*/
  maxQueueSize: number;
}


export abstract class OrchestratorBase<T extends BaseTask> {
  /** 浠诲姟闃熷垪 */
  protected queue: T[] = [];
  /** 褰撳墠姝ｅ湪澶勭悊鐨勪换鍔?*/
  protected currentTask: T | null = null;
  /** 鍘嗗彶宸插畬鎴愪换鍔¤褰?*/
  protected history: T[] = [];
  /** 宸插鐞嗕换鍔℃€绘暟 */
  protected processedCount = 0;
  /** 鎴愬姛浠诲姟鏁?*/
  protected succeededCount = 0;
  /** 澶辫触浠诲姟鏁?*/
  protected failedCount = 0;
  /** 鏄惁姝ｅ湪杩愯 */
  protected running = false;
  /** 鏄惁鏆傚仠 */
  protected paused = false;
  /** 闄愰€熷喎鍗寸粨鏉熸椂闂存埑 */
  protected rateLimitedUntil = 0;
  /** 涓嬩竴涓换鍔￠璁″紑濮嬫椂闂存埑 */
  protected nextTaskAt = 0;
  /** 澶勭悊寰幆鐨?AbortController */
  protected abortController: AbortController | null = null;
  /** DAG 渚濊禆绠＄悊鍣紝杩借釜浠诲姟闂村墠缃緷璧栦笌绾ц仈鐘舵€?*/
  protected dag = new DagManager<DagCapableTask>();
  /** 闃熷垪宸叉弧鏃舵嫆缁濈殑鍏ラ槦娆℃暟锛堢敤浜庣洃鎺ц儗鍘嬭Е鍙戦鐜囷級 */
  protected rejectedEnqueueCount = 0;

  /** 閰嶇疆 */
  protected readonly config: Required<OrchestratorConfig>;
  /** 璋冨害绛栫暐 */
  protected readonly scheduler: SchedulerStrategy;

  constructor(config: OrchestratorConfig) {
    // 濉厖榛樿鍊?
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

  // 鈹€鈹€鈹€ 鎶借薄鏂规硶 鈥?瀛愮被蹇呴』瀹炵幇 鈹€鈹€鈹€

  /** 澶勭悊鍗曚釜浠诲姟锛岃繑鍥炴槸鍚︽垚鍔?*/
  protected abstract processTask(task: T): Promise<boolean>;

  /** 鑾峰彇浠诲姟鍞竴鏍囪瘑 */
  protected abstract getTaskId(task: T): string | number;

  /** 鍒ゆ柇涓や釜浠诲姟鏄惁涓哄悓涓€浠诲姟锛堢敤浜庡幓閲嶏級 */
  protected abstract isSameTask(a: T, b: T): boolean;

  /** 鍙戝皠浠诲姟鍏ラ槦浜嬩欢 */
  protected abstract emitTaskQueued(task: T, position: number): void;

  /** 鍙戝皠浠诲姟寮€濮嬩簨浠?*/
  protected abstract emitTaskStarted(task: T): void;

  /** 鍙戝皠浠诲姟瀹屾垚浜嬩欢 */
  protected abstract emitTaskCompleted(task: T): void;

  /** 鍙戝皠浠诲姟澶辫触浜嬩欢 */
  protected abstract emitTaskFailed(task: T, error: string, willRetry: boolean): void;

  /** 鍙戝皠闄愰€熶簨浠?*/
  protected abstract emitRateLimited(task: T, cooldownMs: number): void;

  /** 鍙戝皠鍐峰嵈/浼戞伅浜嬩欢 */
  protected abstract emitCooldown(reason: string, durationMs: number): void;

  /** 鍙戝皠闃熷垪绌轰簨浠?*/
  protected abstract emitQueueEmpty(): void;

  /** 鍙戝皠缂栨帓鍣ㄧ姸鎬佷簨浠?*/
  protected abstract emitStatus(): void;

  // 鈹€鈹€鈹€ 鍏叡鏂规硶 鈹€鈹€鈹€

  /**
   * 灏嗕换鍔″姞鍏ラ槦鍒?
   *
   * 濡傛灉闃熷垪涓凡瀛樺湪鐩稿悓浠诲姟锛堢敱 isSameTask 鍒ゆ柇锛夛紝鍒欒烦杩囥€?
   * 濡傛灉闃熷垪宸叉弧锛堣秴杩?maxQueueSize锛夛紝鎷掔粷鍏ラ槦浠ュ疄鐜拌儗鍘嬨€?
   *
   * @returns 闃熷垪浣嶇疆锛堜粠 1 寮€濮嬶級锛? 琛ㄧず宸插瓨鍦紝-1 琛ㄧず闃熷垪宸叉弧锛堣儗鍘嬫嫆缁濓級
   */
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
      console.warn(
        `[${this.config.name}] 闃熷垪宸叉弧锛?{pendingCount}/${this.config.maxQueueSize}锛夛紝鎷掔粷鍏ラ槦: ID=${this.getTaskId(task)}锛堢疮璁℃嫆缁?${this.rejectedEnqueueCount} 娆★級`,
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

    console.log(
      `[${this.config.name}] 浠诲姟鍏ラ槦: ID=${this.getTaskId(task)}, 浣嶇疆 ${position}锛堥槦鍒?${pendingCount + 1}/${this.config.maxQueueSize}锛塦,
    );

    // 濡傛灉缂栨帓鍣ㄦ鍦ㄨ繍琛屼絾澶勭悊寰幆宸查€€鍑猴紙闃熷垪涓虹┖鏃讹級锛岄噸鏂板惎鍔?
    if (this.running && !this.paused && !this.abortController) {
      this.startProcessingLoop();
    }

    return position;
  }

  /**
   * 澹版槑浠诲姟闂翠緷璧栧叧绯?
   *
   * 琚緷璧栫殑浠诲姟瀹屾垚鍚庯紝渚濊禆浠诲姟鎵嶅彲琚皟搴︺€?
   * 娣诲姞渚濊禆鍚庤嚜鍔ㄦ墽琛屽惊鐜娴嬶紝瀛樺湪鐜矾鏃舵姏鍑?DagCycleError銆?
   */
  declareDependency(taskId: DagTaskId, dependsOnId: DagTaskId): void {
    this.dag.addDependency(taskId, dependsOnId);
    this.dag.detectCycles();
  }

  /**
   * 鍚姩缂栨帓鍣?
   *
   * 璁剧疆 running=true锛屽鏋滄湁寰呭鐞嗕换鍔″垯鍚姩澶勭悊寰幆銆?
   * 骞傜瓑锛氶噸澶嶈皟鐢ㄥ畨鍏ㄣ€?
   */
  start(): void {
    if (this.running) {
      console.log(`[${this.config.name}] 宸插湪杩愯涓紝璺宠繃`);
      return;
    }

    this.running = true;
    this.paused = false;
    console.log(`[${this.config.name}] 缂栨帓鍣ㄥ凡鍚姩`);

    this.emitStatus();

    if (this.queue.length > 0) {
      this.startProcessingLoop();
    }
  }

  /** 鍋滄缂栨帓鍣紝绛夊緟褰撳墠浠诲姟瀹屾垚鍚庨€€鍑?*/
  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    this.abortController?.abort();
    console.log(`[${this.config.name}] 缂栨帓鍣ㄥ仠姝腑...`);

    if (this.currentTask) {
      console.log(
        `[${this.config.name}] 绛夊緟褰撳墠浠诲姟 #${this.getTaskId(this.currentTask)} 瀹屾垚...`,
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
    console.log(`[${this.config.name}] 缂栨帓鍣ㄥ凡鍋滄`);
  }

  /** 鏆傚仠缂栨帓鍣?*/
  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    console.log(`[${this.config.name}] 缂栨帓鍣ㄥ凡鏆傚仠`);
    this.emitStatus();
  }

  /** 鎭㈠缂栨帓鍣?*/
  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    console.log(`[${this.config.name}] 缂栨帓鍣ㄥ凡鎭㈠`);
    this.emitStatus();

    if (this.queue.length > 0 && !this.abortController) {
      this.startProcessingLoop();
    }
  }

  /**
   * 浠庨槦鍒椾腑绉婚櫎鎸囧畾浠诲姟
   *
   * @param id - 浠诲姟鏍囪瘑
   * @returns 鏄惁鎴愬姛绉婚櫎
   */
  cancel(id: string | number): boolean {
    const idx = this.queue.findIndex(
      (t) => t.status === 'pending' && this.getTaskId(t) === id,
    );
    if (idx >= 0) {
      this.queue[idx].status = 'cancelled';
      this.queue.splice(idx, 1);
      console.log(`[${this.config.name}] 浠诲姟宸插彇娑? ID=${id}`);
      return true;
    }
    return false;
  }

  /** 娓呯┖闃熷垪 */
  clearQueue(): number {
    const count = this.queue.filter((t) => t.status === 'pending').length;
    this.queue = [];
    console.log(`[${this.config.name}] 闃熷垪宸叉竻绌猴紙绉婚櫎 ${count} 涓緟澶勭悊浠诲姟锛塦);
    return count;
  }

  /** 鑾峰彇鍘嗗彶璁板綍 */
  getHistory(limit: number = 20): T[] {
    return this.history.slice(-limit).reverse();
  }

  /** 鑾峰彇缂栨帓鍣ㄥ熀纭€鐘舵€?*/
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

  /** 鑾峰彇 DAG 渚濊禆绠＄悊鍣ㄧ粺璁℃暟鎹?*/
  getDagStats(): DagStats {
    return this.dag.getStats();
  }

  // 鈹€鈹€鈹€ 鍐呴儴鏂规硶 鈹€鈹€鈹€

  /**
   * 浠庨槦鍒椾腑閫夊嚭涓嬩竴涓彲鎵ц浠诲姟
   *
   * 鏃犱緷璧栧叧绯绘椂閫€鍖栦负 FIFO锛涙湁渚濊禆鏃堕€氳繃 DAG 閫夊嚭
   * 渚濊禆灏辩华涓斾紭鍏堢骇鏈€楂樼殑浠诲姟銆?
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
   * 鍙栨秷鍥犲墠缃緷璧栧け璐ヨ€岀骇鑱斿彇娑堢殑浠诲姟
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
          `[${this.config.name}] 浠诲姟鍥犱緷璧栧け璐ヨ€岀骇鑱斿彇娑? ID=${id}`,
        );
      }
    }
  }

  /**
   * 鍚姩澶勭悊寰幆
   */
  private startProcessingLoop(): void {
    if (this.abortController) return;

    this.abortController = new AbortController();
    this.processQueue(this.abortController.signal).catch((err) => {
      console.error(`[${this.config.name}] 澶勭悊寰幆寮傚父:`, err);
    });
  }

  /**
   * 澶勭悊闃熷垪涓诲惊鐜?
   */
  private async processQueue(signal: AbortSignal): Promise<void> {
    while (this.running && !signal.aborted) {
      // 鏆傚仠鏃剁瓑寰呮仮澶?
      if (this.paused) {
        await sleep(2000);
        continue;
      }

      // 闄愰€熷喎鍗存湡
      const now = Date.now();
      if (this.rateLimitedUntil > now) {
        const waitMs = this.rateLimitedUntil - now;
        console.log(
          `[${this.config.name}] 闄愰€熷喎鍗翠腑锛岀瓑寰?${Math.ceil(waitMs / 1000)}s...`,
        );
        await sleep(Math.min(waitMs, 5000));
        continue;
      }

      // 鍙栧嚭涓嬩竴涓緟澶勭悊浠诲姟锛圖AG 鎰熺煡璋冨害锛?
      const task = this.getNextTask();
      if (!task) {
        this.abortController = null;
        console.log(
          `[${this.config.name}] 闃熷垪宸茬┖锛堝叡澶勭悊 ${this.processedCount} 涓换鍔★紝鎴愬姛 ${this.succeededCount}锛屽け璐?${this.failedCount}锛塦,
        );

        this.emitQueueEmpty();
        this.emitStatus();
        return;
      }

      await this.executeTask(task, signal);

      // 浠诲姟澶勭悊瀹屾垚鍚庯紝妫€鏌ユ槸鍚﹂渶瑕佷紤鎭?
      if (this.running && !signal.aborted && !this.paused) {
        await this.scheduler.waitIfNeeded(() => this.running && !signal.aborted && !this.paused);
      }
    }

    this.abortController = null;
  }

  /**
   * 鎵ц鍗曚釜浠诲姟锛堝惈閲嶈瘯鍜岄檺閫熷鐞嗭級
   */
  private async executeTask(task: T, signal: AbortSignal): Promise<void> {
    task.status = 'processing';
    task.startedAt = Date.now();
    this.currentTask = task;

    console.log(
      `[${this.config.name}] 寮€濮嬪鐞? ID=${this.getTaskId(task)} (绗?${this.processedCount + 1} 涓换鍔?`,
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
        console.log(`[${this.config.name}] 浠诲姟鎴愬姛: ID=${this.getTaskId(task)}`);
        this.emitTaskCompleted(task);
      } else {
        const errorMsg = task.error || '浠诲姟澶辫触';
        if (this.isRateLimitError(errorMsg)) {
          await this.handleRateLimit(task);
          return;
        }

        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          task.status = 'pending';
          const retryDelay = randomDelay(this.config.retryDelayMin, this.config.retryDelayMax);
          console.log(
            `[${this.config.name}] 浠诲姟澶辫触锛屽皢閲嶈瘯锛堢 ${task.retryCount} 娆★級: ID=${this.getTaskId(task)}, 绛夊緟 ${(retryDelay / 1000).toFixed(0)}s`,
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
        console.error(`[${this.config.name}] 浠诲姟澶辫触锛堝凡鑰楀敖閲嶈瘯锛? ID=${this.getTaskId(task)}: ${errorMsg}`);
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
          `[${this.config.name}] 浠诲姟寮傚父锛屽皢閲嶈瘯锛堢 ${task.retryCount} 娆★級: ID=${this.getTaskId(task)}, 绛夊緟 ${(retryDelay / 1000).toFixed(0)}s`,
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
      console.error(`[${this.config.name}] 浠诲姟寮傚父锛堝凡鑰楀敖閲嶈瘯锛? ID=${this.getTaskId(task)}: ${errorMsg}`);
      this.emitTaskFailed(task, errorMsg, false);
    } finally {
      if ((task.status as string) !== 'rate_limited') {
        this.processedCount++;
      }
      this.currentTask = null;

      // 浠庨槦鍒椾腑绉婚櫎宸插畬鎴愭垨宸插け璐ョ殑浠诲姟锛屽苟娓呯悊 DAG 鐘舵€?
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
   * 澶勭悊闄愰€?
   */
  private async handleRateLimit(task: T): Promise<void> {
    const cooldownMs = randomDelay(
      this.config.rateLimitCooldownMin,
      this.config.rateLimitCooldownMax,
    );
    this.rateLimitedUntil = Date.now() + cooldownMs;
    task.status = 'rate_limited';
    task.error = 'IP 闄愰€?;

    console.warn(
      `[${this.config.name}] 闄愰€熻Е鍙? ID=${this.getTaskId(task)}, 鍐峰嵈 ${Math.ceil(cooldownMs / 60_000)} 鍒嗛挓`,
    );

    this.emitRateLimited(task, cooldownMs);
    this.emitCooldown('IP 闄愰€?, cooldownMs);

    await this.scheduler.interruptibleSleep(cooldownMs, () => this.running && !this.paused);
    this.rateLimitedUntil = 0;

    if (task.retryCount < task.maxRetries) {
      task.retryCount++;
      task.status = 'pending';
      task.error = undefined;
      console.log(
        `[${this.config.name}] 鍐峰嵈缁撴潫锛屼换鍔￠噸鏂板叆闃? ID=${this.getTaskId(task)} (閲嶈瘯绗?${task.retryCount} 娆?`,
      );
    } else {
      task.status = 'failed';
      task.error = 'IP 闄愰€燂紙宸茶€楀敖閲嶈瘯锛?;
      this.failedCount++;
      console.error(`[${this.config.name}] 鍐峰嵈缁撴潫浣嗗凡鑰楀敖閲嶈瘯: ID=${this.getTaskId(task)}`);
    }
  }

  /**
   * 妫€娴嬮敊璇俊鎭槸鍚﹁〃绀洪檺閫?
   * 瀛愮被鍙鐩栨鏂规硶瀹炵幇鑷畾涔夋娴嬮€昏緫銆?
   */
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
