"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Terminal, AlertTriangle, XCircle, Info, Bug, Trash2, Pause, Play, Filter } from "lucide-react";
import { formatTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";

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

const LEVEL_CONFIG = {
  INFO: { icon: Info, color: "#2563eb", bg: "rgba(37, 99, 235, 0.08)", label: "INFO" },
  WARN: { icon: AlertTriangle, color: "#d97706", bg: "rgba(217, 119, 6, 0.08)", label: "WARN" },
  ERROR: { icon: XCircle, color: "#dc2626", bg: "rgba(220, 38, 38, 0.08)", label: "ERROR" },
  DEBUG: { icon: Bug, color: "#7c3aed", bg: "rgba(124, 58, 237, 0.08)", label: "DEBUG" },
} as const;

type LogLevel = keyof typeof LEVEL_CONFIG;
type FilterLevel = "all" | LogLevel;

const CTX_COLORS = {
  dag: "#3b82f6",
  node: "#3b82f6",
  trace: "#a855f7",
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

    const es = new EventSource(url);

    es.addEventListener("history", (e) => {
      try {
        const data = JSON.parse(e.data) as LogEntry[];
        setLogs(data);
        setConnected(true);
      } catch {
      }
    });

    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse(e.data) as LogEntry;
        if (paused) {
          bufferRef.current.push(entry);
          setBufferCount(bufferRef.current.length);
        } else {
          setLogs((prev) => [...prev.slice(-499), entry]);
        }
      } catch {
      }
    });

    es.onerror = () => {
      setConnected(false);
    };

    es.onopen = () => {
      setConnected(true);
    };

    const timer = setInterval(flushBuffer, 500);

    return () => {
      es.close();
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
          trace={log.traceId.slice(0, 8)}
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
                <span className="ops-log-source" style={{ color: config.color }}>
                  [{log.module}]
                </span>
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
