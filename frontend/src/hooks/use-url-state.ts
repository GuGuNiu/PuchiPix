import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';

/**
 * 稳定化 defaults 引用：调用处通常传对象字面量（如 { status: "all" }），
 * 每次渲染都是新引用。若直接作为 useCallback 依赖，会导致 update 每次
 * 渲染重建，进而连锁重建所有基于 update 的回调（setStatusFilter 等），
 * 造成子组件无效重渲染。这里仅在内容实际变化时更新引用。
 */
function useStableDefaults<T extends Record<string, string>>(defaults: T): T {
  const ref = useRef(defaults);
  const prev = ref.current;
  const keys = Object.keys(defaults);
  const changed =
    keys.length !== Object.keys(prev).length ||
    keys.some((k) => prev[k] !== defaults[k]);
  if (changed) {
    ref.current = defaults;
  }
  return ref.current;
}

export function useUrlState<T extends Record<string, string>>(
  defaults: T,
): {
  values: T;
  update: (updates: Partial<Record<keyof T, string | null>>) => void;
} {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  // 稳定 defaults，避免调用处字面量导致 update 每次渲染重建（性能瓶颈）
  const stableDefaults = useStableDefaults(defaults);

  const values = {} as Record<string, string>;
  for (const key of Object.keys(stableDefaults)) {
    values[key] = searchParams.get(key) ?? stableDefaults[key];
  }

  const update = useCallback(
    (updates: Partial<Record<keyof T, string | null>>) => {
      const params = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (
          value === null ||
          value === undefined ||
          value === '' ||
          value === stableDefaults[key as keyof T]
        ) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }
      const queryString = params.toString();
      navigate(queryString ? `${pathname}?${queryString}` : pathname, {
        replace: true,
      });
    },
    [navigate, pathname, searchParams, stableDefaults],
  );

  return { values: values as T, update };
}

/**
 * Debounced URL parameter hook. Syncs local state to URL search params
 * after a delay, avoiding excessive history entries on rapid input.
 */
export function useDebouncedUrlParam(
  urlKey: string,
  defaultValue: string = '',
  delay: number = 300,
): [string, (value: string) => void] {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const urlValue = searchParams.get(urlKey) ?? defaultValue;
  const [localValue, setLocalValue] = useState(urlValue);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalValue(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (localValue === urlValue) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (localValue === '' || localValue === defaultValue) {
        params.delete(urlKey);
      } else {
        params.set(urlKey, localValue);
      }
      const queryString = params.toString();
      navigate(queryString ? `${pathname}?${queryString}` : pathname, {
        replace: true,
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [localValue, urlValue, urlKey, delay, navigate, pathname, searchParams, defaultValue]);

  return [localValue, setLocalValue];
}
