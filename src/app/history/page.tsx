"use client";

/**
 * 下载历史页面
 *
 * 功能：
 * - Tab 切换：视频历史 / 图库历史
 * - 状态筛选（全部/已完成/失败/已取消）带计数
 * - 关键词搜索（标题/URL）
 * - 排序（完成时间降序/升序）
 * - 单条重新下载、删除
 * - 批量清空历史
 * - WebSocket 实时刷新
 *
 * @date 2026-07-10
 * @lastModified 2026-07-11
 */

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  RefreshCw,
  Trash2,
  Search as SearchIcon,
  RotateCw,
  Inbox,
  ImageIcon,
  Video,
} from "lucide-react";
import type { TaskStatus, DownloadTask, GalleryData } from "@/types";
import { useSocketStore } from "@/store/socket-store";
import { useGalleryStore } from "@/store/gallery-store";
import GlassSelect from "@/components/ui/glass-select";

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

const GALLERY_STATUS_LABEL: Record<string, string> = {
  scraping: "爬取中",
  completed: "已完成",
  downloading: "下载中",
  partial: "部分完成",
  failed: "失败",
  pending: "等待中",
};

const GALLERY_STATUS_CLASS: Record<string, string> = {
  scraping: "badge-info",
  completed: "badge-success",
  downloading: "badge-info",
  partial: "badge-warning",
  failed: "badge-danger",
  pending: "badge-default",
};

type StatusFilter = "all" | "completed" | "failed" | "cancelled";
type SortBy = "date_desc" | "date_asc";

const FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已取消" },
];

const SORT_OPTIONS = [
  { value: "date_desc", label: "最新优先" },
  { value: "date_asc", label: "最早优先" },
];

type TabType = "video" | "gallery";

export default function HistoryPage() {
  const [tab, setTab] = useState<TabType>("video");

  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <div className="tasks-tabs" style={{ padding: "14px 24px 0" }}>
          <button
            className={`tasks-tab ${tab === "video" ? "active" : ""}`}
            onClick={() => setTab("video")}
          >
            <Video size={14} style={{ marginRight: 4, verticalAlign: "middle" }} />
            视频历史
          </button>
          <button
            className={`tasks-tab ${tab === "gallery" ? "active" : ""}`}
            onClick={() => setTab("gallery")}
          >
            <ImageIcon size={14} style={{ marginRight: 4, verticalAlign: "middle" }} />
            图库历史
          </button>
        </div>

        {tab === "video" ? (
          <VideoHistoryTab />
        ) : (
          <GalleryHistoryTab />
        )}
      </div>
    </div>
  );
}

// ============================================================
// 视频历史 Tab
// ============================================================

