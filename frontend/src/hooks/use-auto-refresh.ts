'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseAutoRefreshOptions {
  interval?: number;
  immediate?: boolean;
  pauseOnHidden?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

export interface UseAutoRefreshResult<T> {  data: T | null;  isLoading: boolean;  error: Error | null;  refresh: () => Promise<void>;  lastUpdated: Date | null;
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

  useEffect(() => {
    executeFetchRef.current = executeFetch;
  }, [executeFetch]);

  const refresh = useCallback(() => {
    retryCount.current = 0;
    return executeFetch();
  }, [executeFetch]);

  useEffect(() => {
    isMounted.current = true;

    if (immediate) {
      executeFetch();
    }

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

  useEffect(() => {
    if (!pauseOnHidden) return;

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        executeFetch();
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        if (interval > 0) {
          intervalRef.current = setInterval(executeFetch, interval);
        }
      } else {
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
