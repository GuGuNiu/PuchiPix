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
 * 实时速度图表组件
 *
 * 使用 CSS 柱状图展示下载速度历史，渐变填充 + 交互。
 */
export function SpeedGraph({ values }: { values: number[] }): React.JSX.Element {
  const max = Math.max(...values, 1);

  return (
    <div className="ops-speed-graph ops-scan">
      <div className="ops-graph-header">
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          下载速度
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          实时
        </span>
      </div>
      <div className="ops-graph-canvas">
        {values.map((v, i) => {
          const height = Math.max((v / max) * 100, 4);
          return (
            <div
              key={i}
              className="ops-graph-bar"
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
