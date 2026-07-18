"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal, AlertTriangle, XCircle, Info, Bug, Trash2, Pause, Play } from "lucide-react";
import type { LogEntry } from "@/app/api/logs/route";
import { formatTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface LogConsoleProps {
  maxHeight?: number;
}

const LEVEL_CONFIG = {
  info: { icon: Info, color: "#2563eb", bg: "rgba(37, 99, 235, 0.08)", label: "INFO" },
  warn: { icon: AlertTriangle, color: "#d97706", bg: "rgba(217, 119, 6, 0.08)", label: "WARN" },
  error: { icon: XCircle, color: "#dc2626", bg: "rgba(220, 38, 38, 0.08)", label: "ERROR" },
  debug: { icon: Bug, color: "#7c3aed", bg: "rgba(124, 58, 237, 0.08)", label: "DEBUG" },
};

export function LogConsole({ maxHeight = 420 }: LogConsoleProps): React.JSX.Element {
  const { t } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<"all" | LogEntry["level"]>("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldScrollRef = useRef(true);
  const bufferRef = useRef<LogEntry[]>([]);

  const flushBuffer = useCallback(() => {
    if (bufferRef.current.length === 0) return;
    setLogs((prev) => {
      const merged = [...prev, ...bufferRef.current];
      bufferRef.current = [];
      return merged.slice(-500);
    });
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/logs");

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
  }, [paused, flushBuffer]);

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
  }, []);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      if (p) {
        setTimeout(flushBuffer, 0);
      }
      return !p;
    });
  }, [flushBuffer]);

  const filteredLogs = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  const counts = {
    all: logs.length,
    info: logs.filter((l) => l.level === "info").length,
    warn: logs.filter((l) => l.level === "warn").length,
    error: logs.filter((l) => l.level === "error").length,
    debug: logs.filter((l) => l.level === "debug").length,
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
            {(["all", "info", "warn", "error", "debug"] as const).map((level) => (
              <button
                key={level}
                className={`ops-log-filter ${filter === level ? "active" : ""}`}
                onClick={() => setFilter(level)}
              >
                {level === "all" ? t("ops.all") : LEVEL_CONFIG[level].label}
                <span className="ops-log-count">{counts[level]}</span>
              </button>
            ))}
          </div>
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
            const config = LEVEL_CONFIG[log.level];
            const Icon = config.icon;
            return (
              <div
                key={log.id}
                className={`ops-log-item ${log.level}`}
                style={{ background: config.bg }}
              >
                <Icon size={12} style={{ color: config.color, flexShrink: 0, marginTop: 2 }} />
                <span className="ops-log-time">{formatTime(log.timestamp)}</span>
                <span className="ops-log-source" style={{ color: config.color }}>
                  [{log.source}]
                </span>
                <span className="ops-log-message">{log.message}</span>
                {log.details && (
                  <span className="ops-log-details">{log.details}</span>
                )}
              </div>
            );
          })
        )}
        {paused && bufferRef.current.length > 0 && (
          <div className="ops-log-paused-banner">
            <Pause size={12} />
            {t("ops.pausedBuffer", { count: bufferRef.current.length })}
          </div>
        )}
      </div>
    </div>
  );
}
