/**
 * 模块：URL 查询参数状态管理
 *
 * 将组件状态同步到 URL 查询参数，实现：
 * - 浏览器地址栏可见当前页面状态（筛选、搜索、排序等）
 * - 刷新/分享/书签可恢复状态
 * - 浏览器前进/后退保留状态
 *
 * @date 2026-07-13
 * @lastModified 2026-07-13
 */

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
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  const values = useMemo(() => {
    const result = {} as Record<string, string>;
    for (const key of Object.keys(defaultsRef.current)) {
      result[key] = searchParams.get(key) ?? defaultsRef.current[key];
    }
    return result as T;
  }, [searchParams]);

  const update = useCallback(
    (updates: Partial<Record<keyof T, string | null>>) => {
      const params = new URLSearchParams(paramsRef.current.toString());
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
 * 适用于搜索输入框等高频更新场景：
 * - 本地状态立即更新（无输入延迟）
 * - URL 同步延迟更新（避免频繁 router.replace）
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
  const paramsRef = useRef(searchParams);
  paramsRef.current = searchParams;

  const urlValue = searchParams.get(urlKey) ?? defaultValue;
  const [localValue, setLocalValue] = useState(urlValue);

  // URL 变化时同步到本地（处理浏览器前进/后退）
  useEffect(() => {
    setLocalValue(urlValue);
  }, [urlValue]);

  // 防抖同步到 URL
  useEffect(() => {
    if (localValue === urlValue) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(paramsRef.current.toString());
      if (localValue === '' || localValue === defaultValue) {
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
  }, [localValue, urlValue, urlKey, defaultValue, delay, router, pathname]);

  return [localValue, setLocalValue];
}
