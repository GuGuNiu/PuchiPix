/**
 * 延迟与计时工具模块
 *
 * 提供 Promise 基础的延迟、超时、重试等异步控制工具。
 *
 * @example
 * // 等待指定毫秒
 * await sleep(1000);
 *
 * @example
 * // 随机延迟（反爬虫）
 * await sleepRandom(500, 1500);
 *
 * @example
 * // 带超时的异步操作
 * const result = await withTimeout(fetch(url), 5000);
 */

/**
 * 等待指定的毫秒数
 *
 * @param ms - 等待的毫秒数
 * @returns Promise，在指定时间后 resolve
 *
 * @example
 * await sleep(1000); // 等待 1 秒
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 生成指定范围内的随机延迟毫秒数
 *
 * 用于反爬虫策略，在请求之间添加随机间隔。
 *
 * @param min - 最小延迟（毫秒）
 * @param max - 最大延迟（毫秒）
 * @returns 随机毫秒数
 */
export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
* 等待一个随机的时间范围
 *
 * 结合 randomDelay 和 sleep，用于反爬虫场景。
 *
 * @param min - 最小延迟（毫秒）
 * @param max - 最大延迟（毫秒）
 * @returns Promise，在随机时间后 resolve
 *
 * @example
 * await sleepRandom(500, 1500); // 等待 0.5-1.5 秒
 */
export function sleepRandom(min: number, max: number): Promise<void> {
  return sleep(randomDelay(min, max));
}

/**
 * 为 Promise 添加超时控制
 *
 * 如果 Promise 在指定时间内未 resolve，则 reject 一个超时错误。
 *
 * @param promise - 原始 Promise
 * @param timeoutMs - 超时毫秒数
 * @param message - 自定义超时错误消息
 * @returns 带超时控制的 Promise
 *
 * @example
 * const result = await withTimeout(fetch(url), 5000, '请求超时');
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string = 'Operation timed out'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

/**
 * 异步重试函数
 *
 * 当异步操作失败时自动重试指定次数。
 *
 * @param fn - 异步函数
 * @param maxRetries - 最大重试次数（默认 3）
 * @param delayMs - 每次重试之间的延迟（毫秒，默认 1000）
 * @returns Promise，成功时 resolve 结果，失败时 reject 最后一次错误
 *
 * @example
 * const result = async () => {
 *   return await retry(() => fetchData(), 3, 1000);
 * };
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

/**
 * 指数退避延迟
 *
 * 计算第 n 次重试的等待时间，基于指数退避算法。
 *
 * @param retryAttempt - 当前重试次数（从 0 开始）
 * @param baseDelayMs - 基础延迟毫秒数（默认 500）
 * @param maxDelayMs - 最大延迟毫秒数（默认 30000）
 * @returns 等待的毫秒数
 */
export function exponentialBackoff(
  retryAttempt: number,
  baseDelayMs: number = 500,
  maxDelayMs: number = 30000
): number {
  const delay = baseDelayMs * Math.pow(2, retryAttempt);
  return Math.min(delay, maxDelayMs);
}
