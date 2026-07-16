"use client";

import { useState, useEffect } from "react";

/**
 * 数据流指示器组件
 *
 * 可视化表示实时数据流状态，5 条竖线依次跳动动画。
 */
export function DataStream(): React.JSX.Element {
  return (
    <div className="ops-data-stream">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="stream-bar" />
      ))}
    </div>
  );
}

/**
 * 硬盘活动指示器组件
 *
 * 3 个圆点水平依次跳动，表示磁盘读写活动。
 */
export function DiskActivity(): React.JSX.Element {
  return (
    <div className="ops-disk-activity">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="disk-dot" />
      ))}
    </div>
  );
}

/**
 * 实时速度图表组件
 *
 * 使用 CSS 柱状图展示下载速度历史，渐变填充 + 交互。
 */
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

/**
 * 站点状态指示器
 *
 * 圆形指示灯 + 环形扩散动画，表示站点在线/离线状态。
 */
export function SiteIndicator({ online }: { online: boolean }): React.JSX.Element {
  return (
    <div className={`ops-site-indicator ${online ? "online" : "offline"}`} />
  );
}

/**
 * 实时速度历史 hook
 *
 * 生成最近 N 个数据点的速度数组用于图表展示。
 */
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
