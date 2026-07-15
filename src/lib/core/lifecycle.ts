import { getOrCreateGlobal } from './global-singleton';

export type LifecyclePhase = 'booting' | 'ready' | 'draining' | 'shutdown';
export type LifecycleStatus = LifecyclePhase | 'error';

export interface LifecycleHook {
  /** 唯一标识 */
  name: string;
  /** 执行函数（启动或关闭） */
  fn: () => Promise<void>;
  /** 超时毫秒数，默认 10000 */
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
  /** 已注册的 hook 名称集合，防止重复注册 */
  private registeredInitNames = new Set<string>();
  private registeredShutdownNames = new Set<string>();

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

  /**
   * 注册启动 hook（幂等 — 同名 hook 只注册一次）。
   *
   * hook 会按注册顺序在 boot() 时依次执行。
   * 如果某个 hook 失败或超时，后续 hook 不再执行。
   *
   * HMR 场景下，模块重新加载会重新调用 onInit，
   * 通过名称去重避免重复注册。
   *
   * @param hook - 启动 hook 定义
   */
  onInit(hook: LifecycleHook): void {
    if (this.registeredInitNames.has(hook.name)) {
      return; // 幂等：已注册，跳过
    }
    this.registeredInitNames.add(hook.name);

    // 如果已经 ready（HMR 重载场景），直接执行 hook
    if (this.status === 'ready') {
      this.runWithTimeout(hook.fn(), hook.timeout ?? 10000, hook.name)
        .then(() => console.log(`[Lifecycle] ✓ ${hook.name} 完成 (HMR 热注册)`))
        .catch((err) => console.error(`[Lifecycle] ✗ ${hook.name} 失败 (HMR):`, err));
      return;
    }

    if (this.status !== 'booting') {
      console.warn(`[Lifecycle] onInit("${hook.name}") 在 ${this.status} 阶段调用，已忽略`);
      return;
    }
    this.initHooks.push(hook);
  }

  /**
   * 注册关闭 hook（幂等 — 同名 hook 只注册一次）。
   *
   * hook 会按注册的**逆序**在 shutdown() 时执行。
   * 先注册的资源最后关闭（如先关 HTTP 再关数据库）。
   *
   * @param hook - 关闭 hook 定义
   */
  onShutdown(hook: LifecycleHook): void {
    if (this.registeredShutdownNames.has(hook.name)) {
      return; // 幂等：已注册，跳过
    }
    this.registeredShutdownNames.add(hook.name);
    this.shutdownHooks.push(hook);
  }

  /**
   * 执行全部启动流程（幂等 — HMR 安全）。
   *
   * 依次执行所有 init hooks，每个 hook 有独立超时。
   * 全部成功后状态变为 ready，并绑定信号处理。
   *
   * 如果已经 ready（HMR 重载场景），不会重复执行 init hooks，
   * 只重新绑定信号处理（可能因 HMR 丢失）。
   *
   * @throws 如果任何 hook 失败或超时（仅在首次 boot 时）
   */
  async boot(): Promise<void> {
    // 幂等：如果已经 ready，跳过 init hooks，只确保信号处理已绑定
    if (this.status === 'ready') {
      this.bindSignalHandlers();
      return;
    }

    if (this.status !== 'booting') {
      throw new Error(`[Lifecycle] 无法在 ${this.status} 阶段执行 boot`);
    }

    console.log(`[Lifecycle] 开始启动流程，共 ${this.initHooks.length} 个 init hook`);

    for (const hook of this.initHooks) {
      const timeout = hook.timeout ?? 10000;
      console.log(`[Lifecycle] 执行 init hook: ${hook.name} (timeout: ${timeout}ms)`);

      try {
        await this.runWithTimeout(hook.fn(), timeout, hook.name);
        console.log(`[Lifecycle] ✓ ${hook.name} 完成`);
      } catch (err) {
        this.status = 'error';
        this.lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[Lifecycle] ✗ ${hook.name} 失败:`, this.lastError.message);
        throw this.lastError;
      }
    }

    this.status = 'ready';
    this.startedAt = Date.now();
    this.bindSignalHandlers();
    console.log(`[Lifecycle] 🚀 应用已就绪 (uptime 计时开始)`);
  }

  /**
   * 执行优雅关闭流程。
   *
   - 状态变为 draining，拒绝新的请求
   - 按逆序执行 shutdown hooks
   - 状态变为 shutdown
   - 进程退出
   *
   * @param exitCode - 进程退出码，默认 0
   */
  async shutdown(exitCode: number = 0): Promise<void> {
    if (this.shuttingDown) {
      console.log('[Lifecycle] 关闭流程已在进行中，跳过重复调用');
      return;
    }

    this.shuttingDown = true;
    this.status = 'draining';
    console.log(`[Lifecycle] 开始优雅关闭，共 ${this.shutdownHooks.length} 个 shutdown hook`);

    // 按逆序执行关闭 hooks
    const reversed = [...this.shutdownHooks].reverse();
    for (const hook of reversed) {
      const timeout = hook.timeout ?? 10000;
      console.log(`[Lifecycle] 执行 shutdown hook: ${hook.name} (timeout: ${timeout}ms)`);

      try {
        await this.runWithTimeout(hook.fn(), timeout, hook.name);
        console.log(`[Lifecycle] ✓ ${hook.name} 完成`);
      } catch (err) {
        // 关闭过程中单个 hook 失败不中断后续 hook
        console.error(
          `[Lifecycle] ✗ ${hook.name} 失败:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    this.status = 'shutdown';
    console.log('[Lifecycle] 优雅关闭完成，退出进程');
    process.exit(exitCode);
  }

  /**
   * 获取生命周期状态摘要（供健康检查 API 使用）。
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
        reject(new Error(`Hook "${name}" 超时 (${ms}ms)`));
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

    const handler = (signal: string): void => {
      console.log(`\n[Lifecycle] 收到 ${signal} 信号，开始优雅关闭...`);
      this.shutdown(0).catch((err) => {
        console.error('[Lifecycle] 优雅关闭失败:', err);
        process.exit(1);
      });
    };

    process.on('SIGINT', () => handler('SIGINT'));
    process.on('SIGTERM', () => handler('SIGTERM'));

    // 未捕获异常 — 记录后继续运行（不退出）
    process.on('uncaughtException', (err) => {
      console.error('[Lifecycle] uncaughtException:', err.message);
      this.lastError = err;
    });

    // 未处理的 Promise 拒绝
    process.on('unhandledRejection', (reason) => {
      console.error('[Lifecycle] unhandledRejection:', reason);
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
 * HMR 安全的全局单例导出。
 *
 * 使用 globalThis 存储实例，确保 HMR 热重载时不会重新创建 LifecycleManager，
 * 从而保留已注册的 init/shutdown hooks、已绑定的信号处理和当前状态。
 */
export const lifecycle = getOrCreateGlobal('__puchipix_lifecycle__', () => new LifecycleManager());
