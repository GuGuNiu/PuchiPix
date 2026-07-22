'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';


export function useUrlState<T extends Record<string, string>>(
  defaults: T,
): {
  values: T;
  update: (updates: Partial<Record<keyof T, string | null>>) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const values = {} as Record<string, string>;
  for (const key of Object.keys(defaults)) {
    values[key] = searchParams.get(key) ?? defaults[key];
  }

  const update = useCallback(
    (updates: Partial<Record<keyof T, string | null>>) => {
      const params = new URLSearchParams(searchParams.toString());
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
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
        scroll: false,
      });
    },
    [router, pathname, searchParams, defaults],
  );

  return { values: values as T, update };
}

/**
 *
 * @param defaultValue - Default value
 */
export function useDebouncedUrlParam(
  urlKey: string,
  defaultValue: string = '',
  delay: number = 300,
): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlValue = searchParams.get(urlKey) ?? defaultValue;
  const [localValue, setLocalValue] = useState(urlValue);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalValue(urlValue);
  }, [urlValue]);

  useEffect(() => {
    if (localValue === urlValue) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
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
  }, [localValue, urlValue, urlKey, delay, router, pathname, searchParams, defaultValue]);

  return [localValue, setLocalValue];
}
