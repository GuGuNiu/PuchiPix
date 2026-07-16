"use client";

/**
 * 仪表盘首页
 *
 * 浅色主题运维监控面板，全宽布局，包含：
 * - 顶部实时数据条（总任务、进行中、已完成、失败）
 * - KPI 统计卡片（带数字滚动动画，从 SSE 任务流实时派生）
 * - 最近任务活动流
 * - 实时速度图表
 *
 * 实时策略：
 * - KPI 计数（总数/进行中/已完成/失败）从 SSE 任务列表 useMemo 派生，零延迟
 * - 体积/速度等聚合数据通过 /api/stats 每 30 秒补充轮询
 *
 */

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Activity,
  CheckCircle2,
  Wifi,
} from "lucide-react";
import type { DownloadTask, Stats, TaskStatus } from "@/types";
import { useTaskStore } from "@/store/task-store";
import { useI18n } from "@/lib/i18n";
import Link from "next/link";
import { DataStream } from "@/components/ops/data-stream";
import { LogConsole } from "@/components/ops/log-console";

const STATS_POLL_INTERVAL = 30000;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function Dashboard(): React.JSX.Element {
  const { tasks, sseConnected, fetchTasks, connectSSE } = useTaskStore();
  const [apiStats, setApiStats] = useState<Stats | null>(null);

  useEffect(() => {
    const fetchStats = async (): Promise<void> => {
      try {
        const res = await fetch("/api/stats");
        if (res.ok) {
          const data = await res.json();
          setApiStats(data);
        }
      } catch {
        /* ignore */
      }
    };
    fetchStats();
    fetchTasks();
    const interval = setInterval(fetchStats, STATS_POLL_INTERVAL);
    const unsub = connectSSE();
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [fetchTasks, connectSSE]);

  // 从 SSE 任务列表实时派生 KPI 计数
  const derivedStats = useMemo(() => {
    let downloading = 0;
    let completed = 0;
    let failed = 0;
    let totalSize = 0;

    for (const t of tasks) {
      if (t.Status === "downloading" || t.Status === "scraping" || t.Status === "transcoding") {
        downloading++;
      } else if (t.Status === "completed") {
        completed++;
      } else if (t.Status === "failed") {
        failed++;
      }
      if (t.VideoInfo?.FileSize) {
        totalSize += t.VideoInfo.FileSize;
      }
    }

    return {
      total_tasks: tasks.length,
      downloading_tasks: downloading,
      completed_tasks: completed,
      failed_tasks: failed,
      total_size: totalSize,
      total_size_str: formatFileSize(totalSize),
    };
  }, [tasks]);

  const recent = useMemo(() => tasks.slice(0, 16), [tasks]);

  // 合并：SSE 派生数据优先，apiStats 补充无法派生的字段
  const s: Stats = {
    total_tasks: derivedStats.total_tasks,
    downloading_tasks: derivedStats.downloading_tasks,
    completed_tasks: derivedStats.completed_tasks,
    failed_tasks: derivedStats.failed_tasks,
    total_size: derivedStats.total_size,
    total_size_str: derivedStats.total_size_str,
    avg_speed: apiStats?.avg_speed ?? 0,
    avg_speed_str: apiStats?.avg_speed_str ?? "0 B/task",
    current_speed: apiStats?.current_speed ?? 0,
    current_speed_str: apiStats?.current_speed_str ?? "0 B/s",
    speed_rating: apiStats?.speed_rating ?? 0,
  };

  return (
    <div className="dashboard-page">
      <RealtimeTicker stats={s} sseConnected={sseConnected} />

      <div className="ops-two-col">
        <RecentTasks tasks={recent} loading={false} />
        <LogConsole />
      </div>
    </div>
  );
}

/* ================================================================
   实时数据条
   ================================================================ */

function RealtimeTicker({ stats, sseConnected }: { stats: Stats; sseConnected: boolean }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ops-ticker">
      <div className="ticker-item">
        <div className={`ticker-dot ${sseConnected ? "" : "ticker-dot-offline"}`} />
        <span className="ticker-label">{sseConnected ? t("dashboard.realtimeConnected") : t("dashboard.offline")}</span>
      </div>
      <div className="ticker-item">
        <span className="ticker-label">{t("dashboard.totalTasks")}</span>
        <span className="ticker-value">{stats.total_tasks}</span>
      </div>
      <div className="ticker-item">
        <Activity size={12} style={{ color: "var(--warning)" }} />
        <span className="ticker-label">{t("dashboard.inProgress")}</span>
        <span className="ticker-value" style={{ color: "var(--warning)" }}>
          {stats.downloading_tasks}
        </span>
      </div>
      <div className="ticker-item">
        <CheckCircle2 size={12} style={{ color: "var(--success)" }} />
        <span className="ticker-label">{t("dashboard.completed")}</span>
        <span className="ticker-value" style={{ color: "var(--success)" }}>
          {stats.completed_tasks}
        </span>
      </div>
      <div className="ticker-item">
        <Wifi size={12} style={{ color: "var(--neon-cyan)" }} />
        <span className="ticker-label">{t("dashboard.speed")}</span>
        <span className="ticker-value live">
          {stats.current_speed_str}
        </span>
        <DataStream />
      </div>
    </div>
  );
}

/* ================================================================
   最近任务活动流
   ================================================================ */

function RecentTasks({ tasks, loading }: { tasks: DownloadTask[]; loading: boolean }): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="ops-activity-feed">
      <div className="ops-activity-header">
        <div className="ops-activity-title">
          <Activity size={14} style={{ color: "var(--accent)" }} />
          {t("dashboard.recentTasks")}
        </div>
        <Link
          href="/tasks"
          style={{
            fontSize: 12,
            color: "var(--accent)",
            fontWeight: 600,
            textDecoration: "none",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          {t('dashboard.viewAll')}
          <ArrowRight size={12} />
        </Link>
      </div>
      <div className="ops-activity-body">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="empty-state" style={{ padding: "var(--space-8)" }}>
            <div className="empty-state-text">{t("dashboard.noTasks")}</div>
            <div className="empty-state-subtext">{t("dashboard.addLinkToStart")}</div>
          </div>
        ) : (
          tasks.map((task) => {
            const isGallery = task.TaskType === "gallery";
            const titleDisplay = isGallery
              ? (task.GalleryTitle || task.URL)
              : (task.VideoInfo?.Title || task.URL);
            const urlDisplay =
              titleDisplay.length > 40 ? titleDisplay.slice(0, 37) + "..." : titleDisplay;
            return (
              <div className="ops-activity-item" key={`${task.TaskType || "video"}-${task.ID}`}>
                <StatusDot status={task.Status} />
                <span className="ops-activity-text" title={titleDisplay}>
                  {urlDisplay}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  {task.Status === "scraping" ? t("dashboard.identifying") : `${task.Progress.toFixed(0)}%`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: TaskStatus }): React.JSX.Element {
  const colorMap: Record<string, string> = {
    completed: "var(--success)",
    partial: "var(--warning)",
    downloading: "var(--info)",
    scraping: "var(--neon-cyan)",
    failed: "var(--danger)",
  };
  const color = colorMap[status] ?? "var(--text-muted)";
  const animate = status === "downloading" || status === "scraping";

  return (
    <div
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}`,
        flexShrink: 0,
        animation: animate ? "pulse-glow 1.5s ease-in-out infinite" : "none",
      }}
    />
  );
}
