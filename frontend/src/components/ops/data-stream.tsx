import { useState, useEffect } from "react";


export function DataStream(): React.JSX.Element {
  return (
    <div className="ops-data-stream">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="stream-bar" />
      ))}
    </div>
  );
}


export function DiskActivity(): React.JSX.Element {
  return (
    <div className="ops-disk-activity">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="disk-dot" />
      ))}
    </div>
  );
}


export function SpeedGraph({ values }: { values: number[] }): React.JSX.Element {
  const max = Math.max(...values, 1);
  const latest = values[values.length - 1] ?? 0;
  const latestStr = latest > 0
    ? latest >= 1024 * 1024 * 1024
      ? `${(latest / 1024 / 1024 / 1024).toFixed(2)} GB/s`
      : `${(latest / 1024 / 1024).toFixed(1)} MB/s`
    : "0 MB/s";

  return (
    <div className="ops-speed-graph ops-scan">
      <div className="ops-graph-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", letterSpacing: 0.2 }}>
            下载速度
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--neon-cyan)",
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              textShadow: "0 0 8px var(--neon-cyan-glow)",
            }}
          >
            {latestStr}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", boxShadow: "0 0 6px var(--neon-green-glow)", animation: "pulse-glow 2s ease-in-out infinite" }} />
          实时
        </span>
      </div>
      <div className="ops-graph-canvas">
        {values.map((v, i) => {
          const height = Math.max((v / max) * 100, 4);
          const isLatest = i === values.length - 1;
          return (
            <div
              key={i}
              className={`ops-graph-bar ${isLatest ? "active" : ""}`}
              style={{ height: `${height}%` }}
              title={`${(v / 1024 / 1024).toFixed(1)} MB/s`}
            />
          );
        })}
      </div>
    </div>
  );
}


export function SiteIndicator({ online }: { online: boolean }): React.JSX.Element {
  return (
    <div className={`ops-site-indicator ${online ? "online" : "offline"}`} />
  );
}


export function useSpeedHistory(currentSpeed: number, maxPoints = 60): number[] {
  const [history, setHistory] = useState<number[]>(() =>
    Array.from({ length: maxPoints }, () => 0)
  );

  useEffect(() => {
    setHistory((prev) => {
      const next = [...prev.slice(1), currentSpeed];
      return next;
    });
  }, [currentSpeed, maxPoints]);

  return history;
}
