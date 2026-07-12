"use client";

import { useEffect, useState, FormEvent } from "react";
import { toast } from "sonner";
import {
  Plus,
  ListChecks,
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  History,
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

/**
 * 仪表盘首页
 *
 * 浅色主题运维监控面板，全宽布局，包含：
 * - 顶部实时数据条（总任务、进行中、已完成、失败）
 * - KPI 统计卡片（带数字滚动动画）
 * - 站点健康状态监控网格
 * - 实时速度图表
 * - 最近任务活动流
 * - 快速任务输入
 *
 * @lastModified 2026-07-09
 */
export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<DownloadTask[]>([]);
  const { tasks, fetchTasks, subscribeToSocket } = useTaskStore();
  const speedHistory = useSpeedHistory(stats?.current_speed ?? 0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const statsRes = await fetch("/api/stats")
          .then((r) => r.json())
          .catch(() => null);
        if (statsRes) setStats(statsRes);
      } catch {
        /* ignore */
      }
    };
    fetchData();
    fetchTasks();
    const interval = setInterval(fetchData, 5000);
    const unsub = subscribeToSocket();
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [fetchTasks, subscribeToSocket]);

  useEffect(() => {
    setRecent(tasks.slice(0, 8));
  }, [tasks]);

  const s = stats ?? {
    total_tasks: 0,
    downloading_tasks: 0,
    completed_tasks: 0,
    failed_tasks: 0,
    total_size: 0,
    total_size_str: "0 B",
    avg_speed: 0,
    avg_speed_str: "0 B/s",
    current_speed: 0,
    current_speed_str: "0 B/s",
    speed_rating: 0,
  };

  return (
    <div className="dashboard-page">
      {/* ─── 顶部实时数据条 ─── */}
      <RealtimeTicker stats={s} />

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

function RealtimeTicker({ stats }: { stats: Stats }) {
  return (
    <div className="ops-ticker">
      <div className="ticker-item">
        <div className="ticker-dot" />
        <span className="ticker-label">系统运行中</span>
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
        <span className="ticker-label">实时</span>
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
    { href: "/history" as const, icon: History, label: "下载历史", desc: "浏览历史下载记录" },
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
  const [format, setFormat] = useState("mp4");
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
    let ok = 0;
    let fail = 0;
    for (const u of list) {
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: u, format }),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setSubmitting(false);
    setUrls("");
    if (fail === 0) {
      toast.success(`已添加 ${ok} 个任务`);
    } else {
      toast.warning(`完成：${ok} 成功，${fail} 失败`);
    }
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
          <div className="format-pills">
            <button
              type="button"
              className={`pill ${format === "mp4" ? "active" : ""}`}
              onClick={() => setFormat("mp4")}
            >
              MP4
            </button>
          </div>
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
            const titleDisplay = t.VideoInfo?.Title || t.URL;
            const urlDisplay =
              titleDisplay.length > 40 ? titleDisplay.slice(0, 37) + "..." : titleDisplay;
            return (
              <div className="ops-activity-item" key={t.ID}>
                <StatusDot status={t.Status} />
                <span className="ops-activity-text" title={titleDisplay}>
                  {urlDisplay}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
                  {t.Progress.toFixed(0)}%
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
    downloading: "var(--info)",
    failed: "var(--danger)",
  };
  const color = colorMap[status] ?? "var(--text-muted)";

  return (
    <div
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 6px ${color}`,
        flexShrink: 0,
        animation: status === "downloading" ? "pulse-glow 1.5s ease-in-out infinite" : "none",
      }}
    />
  );
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "等待中",
  downloading: "下载中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  transcoding: "转码中",
};

const STATUS_CLASS: Record<TaskStatus, string> = {
  pending: "badge-default",
  downloading: "badge-info",
  paused: "badge-warning",
  completed: "badge-success",
  failed: "badge-danger",
  cancelled: "badge-default",
  transcoding: "badge-default",
};
