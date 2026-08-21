import { useEffect, useCallback, useRef, useState } from 'react';

interface RouteStateEntry {
  data: Record<string, unknown>;
  scrollTop: number;
  savedAt: number;
}

interface RouteStateConfig {
  /** Expired entries are not restored. Defaults to 5 minutes. */
  ttl?: number;
  /** Whether to persist scroll position. Defaults to true. */
  saveScroll?: boolean;
  /** CSS selector for the scroll container. Defaults to `.content-area`. */
  scrollSelector?: string;
}

const memCache = new Map<string, RouteStateEntry>();

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

const SAVE_DEBOUNCE_MS = 800;

async function loadFromServer(routeKey: string): Promise<RouteStateEntry | null> {
  try {
    const prefKey = `route_state:${routeKey}`;
    const res = await fetch(`/api/preferences?key=${encodeURIComponent(prefKey)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, string>;
    const raw = data[prefKey];
    if (!raw) return null;
    const entry = JSON.parse(raw) as RouteStateEntry;
    memCache.set(routeKey, entry);
    return entry;
  } catch {
    return null;
  }
}

function saveToServer(routeKey: string, entry: RouteStateEntry): void {
  memCache.set(routeKey, entry);

  const existing = pendingSaves.get(routeKey);
  if (existing) clearTimeout(existing);

  pendingSaves.set(
    routeKey,
    setTimeout(async () => {
      pendingSaves.delete(routeKey);
      try {
        const prefKey = `route_state:${routeKey}`;
        await fetch('/api/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [prefKey]: { value: JSON.stringify(entry), category: 'route_state' },
          }),
        });
      } catch {
      }
    }, SAVE_DEBOUNCE_MS),
  );
}

/**
 * Persists route state to the server-side UserPreference table and caches
 * in-memory for fast restoration within the same SPA session.
 */
export function useRouteState(
  routeKey: string,
  config: RouteStateConfig = {}
): {
  savedData: Record<string, unknown> | null;
  restoreScroll: () => void;
  saveState: (data: Record<string, unknown>) => void;
} {
  const { ttl = 5 * 60 * 1000, saveScroll = true, scrollSelector } = config;

  const [savedData, setSavedData] = useState<Record<string, unknown> | null>(() => {
    const entry = memCache.get(routeKey);
    if (entry && Date.now() - entry.savedAt <= ttl) {
      return entry.data;
    }
    return null;
  });

  const scrollRef = useRef<number>(0);
  const routeKeyRef = useRef(routeKey);

  useEffect(() => {
    routeKeyRef.current = routeKey;
  }, [routeKey]);

  useEffect(() => {
    let cancelled = false;

    const cached = memCache.get(routeKey);
    if (cached && Date.now() - cached.savedAt <= ttl) {
      setSavedData(cached.data);
      return;
    }

    loadFromServer(routeKey).then((entry) => {
      if (cancelled || !entry) return;
      if (Date.now() - entry.savedAt > ttl) return;
      setSavedData(entry.data);
    });

    return () => {
      cancelled = true;
    };
  }, [routeKey, ttl]);

  useEffect(() => {
    if (!saveScroll) return;
    const entry = memCache.get(routeKey);
    if (entry && entry.scrollTop > 0) {
      setTimeout(() => {
        const container = scrollSelector
          ? document.querySelector(scrollSelector)
          : document.querySelector('.content-area') || window;
        if (container === window) {
          window.scrollTo(0, entry.scrollTop);
        } else {
          (container as HTMLElement).scrollTop = entry.scrollTop;
        }
      }, 100);
    }
  }, [routeKey, saveScroll, scrollSelector]);

  useEffect(() => {
    if (!saveScroll) return;

    const container = scrollSelector
      ? document.querySelector(scrollSelector)
      : document.querySelector('.content-area');

    if (!container) return;

    const handleScroll = (): void => {
      scrollRef.current = (container as HTMLElement).scrollTop;
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [saveScroll, scrollSelector]);

  useEffect(() => {
    return () => {
      const key = routeKeyRef.current;
      if (saveScroll) {
        const container = scrollSelector
          ? document.querySelector(scrollSelector)
          : document.querySelector('.content-area');
        if (container) {
          scrollRef.current = (container as HTMLElement).scrollTop;
        }
      }
      const existing = memCache.get(key);
      saveToServer(key, {
        data: existing?.data ?? {},
        scrollTop: scrollRef.current,
        savedAt: Date.now(),
      });
    };
  }, [routeKey, saveScroll, scrollSelector]);

  const restoreScroll = useCallback(() => {
    const entry = memCache.get(routeKey);
    if (entry && entry.scrollTop > 0) {
      const container = scrollSelector
        ? document.querySelector(scrollSelector)
        : document.querySelector('.content-area') || window;
      if (container === window) {
        window.scrollTo(0, entry.scrollTop);
      } else {
        (container as HTMLElement).scrollTop = entry.scrollTop;
      }
    }
  }, [routeKey, scrollSelector]);

  const saveState = useCallback(
    (data: Record<string, unknown>) => {
      const existing = memCache.get(routeKey);
      saveToServer(routeKey, {
        data,
        scrollTop: existing?.scrollTop ?? scrollRef.current,
        savedAt: Date.now(),
      });
      setSavedData(data);
    },
    [routeKey]
  );

  return { savedData, restoreScroll, saveState };
}
