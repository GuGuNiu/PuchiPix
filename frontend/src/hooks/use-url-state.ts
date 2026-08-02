import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';


export function useUrlState<T extends Record<string, string>>(
  defaults: T,
): {
  values: T;
  update: (updates: Partial<Record<keyof T, string | null>>) => void;
} {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();

  const values = {} as Record<string, string>;
  for (const key of Object.keys(defaults)) {
    values[key] = searchParams.get(key) ?? defaults[key];
  }

  const update = useCallback(
    (updates: Partial<Record<keyof T, string | null>>) => {
      const params = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (
          value === null ||
          value === undefined ||
          value === '' ||
          value === defaults[key as keyof T]
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
    [navigate, pathname, searchParams, defaults],
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
