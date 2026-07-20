/**
 *
 *
 * @example
 * await sleep(1000);
 *
 * @example
 * await sleepRandom(500, 1500);
 *
 * @example
 * const result = await withTimeout(fetch(url), 5000);
 */


export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 *
 *
 * @returns Random milliseconds
 */
export function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


export function sleepRandom(min: number, max: number): Promise<void> {
  return sleep(randomDelay(min, max));
}

/**
 * To Promise AddTimeout control
 *
 *
 *
 * @example
 * Const result = await withTimeout(fetch(url), 5000, 'Request timeout');
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

export interface RetryOptions<T = unknown> {
  maxRetries?: number;
  backoff?: 'fixed' | 'exponential';
  baseDelay?: number;
  maxDelay?: number;
  isSuccess?: (result: T) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * AsyncRetryfunction
 *
 *
 * @param options - Retryconfig
 *
 * @example
 * const result = await retry(() => fetchData(), { maxRetries: 3 });
 *
 * @example
 * // Exponential backoff + isSuccess Check
 * const result = await retry(
 *   () => downloadFile(url, path),
 *   { backoff: 'exponential', baseDelay: 1000, maxDelay: 8000, isSuccess: r => r.success }
 * );
 */
export function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions<T>,
): Promise<T>;

/**
 *
 * @param fn - Asyncfunction
 */
export function retry<T>(
  fn: () => Promise<T>,
  maxRetries?: number,
  delayMs?: number,
): Promise<T>;

export function retry<T>(
  fn: (attempt: number) => Promise<T>,
  optionsOrMaxRetries?: RetryOptions<T> | number,
  maybeDelayMs?: number,
): Promise<T> {
  const isOptionsMode = typeof optionsOrMaxRetries !== 'number';
  const opts = isOptionsMode
    ? (optionsOrMaxRetries as RetryOptions<T> | undefined)
    : undefined;

  const maxRetries = opts?.maxRetries ?? (isOptionsMode ? 3 : (optionsOrMaxRetries as number | undefined) ?? 3);
  const backoff = opts?.backoff ?? 'fixed';
  const baseDelay = opts?.baseDelay ?? maybeDelayMs ?? 1000;
  const maxDelay = opts?.maxDelay ?? 30000;
  const isSuccess = opts?.isSuccess;
  const onRetry = opts?.onRetry;
  const shouldRetry = opts?.shouldRetry ?? (() => true);

  return (async () => {
    let lastError: unknown;
    let lastResult: T | undefined;
    let hasResult = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn(attempt);
        lastResult = result;
        hasResult = true;

        if (!isSuccess || isSuccess(result)) {
          return result;
        }
      } catch (err) {
        lastError = err;
      }

      if (attempt < maxRetries) {
        if (lastError !== undefined && !shouldRetry(lastError)) {
          break;
        }

        const raw = backoff === 'exponential'
          ? Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
          : baseDelay;
        const jitter = raw * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.max(0, Math.round(raw + jitter));

        if (onRetry && lastError !== undefined) {
          onRetry(attempt, lastError);
        } else if (onRetry && hasResult && !isSuccess?.(lastResult as T)) {
          onRetry(attempt, new Error('isSuccess check failed'));
        }

        await sleep(delay);
      }
    }

    if (hasResult) {
      return lastResult as T;
    }
    throw lastError;
  })();
}

/**
 * Exponential backoffDelay
 *
 *
 */
export function exponentialBackoff(
  retryAttempt: number,
  baseDelayMs: number = 500,
  maxDelayMs: number = 30000
): number {
  const delay = baseDelayMs * Math.pow(2, retryAttempt);
  return Math.min(delay, maxDelayMs);
}
