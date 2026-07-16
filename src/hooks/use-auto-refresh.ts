'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseAutoRefreshOptions {
  /** 轮询间隔（毫秒），默认 5000 */
  interval?: number;
  /** 立即执行一次，默认 true */
  immediate?: boolean;
  /** 页面不可见时是否暂停，默认 true */
  pauseOnHidden?: boolean;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试延迟（毫秒），默认 1000 */
  retryDelay?: number;
}

export interface UseAutoRefreshResult<T> {
  /** 当前数据 */
  data: T | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 错误信息 */
  error: Error | null;
  /** 手动触发刷新 */
  refresh: () => Promise<void>;
  /** 上次更新时间 */
  lastUpdated: Date | null;
}

export function useAutoRefresh<T>(
  fetchFn: () => Promise<T>,
  options: UseAutoRefreshOptions = {}
): UseAutoRefreshResult<T> {
  const {
    interval = 5000,
    immediate = true,
    pauseOnHidden = true,
    maxRetries = 3,
    retryDelay = 1000,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const retryCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted = useRef(true);
  const fetchFnRef = useRef(fetchFn);
  const maxRetriesRef = useRef(maxRetries);
  const retryDelayRef = useRef(retryDelay);
  const executeFetchRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    fetchFnRef.current = fetchFn;
    maxRetriesRef.current = maxRetries;
    retryDelayRef.current = retryDelay;
  });

  const executeFetch = useCallback(async () => {
    if (!isMounted.current) return;

    const currentFetchFn = fetchFnRef.current;
    const currentMaxRetries = maxRetriesRef.current;
    const currentRetryDelay = retryDelayRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const result = await currentFetchFn();
      if (isMounted.current) {
        setData(result);
        setLastUpdated(new Date());
        retryCount.current = 0;
      }
    } catch (err) {
      if (isMounted.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        // 自动重试
        if (retryCount.current < currentMaxRetries) {
          retryCount.current++;
          setTimeout(() => {
            if (isMounted.current) {
              void executeFetchRef.current();
            }
          }, currentRetryDelay * retryCount.current);
        }
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // 通过 useEffect 同步 ref，避免在 render 中赋值
  useEffect(() => {
    executeFetchRef.current = executeFetch;
  }, [executeFetch]);

  const refresh = useCallback(() => {
    retryCount.current = 0;
    return executeFetch();
  }, [executeFetch]);

  // 初始加载和轮询
  useEffect(() => {
    isMounted.current = true;

    if (immediate) {
      executeFetch();
    }

    // 设置轮询
    if (interval > 0) {
      intervalRef.current = setInterval(executeFetch, interval);
    }

    return () => {
      isMounted.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [executeFetch, immediate, interval]);

  // 页面可见性控制
  useEffect(() => {
    if (!pauseOnHidden) return;

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        // 页面重新可见时立即刷新
        executeFetch();
        // 恢复轮询
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        if (interval > 0) {
          intervalRef.current = setInterval(executeFetch, interval);
        }
      } else {
        // 页面不可见时暂停轮询
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [executeFetch, interval, pauseOnHidden]);

  return { data, isLoading, error, refresh, lastUpdated };
}

/**
 * 简单的轮询 Hook（只返回数据）
 */
export function usePolling<T>(
  fetchFn: () => Promise<T>,
  interval = 5000
): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchData = async (): Promise<void> => {
      try {
        const result = await fetchFn();
        if (mounted) {
          setData(result);
        }
      } catch {
      }
    };

    fetchData();
    const id = setInterval(fetchData, interval);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [fetchFn, interval]);

  return data;
}
