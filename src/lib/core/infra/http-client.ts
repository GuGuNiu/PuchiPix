import { detectWaf } from '@/lib/core/stealth/waf-detector';

export interface RequestWithRetryOptions extends RequestInit {
  /** Max retrycount（default 3） */
  retries?: number;
  /** TriggerRetry Status code（default [429, 503]） */
  retryCodes?: number[];
  fatal?: boolean;
  requestInterval?: number;
  timeout?: number;
}

export interface RequestResult {
  ok: boolean;
  status: number;
  body: string | null;
  headers: Headers;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_CODES: readonly number[] = [429, 503];
const DEFAULT_TIMEOUT = 15000;
const BASE_BACKOFF_MS = 1000;
const JITTER_MAX_MS = 1000;

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asDate = Date.parse(headerValue);
  if (!Number.isNaN(asDate)) {
    const diff = asDate - Date.now();
    return diff > 0 ? diff : 0;
  }
  const seconds = parseInt(headerValue, 10);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }
  return null;
}

function computeBackoff(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * JITTER_MAX_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 *
 * - WAF Detect：403/429 ResponseTrigger WAF Check
 */
export async function requestWithRetry(
  url: string,
  options: RequestWithRetryOptions = {},
): Promise<RequestResult> {
  const {
    retries = DEFAULT_RETRIES,
    retryCodes = DEFAULT_RETRY_CODES,
    fatal = true,
    requestInterval = 0,
    timeout = DEFAULT_TIMEOUT,
    ...fetchOptions
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (requestInterval > 0 && attempt > 0) {
      await sleep(requestInterval);
    }

    try {
      const resp = await fetch(url, {
        ...fetchOptions,
        signal: AbortSignal.timeout(timeout),
      });

      if (requestInterval > 0 && attempt < retries) {
        await sleep(requestInterval);
      }

      if (resp.status === 429 && attempt < retries) {
        const retryAfter = parseRetryAfter(resp.headers.get('Retry-After'));
        const delay = retryAfter ?? computeBackoff(attempt);
        await sleep(delay);
        continue;
      }

      if (retryCodes.includes(resp.status) && attempt < retries) {
        await sleep(computeBackoff(attempt));
        continue;
      }

      const body = resp.ok ? await resp.text() : null;
      return {
        ok: resp.ok,
        status: resp.status,
        body,
        headers: resp.headers,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // NetworkwrongRetry（non- AbortError）
      if (lastError.name === 'AbortError' && attempt < retries) {
        await sleep(computeBackoff(attempt));
        continue;
      }
      // Timeout retry
      if (attempt < retries) {
        await sleep(computeBackoff(attempt));
        continue;
      }
    }
  }

  if (fatal) {
    throw lastError ?? new Error(`Request failed after ${retries + 1} attempts: ${url}`);
  }

  return {
    ok: false,
    status: 0,
    body: null,
    headers: new Headers(),
  };
}


export function checkWaf(status: number, html: string): boolean {
  const result = detectWaf(status, html);
  return result.blocked;
}