function VideoHistoryTab() {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("date_desc");
  const socket = useSocketStore((s) => s.socket);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/history?${params.toString()}`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.items ?? [];
      setTasks(list);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!socket) return;

    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefetch = () => {
      if (refetchTimer) return;
      refetchTimer = setTimeout(() => {
        refetchTimer = null;
        fetchHistory();
      }, 500);
    };

    const handleProgress = (msg: { task_id: number; status: string }) => {
      if (["completed", "failed", "cancelled"].includes(msg.status)) {
        scheduleRefetch();
      }
    };

    socket.on("progress", handleProgress);

    return () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      socket.off("progress", handleProgress);
    };
  }, [socket, fetchHistory]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const t of tasks) {
      counts[t.Status] = (counts[t.Status] || 0) + 1;
    }
    return counts;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (statusFilter !== "all") {
      result = result.filter((t) => t.Status === statusFilter);
    }

    const sorted = [...result];
    if (sortBy === "date_desc") {
      sorted.sort(
        (a, b) =>
          new Date(b.UpdatedAt || b.CreatedAt).getTime() -
          new Date(a.UpdatedAt || a.CreatedAt).getTime()
      );
    } else {
      sorted.sort(
        (a, b) =>
          new Date(a.UpdatedAt || a.CreatedAt).getTime() -
          new Date(b.UpdatedAt || b.CreatedAt).getTime()
      );
    }

    return sorted;
  }, [tasks, statusFilter, sortBy]);

  const handleClear = async () => {
    if (!confirm("确认清空全部视频历史记录？此操作不可恢复。")) return;
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setTasks([]);
      toast.success("历史记录已清空");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleRedownload = async (task: DownloadTask) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: task.M3U8URL || task.URL,
          format: "mp4",
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "重新下载失败");
      }
      toast.success("已创建新任务");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleDelete = async (taskId: number) => {
    if (!confirm(`确认删除历史记录 #${taskId}？`)) return;
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setTasks((prev) => prev.filter((t) => t.ID !== taskId));
      toast.success(`已删除记录 #${taskId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  return (
    <>
      <div className="tasks-toolbar">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTER_PILLS.map((pill) => (
            <button
              key={pill.value}
              className={`pill ${statusFilter === pill.value ? "active" : ""}`}
              onClick={() => setStatusFilter(pill.value)}
              style={{ fontSize: 12 }}
            >
              {pill.label}
              <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 11 }}>
                {statusCounts[pill.value] || 0}
              </span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <SearchIcon
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="搜索标题或链接..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") fetchHistory();
            }}
            style={{
              width: "100%",
              padding: "6px 10px 6px 32px",
              fontSize: 13,
              background: "var(--bg-inset)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ minWidth: 130 }}>
          <GlassSelect
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={(v) => setSortBy(v as SortBy)}
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button className="btn btn-outline btn-sm" onClick={fetchHistory} disabled={loading}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={handleClear}
            disabled={loading || tasks.length === 0}
          >
            <Trash2 size={14} />
            清空
          </button>
        </div>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="loading-container">
          <div className="spinner" />
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Inbox size={48} strokeWidth={1.5} />
          </div>
          <div className="empty-state-text">
            {tasks.length === 0 ? "暂无视频历史记录" : "没有匹配的记录"}
          </div>
          <div className="empty-state-subtext">
            {tasks.length === 0 ? "已完成的下载将自动归档到此处" : "尝试调整筛选条件或搜索关键词"}
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>编号</th>
                <th style={{ width: 220 }}>标题</th>
                <th style={{ width: 80 }}>状态</th>
                <th style={{ width: 160, whiteSpace: "nowrap" }}>完成时间</th>
                <th style={{ width: 160, whiteSpace: "nowrap" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const idStr = String(task.ID);
                const idDisplay = idStr.length > 8 ? idStr.slice(0, 8) + "..." : idStr;
                const titleDisplay = task.VideoInfo?.Title || task.URL;
                const urlDisplay =
                  titleDisplay.length > 30 ? titleDisplay.slice(0, 27) + "..." : titleDisplay;
                const timeStr = task.UpdatedAt
                  ? new Date(task.UpdatedAt).toLocaleString()
                  : task.CreatedAt
                  ? new Date(task.CreatedAt).toLocaleString()
                  : "—";

                return (
                  <Fragment key={task.ID}>
                    <tr>
                      <td style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>
                        {idDisplay}
                      </td>
                      <td
                        style={{
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={titleDisplay}
                      >
                        {urlDisplay}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_CLASS[task.Status]}`}>
                          {STATUS_LABEL[task.Status] ?? task.Status}
                        </span>
                      </td>
                      <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{timeStr}</td>
                      <td>
                        <div className="action-buttons">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleRedownload(task)}
                            title="重新下载"
                          >
                            <RotateCw size={14} />
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(task.ID)}
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ============================================================
// 图库历史 Tab
// ============================================================

