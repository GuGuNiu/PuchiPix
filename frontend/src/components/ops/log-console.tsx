import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Terminal, AlertTriangle, XCircle, Info, Bug, Trash2, Pause, Play } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import { SseConnection } from "@/lib/sse/sse-connection";

interface LogEntry {
  id?: string;
  level: string;
  module?: string;
  message: string;
  timestamp?: string;
  traceId?: string;
  dagId?: string;
  nodeId?: string;
  i18nKey?: string;
  i18nParams?: Record<string, unknown>;
  data?: unknown;
  details?: string;
}

interface LogConsoleProps {
  maxHeight?: number;
}

/*
 * The backend nests the ids under {context: {dagId, nodeId, traceId, ...}},
 * while the frontend reads them at the top level of the entry.
 */
function flattenLogContext(raw: Record<string, unknown>): Record<string, unknown> {
  const ctx = raw.context;
  if (ctx && typeof ctx === 'object') {
    const { dagId, nodeId, traceId, taskType, phase, ...rest } = ctx as Record<string, unknown>;
    return {
      ...raw,
      ...(dagId !== undefined ? { dagId } : {}),
      ...(nodeId !== undefined ? { nodeId } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(taskType !== undefined ? { taskType } : {}),
      ...(phase !== undefined ? { phase } : {}),
      ...(Object.keys(rest).length > 0 ? { contextExtra: rest } : {}),
    };
  }
  return raw;
}

const LEVEL_CONFIG = {
  INFO: { icon: Info, color: "var(--info)", bg: "var(--info-soft)", label: "INFO" },
  WARN: { icon: AlertTriangle, color: "var(--warning)", bg: "var(--warning-soft)", label: "WARN" },
  ERROR: { icon: XCircle, color: "var(--danger)", bg: "var(--danger-soft)", label: "ERROR" },
  DEBUG: { icon: Bug, color: "var(--purple)", bg: "var(--purple-soft)", label: "DEBUG" },
} as const;

type LogLevel = keyof typeof LEVEL_CONFIG;
type FilterLevel = "all" | LogLevel;

const CTX_COLORS = {
  dag: "var(--info)",
  node: "var(--info)",
  trace: "var(--purple)",
};

export function LogConsole({ maxHeight = 420 }: LogConsoleProps): React.JSX.Element {
  const { t } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<FilterLevel>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [dagIdFilter, setDagIdFilter] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);
  const bufferRef = useRef<LogEntry[]>([]);
  const [bufferCount, setBufferCount] = useState(0);

  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    setLogs((prev) => {
      const merged = [...prev, ...bufferRef.current];
      bufferRef.current = [];
      return merged.slice(-500);
    });
    setBufferCount(0);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (moduleFilter !== "all") params.set("module", moduleFilter);
    if (dagIdFilter) params.set("dagId", dagIdFilter);
    const qs = params.toString();
    const url = qs ? `/api/logs?${qs}` : "/api/logs";

    const conn = new SseConnection(url);

    const unsubHistory = conn.subscribe("history", (e) => {
      try {
        const raw = JSON.parse(e.data) as Array<Record<string, unknown>>;
        setLogs(raw.map(flattenLogContext) as unknown as LogEntry[]);
      } catch {}
    });

    const unsubLog = conn.subscribe("log", (e) => {
      try {
        const raw = JSON.parse(e.data) as Record<string, unknown>;
        const entry = flattenLogContext(raw) as unknown as LogEntry;
        if (paused) {
          bufferRef.current.push(entry);
          setBufferCount(bufferRef.current.length);
        } else {
          setLogs((prev) => [...prev.slice(-499), entry]);
        }
      } catch {}
    });

    const unsubState = conn.onStateChange((state) => {
      setConnected(state === "connected");
    });

    conn.connect();

    const timer = setInterval(flushBuffer, 500);

    return () => {
      unsubHistory();
      unsubLog();
      unsubState();
      conn.destroy();
      clearInterval(timer);
    };
  }, [paused, flushBuffer, moduleFilter, dagIdFilter]);

  useEffect(() => {
    if (shouldScrollRef.current && scrollRef.current && !paused) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, paused]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    shouldScrollRef.current = nearBottom;
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    bufferRef.current = [];
    setBufferCount(0);
  }, []);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      if (p) {
        setTimeout(flushBuffer, 0);
      }
      return !p;
    });
  }, [flushBuffer]);

  const moduleList = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.module) set.add(log.module);
    }
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (filter !== "all") {
      result = result.filter((l) => l.level === filter);
    }
    return result;
  }, [logs, filter]);

  const counts = useMemo(() => {
    const c = { all: logs.length, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
    for (const l of logs) {
      if (l.level in c) (c[l.level as LogLevel]++);
    }
    return c;
  }, [logs]);

  const formatContextTags = (log: LogEntry): React.ReactNode => {
    const tags: React.ReactNode[] = [];
    if (log.dagId) {
      tags.push(
        <span key="dag" style={{ color: CTX_COLORS.dag, fontSize: 10, fontWeight: 500 }}>
          dag={log.dagId}
        </span>
      );
    }
    if (log.nodeId) {
      tags.push(
        <span key="node" style={{ color: CTX_COLORS.node, fontSize: 10, fontWeight: 500 }}>
          node={log.nodeId}
        </span>
      );
    }
    if (log.traceId) {
      tags.push(
        <span key="trace" style={{ color: CTX_COLORS.trace, fontSize: 10, fontWeight: 500 }}>
          trace={log.traceId?.slice(0, 8)}
        </span>
      );
    }
    return tags.length > 0 ? <span className="ops-log-ctx">{tags}</span> : null;
  };

  const getDisplayMessage = (log: LogEntry): string => {
    if (log.i18nKey) {
      return t(log.i18nKey as TranslationKey, log.i18nParams as Record<string, string | number> | undefined);
    }
    return log.message;
  };

  return (
    <div className="ops-log-console">
      <div className="ops-log-header">
        <div className="ops-log-title">
          <Terminal size={14} style={{ color: "var(--accent)" }} />
          <span>{t("ops.systemConsole")}</span>
          <span
            className="ops-log-indicator"
            style={{
              background: connected ? "var(--success)" : "var(--danger)",
              boxShadow: connected ? "0 0 8px var(--neon-green-glow)" : "0 0 8px var(--shadow-glow-danger)",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
            {connected ? t("ops.realtimeConnected") : t("ops.disconnected")}
          </span>
        </div>
        <div className="ops-log-actions">
          <div className="ops-log-filters">
            {(["all", "INFO", "WARN", "ERROR", "DEBUG"] as const).map((level) => (
              <button
                key={level}
                className={`ops-log-filter ${filter === level ? "active" : ""}`}
                onClick={() => setFilter(level)}
              >
                {level === "all" ? t("ops.all") : LEVEL_CONFIG[level as LogLevel].label}
                <span className="ops-log-count">{counts[level]}</span>
              </button>
            ))}
          </div>
          <select
            className="ops-log-module-filter"
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            style={{ fontSize: 11 }}
          >
            <option value="all">All Modules</option>
            {moduleList.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            className="ops-log-dag-filter"
            type="text"
            placeholder="dagId..."
            value={dagIdFilter}
            onChange={(e) => setDagIdFilter(e.target.value)}
            style={{ fontSize: 11, width: 80 }}
          />
          <button
            className="ops-log-btn"
            onClick={togglePause}
            title={paused ? t("ops.resume") : t("ops.pause")}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button
            className="ops-log-btn"
            onClick={clearLogs}
            title={t("ops.clear")}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="ops-log-body"
        style={{ maxHeight }}
        onScroll={handleScroll}
      >
        {filteredLogs.length === 0 ? (
          <div className="ops-log-empty">
            <Terminal size={32} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
            <span>{t("ops.noLogs")}</span>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const config = LEVEL_CONFIG[log.level as LogLevel] ?? LEVEL_CONFIG.INFO;
            const Icon = config.icon;
            return (
              <div
                key={log.id}
                className={`ops-log-item ${log.level.toLowerCase()}`}
                style={{ background: config.bg }}
              >
                <Icon size={12} style={{ color: config.color, flexShrink: 0, marginTop: 2 }} />
                <span className="ops-log-time">{formatTime(log.timestamp || '')}</span>
                {log.module && (
                  <span className="ops-log-source" style={{ color: config.color }}>
                    [{log.module}]
                  </span>
                )}
                <span className="ops-log-message-area">
                  {formatContextTags(log)}
                  <span className="ops-log-message">{getDisplayMessage(log)}</span>
                  {log.data !== undefined && log.data !== null && (
                    <span className="ops-log-details">
                      {typeof log.data === "object"
                        ? JSON.stringify(log.data)
                        : String(log.data)}
                    </span>
                  )}
                  {log.details && (
                    <span className="ops-log-details">{log.details}</span>
                  )}
                </span>
              </div>
            );
          })
        )}
        {paused && bufferCount > 0 && (
          <div className="ops-log-paused-banner">
            <Pause size={12} />
            {t("ops.pausedBuffer", { count: bufferCount })}
          </div>
        )}
      </div>
    </div>
  );
}
