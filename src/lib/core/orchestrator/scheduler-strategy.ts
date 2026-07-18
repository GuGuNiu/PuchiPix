import {
  sleep,
  randomDelay,
  gaussianDelay,
  BATCH_SHORT_CYCLE,
  BATCH_SHORT_REST_MIN,
  BATCH_SHORT_REST_MAX,
  BATCH_LONG_CYCLE,
  BATCH_LONG_REST_MIN,
  BATCH_LONG_REST_MAX,
  BATCH_TASK_DELAY_MIN,
  BATCH_TASK_DELAY_MAX,
} from '../stealth/anti-crawler';

export interface SchedulerStrategyOptions {
  /** 鐭懆鏈熶换鍔℃暟锛堟瘡澶勭悊 N 涓换鍔″悗鐭紤鎭級 */
  shortCycle?: number;
  /** 鐭懆鏈熶紤鎭渶灏忔绉?*/
  shortRestMin?: number;
  /** 鐭懆鏈熶紤鎭渶澶ф绉?*/
  shortRestMax?: number;
  /** 闀垮懆鏈熶换鍔℃暟 */
  longCycle?: number;
  /** 闀垮懆鏈熶紤鎭渶灏忔绉?*/
  longRestMin?: number;
  /** 闀垮懆鏈熶紤鎭渶澶ф绉?*/
  longRestMax?: number;
  /** 浠诲姟闂存渶灏忛棿闅旀绉掞紙uniform 妯″紡锛?*/
  taskDelayMin?: number;
  /** 浠诲姟闂存渶澶ч棿闅旀绉掞紙uniform 妯″紡锛?*/
  taskDelayMax?: number;
  /** 鏄惁浣跨敤楂樻柉鍒嗗竷鐢熸垚浠诲姟闂撮殧 */
  useGaussian?: boolean;
  /** 楂樻柉鍒嗗竷鍧囧€兼绉?*/
  gaussianMean?: number;
  /** 楂樻柉鍒嗗竷鏍囧噯宸绉?*/
  gaussianStdDev?: number;
  /** 鏃ュ織鍓嶇紑锛堝 "[OuoOrchestrator]"锛?*/
  logPrefix?: string;
  /** 浼戞伅浜嬩欢鍥炶皟锛堢敤浜?EventBus 鍙戝皠鍐峰嵈浜嬩欢锛?*/
  onRest?: (reason: string, durationMs: number) => void;
}

/**
 * 璋冨害绛栫暐
 *
 * 璐熻矗浠诲姟闂寸殑鏃堕棿闂撮殧鎺у埗锛屽寘鎷細
 * - 鏅€氫换鍔￠棿闂撮殧
 * - 鐭懆鏈熶紤鎭?
 * - 闀垮懆鏈熶紤鎭?
 * - 鍙腑鏂?sleep
 *
 * 琚?BatchScheduler 鍜?OrchestratorBase 鍏变韩浣跨敤銆?
 *
 */
export class SchedulerStrategy {
  private processedCount = 0;
  private totalCount = 0;
  private readonly shortCycle: number;
  private readonly shortRestMin: number;
  private readonly shortRestMax: number;
  private readonly longCycle: number;
  private readonly longRestMin: number;
  private readonly longRestMax: number;
  private readonly taskDelayMin: number;
  private readonly taskDelayMax: number;
  private readonly useGaussian: boolean;
  private readonly gaussianMean: number;
  private readonly gaussianStdDev: number;
  private readonly logPrefix: string;
  private readonly onRest?: (reason: string, durationMs: number) => void;

  constructor(options?: SchedulerStrategyOptions) {
    this.shortCycle = options?.shortCycle ?? BATCH_SHORT_CYCLE;
    this.shortRestMin = options?.shortRestMin ?? BATCH_SHORT_REST_MIN;
    this.shortRestMax = options?.shortRestMax ?? BATCH_SHORT_REST_MAX;
    this.longCycle = options?.longCycle ?? BATCH_LONG_CYCLE;
    this.longRestMin = options?.longRestMin ?? BATCH_LONG_REST_MIN;
    this.longRestMax = options?.longRestMax ?? BATCH_LONG_REST_MAX;
    this.taskDelayMin = options?.taskDelayMin ?? BATCH_TASK_DELAY_MIN;
    this.taskDelayMax = options?.taskDelayMax ?? BATCH_TASK_DELAY_MAX;
    this.useGaussian = options?.useGaussian ?? false;
    this.gaussianMean = options?.gaussianMean ?? 60_000;
    this.gaussianStdDev = options?.gaussianStdDev ?? 15_000;
    this.logPrefix = options?.logPrefix ?? '[Scheduler]';
    this.onRest = options?.onRest;
  }

