'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

/**
 * URL 查询参数状态管理 Hook
 *
 * 适用于低频更新的状态（筛选器、排序、展开项等）。
 * 每次更新直接替换 URL，即时反映在地址栏。
 *
 * @param defaults - 各参数的默认值（值为默认值的参数不会出现在 URL 中）
 */
export function useUrlState<T extends Record<string, string>>(
  defaults: T
): {
  values: T;
  update: (updates: Partial<Record<keyof T, string | null>>) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const values = useMemo(() => {
    const result = {} as Record<string, string>;
    for (const key of Object.keys(defaultsRef.current)) {
      result[key] = searchParams.get(key) ?? defaultsRef.current[key];
    }
    return result as T;
  }, [searchParams]);

  const update = useCallback(
    (updates: Partial<Record<keyof T, string | null>>) => {
      const params = new URLSearchParams(searchParamsRef.current.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (
          value === null ||
          value === undefined ||
          value === '' ||
          value === defaultsRef.current[key]
        ) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname]
  );

  return { values, update };
}

/**
 * 带防抖的 URL 搜索参数 Hook
 *
 * @param urlKey - URL 查询参数名
 * @param defaultValue - 默认值
 * @param delay - 防抖延迟（毫秒），默认 300ms
 */
export function useDebouncedUrlParam(
  urlKey: string,
  defaultValue: string = '',
  delay: number = 300
): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(urlKey) ?? defaultValue;
  const [localValue, setLocalValue] = useState(urlValue);
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const defaultValueRef = useRef(defaultValue);
  defaultValueRef.current = defaultValue;

  useEffect(() => {
    setLocalValue(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (localValue === urlValue) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParamsRef.current.toString());
      if (localValue === '' || localValue === defaultValueRef.current) {
        params.delete(urlKey);
      } else {
        params.set(urlKey, localValue);
      }
      const queryString = params.toString();
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [localValue, urlValue, urlKey, delay, router, pathname]);

  return [localValue, setLocalValue];
}