function GalleryHistoryTab() {
  const { galleries, loading, fetchGalleries, deleteGallery, retryDownload, subscribeToSocket } =
    useGalleryStore();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("date_desc");

  useEffect(() => {
    fetchGalleries();
    const unsub = subscribeToSocket();
    return () => unsub();
  }, [fetchGalleries, subscribeToSocket]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: galleries.length };
    for (const g of galleries) {
      if (g.Status === "completed" || g.Status === "partial") {
        counts["completed"] = (counts["completed"] || 0) + 1;
      } else if (g.Status === "failed") {
        counts["failed"] = (counts["failed"] || 0) + 1;
      }
    }
    return counts;
  }, [galleries]);

  const filteredGalleries = useMemo(() => {
    let result = galleries;

    if (statusFilter === "completed") {
      result = result.filter((g) => g.Status === "completed" || g.Status === "partial");
    } else if (statusFilter === "failed") {
      result = result.filter((g) => g.Status === "failed");
    } else if (statusFilter === "cancelled") {
      result = result.filter((g) => g.Status === "failed");
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (g) =>
          (g.Title || "").toLowerCase().includes(q) ||
          (g.Protagonist || "").toLowerCase().includes(q) ||
          g.SourceURL.toLowerCase().includes(q)
      );
    }

    const sorted = [...result];
    if (sortBy === "date_desc") {
      sorted.sort((a, b) => new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime());
    } else {
      sorted.sort((a, b) => new Date(a.UpdatedAt || a.CreatedAt).getTime() - new Date(b.UpdatedAt || b.CreatedAt).getTime());
    }

    return sorted;
  }, [galleries, statusFilter, search, sortBy]);

  const handleDelete = async (id: number) => {
    if (!confirm(`确认删除图库 #${id}？`)) return;
    const ok = await deleteGallery(id);
    if (ok) toast.success(`已删除图库 #${id}`);
    else toast.error("删除失败");
  };

  const handleRetry = async (id: number) => {
    const ok = await retryDownload(id);
    if (ok) toast.success(`图库 #${id} 下载已重新启动`);
    else toast.error("启动下载失败");
  };

  return (
    <>
      <div className="tasks-toolbar">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTER_PILLS.map((pill) => (
            <button
              key={pill.value}
              className={`pill ${statusFilter === pill.value ? "active" : ""}`}
              onClick={() => setStatusFilter(pill.value)}
              style={{ fontSize: 12 }}
            >
              {pill.label}
              <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 11 }}>
                {statusCounts[pill.value] || 0}
              </span>
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <SearchIcon
            size={14}
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted)",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            placeholder="搜索标题、主角或链接..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 10px 6px 32px",
              fontSize: 13,
              background: "var(--bg-inset)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ minWidth: 130 }}>
          <GlassSelect
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={(v) => setSortBy(v as SortBy)}
          />
        </div>

        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button className="btn btn-outline btn-sm" onClick={() => fetchGalleries()} disabled={loading}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
      </div>

      {loading && galleries.length === 0 ? (
        <div className="loading-container">
          <div className="spinner" />
        </div>
      ) : filteredGalleries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Inbox size={48} strokeWidth={1.5} />
          </div>
          <div className="empty-state-text">
            {galleries.length === 0 ? "暂无图库历史记录" : "没有匹配的记录"}
          </div>
          <div className="empty-state-subtext">
            {galleries.length === 0 ? "已完成的图库下载将自动归档到此处" : "尝试调整筛选条件或搜索关键词"}
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>编号</th>
                <th style={{ width: 200 }}>标题</th>
                <th style={{ width: 100 }}>主角</th>
                <th style={{ width: 80, whiteSpace: "nowrap" }}>图片</th>
                <th style={{ width: 80, whiteSpace: "nowrap" }}>视频</th>
                <th style={{ width: 80 }}>状态</th>
                <th style={{ width: 160, whiteSpace: "nowrap" }}>完成时间</th>
                <th style={{ width: 120, whiteSpace: "nowrap" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredGalleries.map((gallery) => {
                const titleDisplay = gallery.Title || `图库 #${gallery.ID}`;
                const urlDisplay =
                  titleDisplay.length > 25 ? titleDisplay.slice(0, 22) + "..." : titleDisplay;
                const timeStr = gallery.UpdatedAt
                  ? new Date(gallery.UpdatedAt).toLocaleString()
                  : gallery.CreatedAt
                  ? new Date(gallery.CreatedAt).toLocaleString()
                  : "—";
                const canRetry = gallery.Status === "failed" || gallery.Status === "partial";

                return (
                  <Fragment key={gallery.ID}>
                    <tr>
                      <td style={{ fontFamily: "monospace", color: "var(--text-secondary)" }}>
                        {gallery.ID}
                      </td>
                      <td
                        style={{
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={titleDisplay}
                      >
                        {urlDisplay}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {gallery.Protagonist || "—"}
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>
                        {gallery.ImageCount}P
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)" }}>
                        {gallery.VideoCount > 0 ? `${gallery.VideoCount}V` : "—"}
                      </td>
                      <td>
                        <span className={`badge ${GALLERY_STATUS_CLASS[gallery.Status] || "badge-default"}`}>
                          {GALLERY_STATUS_LABEL[gallery.Status] ?? gallery.Status}
                        </span>
                      </td>
                      <td style={{ color: "var(--text-secondary)", fontSize: 12 }}>{timeStr}</td>
                      <td>
                        <div className="action-buttons">
                          {canRetry && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleRetry(gallery.ID)}
                              title="重新下载"
                            >
                              <RotateCw size={14} />
                            </button>
                          )}
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDelete(gallery.ID)}
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
