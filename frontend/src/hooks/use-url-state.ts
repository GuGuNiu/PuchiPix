import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';

/**
 * Callers pass an object literal, a fresh reference on every render. Without
 * identity stabilization it becomes a useCallback dependency and cascades into
 * rebuilding every derived callback.
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
