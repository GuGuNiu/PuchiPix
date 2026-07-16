"use client";

import { useState, useEffect } from "react";

/**
 * 控制台实时日志组件（任务管理专用）
 *
 * 每 1.2 秒刷新一次，显示最新任务管理相关日志。
 * 极窄边框 + 微弱圆角设计，贴边显示。
 */
export function ConsoleLog(): React.JSX.Element {
  const [log, setLog] = useState<string>("加载中...");

  useEffect(() => {
    const fetchLog = async () => {
      try {
        const res = await fetch("/api/logs/latest");
        const data = await res.json();
        setLog(data.log ?? "暂无任务日志");
      } catch {
        setLog("日志获取失败");
      }
    };

    // 立即获取一次
    fetchLog();

    // 每 1.2 秒刷新
    const interval = setInterval(fetchLog, 1200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="console-log"
      title={log}
    >
      <span className="console-log-text">{log}</span>
    </div>
  );
}
