"use client";

/**
 * 仪表盘首页
 *
 * 浅色主题运维监控面板，全宽布局，包含：
 * - 顶部实时数据条（总任务、进行中、已完成、失败）
 * - KPI 统计卡片（带数字滚动动画，从 SSE 任务流实时派生）
 * - 站点健康状态监控网格
 * - 实时速度图表
 * - 最近任务活动流
 * - 快速任务输入
 *
 * 实时策略：
 * - KPI 计数（总数/进行中/已完成/失败）从 SSE 任务列表 useMemo 派生，零延迟
 * - 体积/速度等聚合数据通过 /api/stats 每 30 秒补充轮询
 *
 * @lastModified 2026-07-12
 */

import { useEffect, useState, useMemo, FormEvent } from "react";
import { toast } from "sonner";
import {
  Plus,
  ListChecks,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  Images,
  ArrowRight,
  Activity,
  Wifi,
  HardDrive,
  Gauge,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { DownloadTask, Stats, TaskStatus } from "@/types";
import { useTaskStore } from "@/store/task-store";
import Link from "next/link";
import { AnimatedNumber } from "@/components/ops/animated-number";
import { DataStream, SpeedGraph, useSpeedHistory } from "@/components/ops/data-stream";
import { SiteMonitorGrid } from "@/components/ops/site-monitor-grid";

const STATS_POLL_INTERVAL = 30000;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function Dashboard() {
  const { tasks, sseConnected, fetchTasks, connectSSE } = useTaskStore();
  const [apiStats, setApiStats] = useState<Stats | null>(null);
  const speedHistory = useSpeedHistory(apiStats?.current_speed ?? 0);

  useEffect(() => {
    const fetchStats = async () => {
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

  const recent = useMemo(() => tasks.slice(0, 8), [tasks]);

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
      {/* ─── 顶部实时数据条 ─── */}
      <RealtimeTicker stats={s} sseConnected={sseConnected} />

      {/* ─── KPI 统计卡片 ─── */}
      <OpsStatsGrid stats={s} />

      {/* ─── 站点监控 + 速度图（两栏） ─── */}
      <div className="ops-two-col">
        <SiteMonitorGrid />
        <SpeedGraph values={speedHistory} />
      </div>

      {/* ─── 输入区 + 最近任务（两栏） ─── */}
      <div className="ops-two-col">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
          <DashInputCard />
          <QuickLinks />
        </div>
        <RecentTasks tasks={recent} loading={false} />
      </div>
    </div>
  );
}

/* ================================================================
   实时数据条
   ================================================================ */

function RealtimeTicker({ stats, sseConnected }: { stats: Stats; sseConnected: boolean }) {
  return (
    <div className="ops-ticker">
      <div className="ticker-item">
        <div className={`ticker-dot ${sseConnected ? "" : "ticker-dot-offline"}`} />
        <span className="ticker-label">{sseConnected ? "实时连接" : "离线"}</span>
      </div>
      <div className="ticker-item">
        <span className="ticker-label">总任务</span>
        <span className="ticker-value">{stats.total_tasks}</span>
      </div>
      <div className="ticker-item">
        <Activity size={12} style={{ color: "var(--warning)" }} />
        <span className="ticker-label">进行中</span>
        <span className="ticker-value" style={{ color: "var(--warning)" }}>
          {stats.downloading_tasks}
        </span>
      </div>
      <div className="ticker-item">
        <CheckCircle2 size={12} style={{ color: "var(--success)" }} />
        <span className="ticker-label">已完成</span>
        <span className="ticker-value" style={{ color: "var(--success)" }}>
          {stats.completed_tasks}
        </span>
      </div>
      <div className="ticker-item">
        <Wifi size={12} style={{ color: "var(--neon-cyan)" }} />
        <span className="ticker-label">速度</span>
        <span className="ticker-value live">
          {stats.current_speed_str}
        </span>
        <DataStream />
      </div>
    </div>
  );
}

/* ================================================================
   KPI 统计面板
   ================================================================ */

function OpsStatsGrid({ stats }: { stats: Stats }) {
  const total = stats.total_tasks || 1;
  const completionRate = ((stats.completed_tasks / total) * 100).toFixed(1);

  const kpis = [
    {
      icon: ListChecks,
      value: stats.total_tasks,
      label: "总任务",
      color: "blue" as const,
      pct: 100,
    },
    {
      icon: Loader2,
      value: stats.downloading_tasks,
      label: "进行中",
      color: "amber" as const,
      pct: (stats.downloading_tasks / total) * 100,
    },
    {
      icon: CheckCircle2,
      value: stats.completed_tasks,
      label: "已完成",
      color: "green" as const,
      pct: (stats.completed_tasks / total) * 100,
    },
    {
      icon: XCircle,
      value: stats.failed_tasks,
      label: "失败",
      color: "red" as const,
      pct: (stats.failed_tasks / total) * 100,
    },
  ];

  const secondary = [
    { icon: HardDrive, label: "总下载量", value: stats.total_size_str },
    { icon: Gauge, label: "平均速度", value: stats.avg_speed_str },
    { icon: TrendingUp, label: "完成率", value: `${completionRate}%` },
    { icon: Zap, label: "速度评级", value: stats.speed_rating > 0 ? `${stats.speed_rating}/5` : "—" },
  ];

  return (
    <div className="ops-stats-panel">
      <div className="ops-stats-main">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div className={`ops-kpi-col ${kpi.color}`} key={kpi.label}>
              <div className="ops-kpi-icon">
                <Icon size={18} strokeWidth={2} />
              </div>
              <div className="ops-kpi-body">
                <div className="ops-kpi-value">
                  <AnimatedNumber value={kpi.value} />
                </div>
                <div className="ops-kpi-label">{kpi.label}</div>
              </div>
              <div className="ops-kpi-track">
                <div
                  className="ops-kpi-fill"
                  style={{ width: `${Math.min(kpi.pct, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="ops-stats-secondary">
        {secondary.map((item) => {
          const Icon = item.icon;
          return (
            <div className="ops-secondary-item" key={item.label}>
              <Icon size={14} strokeWidth={2} />
              <span className="ops-secondary-label">{item.label}</span>
              <span className="ops-secondary-value">{item.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
   快速链接
   ================================================================ */

const LINKS = [
    { href: "/tasks" as const, icon: Download, label: "任务管理", desc: "查看和管理下载任务" },
    { href: "/gallery" as const, icon: Images, label: "图包架", desc: "浏览已下载的图包" },
];

function QuickLinks() {

  return (
    <div className="quick-links">
      {LINKS.map((link) => {
        const Icon = link.icon;
        return (
          <Link href={link.href} className="quick-link-card" key={link.href}>
            <div className="quick-link-icon">
              <Icon size={16} strokeWidth={2} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="quick-link-text">{link.label}</div>
              <div className="quick-link-desc">{link.desc}</div>
            </div>
            <ArrowRight size={14} style={{ color: "var(--text-muted)", marginLeft: "auto", flexShrink: 0 }} />
          </Link>
        );
      })}
    </div>
  );
}

/* ================================================================
   任务输入卡片
   ================================================================ */

function DashInputCard() {
  const [urls, setUrls] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const raw = urls.trim();
    if (!raw) {
      toast.error("请输入链接");
      return;
    }
    const list = raw
      .split(/[\n\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
    if (list.length === 0) {
      toast.error("请输入有效的 HTTP(S) 链接");
      return;
    }

    setSubmitting(true);
    setUrls("");

    for (const u of list) {
      fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (data?.type === "gallery") {
            toast.success(`图库 #${data.galleryId} 已创建`);
          } else if (data?.ID) {
            toast.success(`任务 #${data.ID} 已创建`);
          }
        })
        .catch((err) => {
          toast.error(`添加失败: ${err.message}`);
        });
    }

    setSubmitting(false);
    toast.success(`已提交 ${list.length} 个任务`);
  };

  return (
    <div className="dash-input-card">
      <form className="dash-input-form" onSubmit={handleSubmit}>
        <textarea
          className="dash-input-area"
          placeholder={"输入 M3U8 链接或网站地址，自动识别并下载...\n支持多行输入多个链接"}
          rows={3}
          required
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
        />
        <div className="dash-input-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "添加中..." : <><Plus size={16} />添加任务</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ================================================================
   最近任务活动流
   ================================================================ */

function RecentTasks({ tasks, loading }: { tasks: DownloadTask[]; loading: boolean }) {
  return (
    <div className="ops-activity-feed">
      <div className="ops-activity-header">
        <div className="ops-activity-title">
          <Activity size={14} style={{ color: "var(--accent)" }} />
          最近任务
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
          查看全部
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
            <div className="empty-state-text">暂无任务</div>
            <div className="empty-state-subtext">添加链接开始下载</div>
          </div>
        ) : (
          tasks.map((t) => {
            const isGallery = t.TaskType === "gallery";
            const titleDisplay = isGallery
              ? (t.GalleryTitle || t.URL)
              : (t.VideoInfo?.Title || t.URL);
            const urlDisplay =
              titleDisplay.length > 40 ? titleDisplay.slice(0, 37) + "..." : titleDisplay;
            return (
              <div className="ops-activity-item" key={`${t.TaskType || "video"}-${t.ID}`}>
                <StatusDot status={t.Status} />
                <span className="ops-activity-text" title={titleDisplay}>
                  {urlDisplay}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  {t.Status === "scraping" ? "识别中" : `${t.Progress.toFixed(0)}%`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: TaskStatus }) {
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