  /**
   * 閲嶇疆璁℃暟鍣紙寮€濮嬫柊涓€鎵逛换鍔℃椂璋冪敤锛?
   */
  reset(): void {
    this.processedCount = 0;
    this.totalCount = 0;
  }

  /**
   * 鏍囪涓€涓换鍔″凡瀹屾垚
   */
  markCompleted(): void {
    this.processedCount++;
    this.totalCount++;
  }

  getProcessedCount(): number {
    return this.processedCount;
  }

  getTotalCount(): number {
    return this.totalCount;
  }

  /**
   * 鍩虹浠诲姟闂撮棿闅?
   *
   * uniform 妯″紡锛氶殢鏈?[taskDelayMin, taskDelayMax]
   * gaussian 妯″紡锛氶珮鏂垎甯?(mean, stdDev)
   */
  async interTaskDelay(): Promise<void> {
    let delay: number;
    if (this.useGaussian) {
      delay = gaussianDelay(this.gaussianMean, this.gaussianStdDev);
      const seconds = (delay / 1000).toFixed(0);
      console.log(`${this.logPrefix} 浠诲姟闂撮殧 ${seconds}s`);
    } else {
      delay = randomDelay(this.taskDelayMin, this.taskDelayMax);
      const seconds = (delay / 1000).toFixed(1);
      console.log(`${this.logPrefix} 浠诲姟闂撮殧 ${seconds}s`);
    }
    await sleep(delay);
  }

  /**
   * 妫€鏌ユ槸鍚﹂渶瑕佷紤鎭紝濡傞渶瑕佸垯绛夊緟
   *
   * 浼樺厛绾э細闀垮懆鏈?> 鐭懆鏈?> 鏅€氶棿闅?
   *
   * @param checkFn - 鍙€夌殑妫€鏌ュ嚱鏁帮紝杩斿洖 false 鏃舵彁鍓嶄腑鏂瓑寰?
   */
  async waitIfNeeded(checkFn?: () => boolean): Promise<void> {
    if (this.processedCount === 0) return;

    // 闀垮懆鏈熸鏌?
    if (this.processedCount % this.longCycle === 0) {
      const restMs = randomDelay(this.longRestMin, this.longRestMax);
      const minutes = (restMs / 60_000).toFixed(1);
      const reason = `闀垮懆鏈熶紤鎭?${minutes} 鍒嗛挓锛堝凡瀹屾垚 ${this.processedCount} 涓换鍔★級`;
      console.log(`${this.logPrefix} ${reason}`);
      this.onRest?.(reason, restMs);
      await this.interruptibleSleep(restMs, checkFn);
      return;
    }

    // 鐭懆鏈熸鏌?
    if (this.processedCount % this.shortCycle === 0) {
      const restMs = randomDelay(this.shortRestMin, this.shortRestMax);
      const seconds = (restMs / 1000).toFixed(1);
      const reason = `鐭懆鏈熶紤鎭?${seconds} 绉掞紙宸插畬鎴?${this.processedCount} 涓换鍔★級`;
      console.log(`${this.logPrefix} ${reason}`);
      this.onRest?.(reason, restMs);
      await this.interruptibleSleep(restMs, checkFn);
      return;
    }

    // 鏅€氫换鍔￠棿闂撮殧
    if (this.useGaussian) {
      const delay = gaussianDelay(this.gaussianMean, this.gaussianStdDev);
      const seconds = (delay / 1000).toFixed(0);
      console.log(`${this.logPrefix} 浠诲姟闂撮殧 ${seconds}s`);
      this.onRest?.(`浠诲姟闂撮殧 ${seconds}s`, delay);
      await this.interruptibleSleep(delay, checkFn);
    } else {
      await this.interTaskDelay();
    }
  }

  /**
   * 鍙腑鏂殑 sleep
   *
   * 鍒嗘 sleep锛屾瘡 5 绉掓鏌ヤ竴娆?checkFn銆?
   * 濡傛灉 checkFn 杩斿洖 false锛岀珛鍗宠繑鍥烇紙涓嶇瓑寰呭墿浣欐椂闂达級銆?
   *
   * @param ms - 鎬荤瓑寰呮绉掓暟
   * @param checkFn - 妫€鏌ュ嚱鏁帮紝杩斿洖 false 鏃朵腑鏂瓑寰?
   */
  async interruptibleSleep(
    ms: number,
    checkFn?: () => boolean,
  ): Promise<void> {
    // 濡傛灉娌℃湁妫€鏌ュ嚱鏁帮紝鐩存帴 sleep
    if (!checkFn) {
      await sleep(ms);
      return;
    }

    const step = 5000;
    let elapsed = 0;

    while (elapsed < ms) {
      if (!checkFn()) return;
      const remaining = ms - elapsed;
      const sleepMs = Math.min(step, remaining);
      await sleep(sleepMs);
      elapsed += sleepMs;
    }
  }
}
