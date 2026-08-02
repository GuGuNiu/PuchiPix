import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { WifiOff } from "lucide-react";

interface BackendState {
  /** Whether the Go backend is currently reachable */
  reachable: boolean;
  /** Whether the database is connected */
  databaseOk: boolean;
  /** Last health check timestamp */
  lastCheck: number;
}

interface BackendAwareContextValue extends BackendState {
  /** Manually trigger a health re-check */
  checkNow: () => void;
}

const BackendAwareContext = createContext<BackendAwareContextValue>({
  reachable: true,
  databaseOk: true,
  lastCheck: 0,
  checkNow: () => {},
});

/** Poll interval in ms */
const POLL_INTERVAL = 5000;
/** Timeout for each health check fetch */
const FETCH_TIMEOUT = 3000;

export function useBackendStatus(): BackendAwareContextValue {
  return useContext(BackendAwareContext);
}

/**
 * BackendAwareProvider polls the Go backend's /api/health endpoint
 * and surfaces connection state to all child components. When the
 * backend is unreachable, it renders a non-blocking banner instead
 * of letting individual pages hang on fetch() calls.
 */
export default function BackendAwareProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<BackendState>({
    reachable: true,
    databaseOk: true,
    lastCheck: 0,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkHealth = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetch("/api/health", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setState({
          reachable: true,
          databaseOk: data?.database === "ok",
          lastCheck: Date.now(),
        });
      } else {
        setState((prev) => ({ ...prev, reachable: false, lastCheck: Date.now() }));
      }
    } catch {
      setState((prev) => ({ ...prev, reachable: false, lastCheck: Date.now() }));
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    // Check immediately on mount
    checkHealth();

    // Then poll periodically
    timerRef.current = setInterval(checkHealth, POLL_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkHealth]);

  const value: BackendAwareContextValue = {
    ...state,
    checkNow: checkHealth,
  };

  return (
    <BackendAwareContext.Provider value={value}>
      {!state.reachable && (
        <div className="backend-banner">
          <WifiOff size={16} />
          <span>Backend unavailable — some features are limited</span>
          <button
            onClick={checkHealth}
            className="backend-banner-retry"
          >
            Retry now
          </button>
        </div>
      )}
      {state.reachable && !state.databaseOk && (
        <div className="backend-banner backend-banner-warn">
          <WifiOff size={16} />
          <span>Database disconnected — data may be stale</span>
        </div>
      )}
      {children}
    </BackendAwareContext.Provider>
  );
}
