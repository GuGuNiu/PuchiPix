import { SchedulerStrategy, type SchedulerStrategyOptions } from './scheduler-strategy';

// Re-export for backward compatibility
export interface BatchSchedulerOptions extends SchedulerStrategyOptions {
  /** 鏃ュ織鍥炶皟 */
  onLog?: (message: string) => void;
}

/**
 * 澶ф壒閲忎换鍔℃櫤鑳借皟搴﹀櫒锛坴2 鈥?濮旀墭 SchedulerStrategy锛?
 *
 * 淇濈暀鍘熸湁 API 涓嶅彉锛屽唴閮ㄥ鎵?SchedulerStrategy 瀹炵幇璋冨害閫昏緫銆?
 *
 */
export class BatchScheduler {
  private readonly scheduler: SchedulerStrategy;
  private readonly onLog?: (message: string) => void;

  constructor(options?: BatchSchedulerOptions) {
    this.onLog = options?.onLog;
    this.scheduler = new SchedulerStrategy({
      ...options,
      logPrefix: '[BatchScheduler]',
    });
  }

  /**
   * 閲嶇疆璁℃暟鍣紙寮€濮嬫柊涓€鎵逛换鍔℃椂璋冪敤锛?
   */
  reset(): void {
    this.scheduler.reset();
  }

  /**
   * 鍦ㄤ换鍔′箣闂寸瓑寰咃紙鍩虹闂撮殧锛?
   *
   * 姣忎釜浠诲姟鎵ц鍚庤皟鐢紝绛夊緟闅忔満 5~15 绉掋€?
   */
  async interTaskDelay(): Promise<void> {
    await this.scheduler.interTaskDelay();
  }

  /**
   * 妫€鏌ユ槸鍚﹂渶瑕佷紤鎭紝濡傞渶瑕佸垯绛夊緟
   *
   * 鍦ㄦ瘡涓换鍔″紑濮嬪墠璋冪敤锛?
   * - 鐭懆鏈熸鏌ワ細姣?shortCycle 涓换鍔′紤鎭?10~30 绉?
   * - 闀垮懆鏈熸鏌ワ細姣?longCycle 涓换鍔′紤鎭?20~40 鍒嗛挓
   *
   * @param checkFn - 鍙€夌殑妫€鏌ュ嚱鏁帮紝杩斿洖 false 鏃舵彁鍓嶄腑鏂瓑寰?
   */
  async waitIfNeeded(checkFn?: () => boolean): Promise<void> {
    await this.scheduler.waitIfNeeded(checkFn);
  }

  /**
   * 鏍囪涓€涓换鍔″凡瀹屾垚
   */
  markCompleted(): void {
    this.scheduler.markCompleted();
  }

  /**
   * 鑾峰彇褰撳墠宸插鐞嗕换鍔℃暟
   */
  getProcessedCount(): number {
    return this.scheduler.getProcessedCount();
  }

  /**
   * 鑾峰彇鎬诲鐞嗘暟
   */
  getTotalCount(): number {
    return this.scheduler.getTotalCount();
  }
}

/**
 * 鎵归噺澶勭悊 URL 鍒楄〃鐨勮緟鍔╁嚱鏁?
 *
 * 鑷姩鍦ㄤ换鍔￠棿鎻掑叆闅忔満闂撮殧鍜屽懆鏈熸€т紤鎭€?
 *
 * @param urls - URL 鍒楄〃
 * @param processor - 鍗曚釜 URL 鐨勫鐞嗗嚱鏁?
 * @param options - 璋冨害鍣ㄩ€夐」
 * @returns 姣忎釜 URL 鐨勫鐞嗙粨鏋?
 *
 */
export async function batchProcess<T>(
  urls: string[],
  processor: (url: string, index: number) => Promise<T>,
  options?: BatchSchedulerOptions,
): Promise<T[]> {
  const scheduler = new BatchScheduler(options);
  const results: T[] = [];

  for (let i = 0; i < urls.length; i++) {
    await scheduler.waitIfNeeded();

    try {
      const result = await processor(urls[i], i);
      results.push(result);
    } catch (err) {
      console.error(`[BatchProcess] URL ${urls[i]} 澶勭悊澶辫触:`, err);
      results.push(null as T);
    }

    scheduler.markCompleted();
  }

  return results;
}
