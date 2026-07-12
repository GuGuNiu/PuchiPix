"use client";

/**
 * 任务管理页面
 *
 * 作为顶层任务编排器，统一展示视频下载任务和图库任务：
 * - 添加新任务（单个/批量导入，自动识别视频/图库类型）
 * - 状态筛选（全部/等待中/下载中/已完成/失败）
 * - 关键词搜索（标题/URL）
 * - 排序（创建时间/进度/状态）
 * - 批量操作（批量开始/取消/删除）
 * - 任务详情展开（视频任务显示标签/演员/分类，图库任务显示图片/视频数量/下载方式）
 * - WebSocket 实时进度更新（同时监听视频和图库事件）
 *
 * @date 2026-07-10
 * @lastModified 2026-07-12
 */

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Play,
  Pause,
  Square,
  Trash2,
  RotateCw,
  RefreshCw,
  Inbox,
  Search as SearchIcon,
  CheckSquare,
  Square as SquareIcon,
  Plus,
  X,
  Copy,
  Clock,
  Monitor,
  HardDrive,
  Calendar,
  ImageIcon,
  Film,
} from "lucide-react";
import type { TaskStatus, DownloadTask } from "@/types";
import { useTaskStore } from "@/store/task-store";
import GlassSelect from "@/components/ui/glass-select";
import BatchSearchPanel from "@/components/tasks/batch-search-panel";
import { useRouteState } from "@/lib/core/route-state";
import { ENABLED_SITE_MODULES, getSiteModule } from "@/lib/sites/site-modules";

const SITES = ENABLED_SITE_MODULES.map((m) => ({
  ...m,
  name: m.nameCn,
  gallery: m.type === 'photo',
}));

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "等待中",
  downloading: "下载中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  transcoding: "转码中",
};

type StatusFilter = "all" | TaskStatus;
type SortBy = "date_desc" | "date_asc" | "progress_desc" | "progress_asc" | "status";

const FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "等待中" },
  { value: "downloading", label: "下载中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

const SORT_OPTIONS = [
  { value: "date_desc", label: "最新优先" },
  { value: "date_asc", label: "最早优先" },
  { value: "progress_desc", label: "进度降序" },
  { value: "progress_asc", label: "进度升序" },
  { value: "status", label: "按状态" },
];

const STATUS_ORDER: Record<TaskStatus, number> = {
  downloading: 0,
  pending: 1,
  paused: 2,
  transcoding: 3,
  failed: 4,
  cancelled: 5,
  completed: 6,
};

export default function TasksPage() {
  const { tasks, loading, fetchTasks, subscribeToSocket } = useTaskStore();
  const pathname = usePathname();
  const { savedData, saveState } = useRouteState(pathname, {
    ttl: 5 * 60 * 1000,
    saveScroll: true,
  });

  const [linkInput, setLinkInput] = useState("");
  const [addTab, setAddTab] = useState<"link" | "search">(
    () => (savedData?.addTab as "link" | "search") ?? "link"
  );
  const [expandedTask, setExpandedTask] = useState<number | null>(
    () => (savedData?.expandedTask as number) ?? null
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    () => (savedData?.statusFilter as StatusFilter) ?? "all"
  );
  const [searchQuery, setSearchQuery] = useState(
    () => (savedData?.searchQuery as string) ?? ""
  );
  const [sortBy, setSortBy] = useState<SortBy>(
    () => (savedData?.sortBy as SortBy) ?? "date_desc"
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    saveState({ expandedTask, statusFilter, searchQuery, sortBy, addTab });
  }, [expandedTask, statusFilter, searchQuery, sortBy, addTab, saveState]);

  useEffect(() => {
    fetchTasks();
    const unsub = subscribeToSocket();
    return () => unsub();
  }, [fetchTasks, subscribeToSocket]);

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

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) =>
          (t.VideoInfo?.Title || "").toLowerCase().includes(q) ||
          (t.GalleryTitle || "").toLowerCase().includes(q) ||
          t.URL.toLowerCase().includes(q) ||
          (t.M3U8URL || "").toLowerCase().includes(q)
      );
    }

    const sorted = [...result];
    switch (sortBy) {
      case "date_desc":
        sorted.sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());
        break;
      case "date_asc":
        sorted.sort((a, b) => new Date(a.CreatedAt).getTime() - new Date(b.CreatedAt).getTime());
        break;
      case "progress_desc":
        sorted.sort((a, b) => b.Progress - a.Progress);
        break;
      case "progress_asc":
        sorted.sort((a, b) => a.Progress - b.Progress);
        break;
      case "status":
        sorted.sort((a, b) => (STATUS_ORDER[a.Status] ?? 99) - (STATUS_ORDER[b.Status] ?? 99));
        break;
    }

    return sorted;
  }, [tasks, statusFilter, searchQuery, sortBy]);

  const parsedUrls = useMemo(() => {
    return linkInput
      .split(/[\n\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
  }, [linkInput]);

  const handleSubmit = () => {
    if (parsedUrls.length === 0) {
      toast.error("请输入有效的 HTTP(S) 链接");
      return;
    }

    setLinkInput("");
    setShowAddModal(false);

    const urls = [...parsedUrls];
    toast.success(urls.length > 1 ? `正在后台添加 ${urls.length} 个任务...` : "任务创建中...");

    for (const u of urls) {
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
            toast.success(`图库 #${data.galleryId} 已创建，正在后台爬取...`);
          } else {
            toast.success(`任务 #${data?.ID ?? ""} 已创建，正在后台处理...`);
          }
        })
        .catch((err) => {
          toast.error(`添加失败: ${err.message}`);
        });
    }

    fetchTasks();
  };

  const handleAction = useCallback(
    async (taskId: number, action: string) => {
      const task = tasks.find((t) => t.ID === taskId);
      const isGallery = task?.TaskType === 'gallery';
      try {
        let endpoint: string;
        if (isGallery) {
          if (action === 'start' || action === 'retry') {
            endpoint = `/api/gallery/${taskId}/download`;
          } else if (action === 'delete') {
            endpoint = `/api/gallery/${taskId}`;
          } else {
            toast.warning(`图库任务不支持${actionLabel(action)}操作`);
            return;
          }
        } else {
          endpoint = `/api/tasks/${taskId}/${action}`;
        }
        const method = action === 'delete' ? 'DELETE' : 'POST';
        const res = await fetch(endpoint, { method });
        if (!res.ok) throw new Error(await res.text());
        fetchTasks();
        toast.success(`${isGallery ? '图库' : '任务'} #${taskId} 已${actionLabel(action)}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
      }
    },
    [fetchTasks, tasks]
  );

  const handleDelete = useCallback(
    async (taskId: number) => {
      const task = tasks.find((t) => t.ID === taskId);
      const isGallery = task?.TaskType === 'gallery';
      if (!confirm(`确认删除${isGallery ? '图库' : '任务'} #${taskId}？`)) return;
      try {
        const endpoint = isGallery ? `/api/gallery/${taskId}` : `/api/tasks/${taskId}`;
        const res = await fetch(endpoint, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text());
        fetchTasks();
        toast.success(`已删除${isGallery ? '图库' : '任务'} #${taskId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
      }
    },
    [fetchTasks, tasks]
  );

  const handleBatchAction = useCallback(
    async (action: string) => {
      if (selectedIds.size === 0) {
        toast.error("请先选择任务");
        return;
      }
      const ids = Array.from(selectedIds);
      const isDelete = action === "delete";

      if (isDelete && !confirm(`确认批量删除 ${ids.length} 个任务？`)) return;

      let ok = 0;
      let fail = 0;
      for (const id of ids) {
        try {
          const task = tasks.find((t) => t.ID === id);
          const isGallery = task?.TaskType === 'gallery';
          if (isGallery) {
            if (action === 'start' || action === 'retry') {
              const res = await fetch(`/api/gallery/${id}/download`, { method: "POST" });
              if (res.ok) ok++; else fail++;
            } else if (isDelete) {
              const res = await fetch(`/api/gallery/${id}`, { method: "DELETE" });
              if (res.ok) ok++; else fail++;
            } else {
              fail++;
            }
          } else {
            if (isDelete) {
              const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
              if (res.ok) ok++;
              else fail++;
            } else {
              const res = await fetch(`/api/tasks/${id}/${action}`, { method: "POST" });
              if (res.ok) ok++;
              else fail++;
            }
          }
        } catch {
          fail++;
        }
      }
      setSelectedIds(new Set());
      fetchTasks();
      if (fail === 0) toast.success(`批量${actionLabel(action)}完成：${ok} 个`);
      else toast.warning(`完成：${ok} 成功，${fail} 失败`);
    },
    [selectedIds, fetchTasks, tasks]
  );

  const toggleExpand = (id: number) => {
    setExpandedTask((prev) => (prev === id ? null : id));
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map((t) => t.ID)));
    }
  };

  const allSelected = selectedIds.size > 0 && selectedIds.size === filteredTasks.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div className="tasks-layout">
      {/* 下载列表 */}
      <div className="card tasks-list-card">
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
                  <span
                    style={{
                      marginLeft: 4,
                      opacity: 0.7,
                      fontSize: 11,
                    }}
                  >
                    {statusCounts[pill.value] || 0}
                  </span>
                </button>
              ))}
            </div>

            <div
              style={{
                flex: 1,
                minWidth: 200,
                position: "relative",
              }}
            >
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
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "6px 12px 6px 32px",
                  fontSize: 13,
                  height: 32,
                  boxSizing: "border-box",
                  background: "var(--bg-inset)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
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
              <button
                className="btn btn-outline btn-sm"
                onClick={() => fetchTasks()}
              >
                <RefreshCw size={14} />
                刷新
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setShowAddModal(true)}
              >
                <Plus size={14} />
                添加任务
              </button>
            </div>
          </div>

          {/* 批量操作栏 */}
          {someSelected && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 20px",
                background: "var(--accent-soft)",
                borderBottom: "1px solid var(--border-light)",
                fontSize: 13,
              }}
            >
              <span style={{ fontWeight: 600, color: "var(--accent)" }}>
                已选 {selectedIds.size} 个
              </span>
              <div style={{ flex: 1 }} />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleBatchAction("start")}
              >
                <Play size={12} />
                批量开始
              </button>
              <button
                className="btn btn-warning btn-sm"
                onClick={() => handleBatchAction("pause")}
              >
                <Pause size={12} />
                批量暂停
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleBatchAction("cancel")}
              >
                <Square size={12} />
                批量取消
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => handleBatchAction("delete")}
              >
                <Trash2 size={12} />
                批量删除
              </button>
            </div>
          )}

          {loading && tasks.length === 0 ? (
            <div className="loading-container" style={{ flex: 1 }}>
              <div className="spinner" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div 
              className="empty-state"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '400px',
              }}
            >
              <div className="empty-state-icon">
                <Inbox size={48} strokeWidth={1.5} />
              </div>
              <div className="empty-state-text">
                {tasks.length === 0 ? "暂无下载任务" : "没有匹配的任务"}
              </div>
              <div className="empty-state-subtext">
                {tasks.length === 0
                  ? "输入 M3U8 链接、网站地址或图库链接即可开始下载"
                  : "尝试调整筛选条件或搜索关键词"}
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <button
                        onClick={toggleSelectAll}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          color: allSelected
                            ? "var(--accent)"
                            : someSelected
                            ? "var(--accent)"
                            : "var(--text-muted)",
                        }}
                        title={allSelected ? "取消全选" : "全选"}
                      >
                        {allSelected ? (
                          <CheckSquare size={16} />
                        ) : someSelected ? (
                          <CheckSquare size={16} />
                        ) : (
                          <SquareIcon size={16} />
                        )}
                      </button>
                    </th>
                    <th style={{ width: 56 }}>编号</th>
                    <th style={{ width: 56, whiteSpace: "nowrap" }}>类型</th>
                    <th style={{ width: 180 }}>标题</th>
                    <th style={{ width: 80, whiteSpace: "nowrap" }}>来源</th>
                    <th style={{ width: 90 }}>状态</th>
                    <th style={{ width: 140 }}>进度</th>
                    <th style={{ width: 90, whiteSpace: "nowrap" }}>分片/数量</th>
                    <th style={{ width: 90, whiteSpace: "nowrap" }}>文件大小</th>
                    <th style={{ width: 180, whiteSpace: "nowrap" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task) => {
                    const isSelected = selectedIds.has(task.ID);
                    const isGallery = task.TaskType === 'gallery';
                    const canStart = !isGallery
                      ? (task.Status === "pending" || task.Status === "paused")
                      : (task.Status === "failed" || task.Status === "pending");
                    const canPause = !isGallery && task.Status === "downloading";
                    const canCancel = !isGallery &&
                      (task.Status === "downloading" ||
                      task.Status === "paused" ||
                      task.Status === "pending");
                    const canRetry = task.Status === "failed";
                    const canDelete = true;
                    const idStr = String(task.ID);
                    const idDisplay =
                      idStr.length > 8
                        ? idStr.slice(0, 8) + "..."
                        : idStr;
                    const titleDisplay = isGallery
                      ? (task.GalleryTitle || task.URL)
                      : (task.VideoInfo?.Title || task.URL);
                    const urlDisplay =
                      titleDisplay.length > 30
                        ? titleDisplay.slice(0, 27) + "..."
                        : titleDisplay;
                    const progress = task.Progress;
                    const progressPct = progress.toFixed(1) + "%";
                    const fillClass =
                      task.Status === "completed"
                        ? "completed"
                        : task.Status === "failed" || task.Status === "cancelled"
                        ? "failed"
                        : "";

                    return (
                      <Fragment key={task.ID}>
                        <tr
                          onClick={() => toggleExpand(task.ID)}
                          style={{
                            cursor: "pointer",
                            background: isSelected
                              ? "var(--accent-soft)"
                              : undefined,
                          }}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => toggleSelect(task.ID)}
                              style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                color: isSelected
                                  ? "var(--accent)"
                                  : "var(--text-muted)",
                              }}
                            >
                              {isSelected ? (
                                <CheckSquare size={16} />
                              ) : (
                                <SquareIcon size={16} />
                              )}
                            </button>
                          </td>
                          <td
                            style={{
                              fontFamily: "monospace",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {idDisplay}
                          </td>
                          <td>
                            {isGallery ? (
                              <span
                                title="图库任务"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 28,
                                  height: 28,
                                  borderRadius: 6,
                                  background: "var(--accent-soft)",
                                  color: "var(--accent)",
                                }}
                              >
                                <ImageIcon size={15} />
                              </span>
                            ) : (
                              <span
                                title="视频任务"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 28,
                                  height: 28,
                                  borderRadius: 6,
                                  background: "var(--bg-inset)",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                <Film size={15} />
                              </span>
                            )}
                          </td>
                          <td
                            style={{
                              maxWidth: 180,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={titleDisplay}
                          >
                            {urlDisplay}
                          </td>
                          <td>
                            {(() => {
                              const srcUrl = task.VideoInfo?.SourceURL || task.URL || "";
                              const site = SITES.find((s) => {
                                try {
                                  const host = new URL(s.baseUrl).hostname.toLowerCase();
                                  return (
                                    srcUrl.toLowerCase().includes(host) ||
                                    srcUrl.toLowerCase().includes(s.id)
                                  );
                                } catch {
                                  return srcUrl.toLowerCase().includes(s.id);
                                }
                              });
                              return site ? (
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: 11,
                                    background: site.badge.gradient,
                                    color: site.badge.textColor,
                                  }}
                                >
                                  {site.nameCn}
                                </span>
                              ) : (
                                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                              );
                            })()}
                          </td>
                          <td>
                            <span className={`status-pill status-pill-${task.Status}`}>
                              {STATUS_LABEL[task.Status] ?? task.Status}
                            </span>
                          </td>
                          <td>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <div className="progress-bar" style={{ minWidth: 60 }}>
                                <div
                                  className={`progress-bar-fill ${fillClass}`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                              <span className="progress-text">
                                {progressPct}
                              </span>
                            </div>
                          </td>
                          <td style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                            {isGallery ? (
                              <span title={`图片 ${task.ImageCount ?? 0} / 视频 ${task.VideoCount ?? 0}`}>
                                {task.ImageCount || 0}P{task.VideoCount || 0}V
                              </span>
                            ) : task.TotalSegments ? (
                              `${task.Segment ?? 0}/${task.TotalSegments}`
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                            {isGallery ? (
                              task.FilePath ? task.FilePath.split(/[/\\]/).pop() || "—" : "—"
                            ) : task.VideoInfo?.FileSize ? (
                              `${(task.VideoInfo.FileSize / 1024 / 1024).toFixed(1)} MB`
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <div className="action-buttons">
                              {canStart && (
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAction(task.ID, "start");
                                  }}
                                  title="开始"
                                >
                                  <Play size={14} />
                                </button>
                              )}
                              {canPause && (
                                <button
                                  className="btn btn-warning btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAction(task.ID, "pause");
                                  }}
                                  title="暂停"
                                >
                                  <Pause size={14} />
                                </button>
                              )}
                              {canCancel && (
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAction(task.ID, "cancel");
                                  }}
                                  title="取消"
                                >
                                  <Square size={14} />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(task.ID);
                                  }}
                                  title="删除"
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                              {canRetry && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleAction(task.ID, "retry");
                                  }}
                                  title="重试"
                                >
                                  <RotateCw size={14} />
                                </button>
                              )}
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
        </div>

        {/* 添加任务弹窗（含链接导入和批量搜索） */}
        {showAddModal && (
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>添加任务</h2>
                <button className="btn-close" onClick={() => setShowAddModal(false)}>
                  <X size={18} />
                </button>
              </div>
              <div className="modal-body">
                <div className="tasks-tabs">
                  <button
                    className={`tasks-tab ${addTab === "link" ? "active" : ""}`}
                    onClick={() => setAddTab("link")}
                  >
                    链接导入
                  </button>
                  <button
                    className={`tasks-tab ${addTab === "search" ? "active" : ""}`}
                    onClick={() => setAddTab("search")}
                  >
                    批量搜索
                  </button>
                </div>

                {addTab === "link" ? (
                  <div>
                    <div className="form-group" style={{ marginBottom: 12 }}>
                      <label>
                        链接
                        {parsedUrls.length > 0 && (
                          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)" }}>
                            已识别 {parsedUrls.length} 个
                          </span>
                        )}
                      </label>
                      <textarea
                        className="form-control"
                        placeholder="粘贴 M3U8 链接、视频页面或图库页面地址，多个链接换行分隔"
                        value={linkInput}
                        onChange={(e) => setLinkInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmit();
                          }
                        }}
                        rows={5}
                        style={{
                          width: "100%",
                          resize: "vertical",
                          minHeight: 100,
                          fontSize: 13,
                          fontFamily: "var(--font-mono), ui-monospace, monospace",
                        }}
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleSubmit}
                      disabled={parsedUrls.length === 0}
                      style={{ width: "100%", height: 38 }}
                    >
                      {parsedUrls.length > 1
                        ? `批量导入（${parsedUrls.length} 个）`
                        : "添加任务"}
                    </button>
                  </div>
                ) : (
                  <BatchSearchPanel onJobCompleted={fetchTasks} embedded />
                )}
              </div>
            </div>
          </div>
        )}

        {/* 任务详情悬浮窗 */}
        {expandedTask !== null && (() => {
          const task = tasks.find((t) => t.ID === expandedTask);
          if (!task) return null;
          const isGalleryTask = task.TaskType === 'gallery';
          return (
            <div className="task-detail-overlay" onClick={() => setExpandedTask(null)}>
              <div className="task-detail-popover" onClick={(e) => e.stopPropagation()}>
                <div className="task-detail-popover-header">
                  <span className="task-detail-popover-title">
                    {isGalleryTask ? '图库' : '任务'}详情 #{task.ID}
                  </span>
                  <button
                    className="btn-close"
                    onClick={() => setExpandedTask(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="task-detail-popover-body">
                  <div className="task-detail-grid">
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">{isGalleryTask ? '源页面' : '视频链接'}</span>
                      <span className="task-detail-value task-detail-value-with-copy">
                        <span className="task-detail-value-text">{task.URL}</span>
                        <button
                          className="btn-copy-inline"
                          onClick={() => {
                            navigator.clipboard.writeText(task.URL);
                            toast.success("已复制");
                          }}
                          title="复制"
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                    </div>
                    {task.M3U8URL && (
                      <div className="task-detail-item full-width">
                        <span className="task-detail-label">M3U8 链接</span>
                        <span className="task-detail-value task-detail-value-with-copy">
                          <span className="task-detail-value-text">{task.M3U8URL}</span>
                          <button
                            className="btn-copy-inline"
                            onClick={() => {
                              navigator.clipboard.writeText(task.M3U8URL);
                              toast.success("已复制");
                            }}
                            title="复制"
                          >
                            <Copy size={13} />
                          </button>
                        </span>
                      </div>
                    )}
                    {task.FilePath && (
                      <div className="task-detail-item full-width">
                        <span className="task-detail-label">{isGalleryTask ? '保存路径' : '文件路径'}</span>
                        <span className="task-detail-value task-detail-value-with-copy">
                          <span className="task-detail-value-text">{task.FilePath}</span>
                          <button
                            className="btn-copy-inline"
                            onClick={() => {
                              navigator.clipboard.writeText(task.FilePath!);
                              toast.success("已复制");
                            }}
                            title="复制"
                          >
                            <Copy size={13} />
                          </button>
                        </span>
                      </div>
                    )}
                    {isGalleryTask && task.GalleryTitle && (
                      <div className="task-detail-item full-width">
                        <span className="task-detail-label">图库标题</span>
                        <span className="task-detail-value task-detail-value-with-copy">
                          <span className="task-detail-value-text">{task.GalleryTitle}</span>
                          <button
                            className="btn-copy-inline"
                            onClick={() => {
                              navigator.clipboard.writeText(task.GalleryTitle!);
                              toast.success("已复制");
                            }}
                            title="复制"
                          >
                            <Copy size={13} />
                          </button>
                        </span>
                      </div>
                    )}
                    {isGalleryTask && (task.ImageCount !== undefined || task.VideoCount !== undefined) && (
                      <div className="task-detail-row full-width">
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">图片数量</span>
                          <span className="task-detail-value">{task.ImageCount ?? 0} 张</span>
                        </div>
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">视频数量</span>
                          <span className="task-detail-value">{task.VideoCount ?? 0} 个</span>
                        </div>
                      </div>
                    )}
                    {isGalleryTask && task.DownloadMethod && task.DownloadMethod !== 'pending' && (
                      <div className="task-detail-item">
                        <span className="task-detail-label">下载方式</span>
                        <span className="task-detail-value">
                          {task.DownloadMethod === 'zip' ? 'ZIP 压缩包' :
                           task.DownloadMethod === 'scrape' ? '逐张爬取' :
                           task.DownloadMethod === 'both' ? 'ZIP + 爬取' : task.DownloadMethod}
                        </span>
                      </div>
                    )}
                    {task.ErrorMsg && (
                      <div className="task-detail-item full-width">
                        <span className="task-detail-label">错误信息</span>
                        <span
                          className="task-detail-value"
                          style={{ color: "var(--danger)" }}
                        >
                          {task.ErrorMsg}
                        </span>
                      </div>
                    )}
                    {task.VideoInfo?.Title && (
                      <div className="task-detail-item full-width">
                        <span className="task-detail-label">视频标题</span>
                        <span className="task-detail-value task-detail-value-with-copy">
                          <span className="task-detail-value-text">{task.VideoInfo.Title}</span>
                          <button
                            className="btn-copy-inline"
                            onClick={() => {
                              navigator.clipboard.writeText(task.VideoInfo!.Title!);
                              toast.success("已复制");
                            }}
                            title="复制"
                          >
                            <Copy size={13} />
                          </button>
                        </span>
                      </div>
                    )}
                    <div className="task-detail-row full-width">
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">分类</span>
                        <span className="task-detail-value">
                          {task.VideoInfo?.Categories && task.VideoInfo.Categories.length > 0 ? (
                            <div className="task-detail-tags">
                              {task.VideoInfo.Categories.map((cat) => (
                                <span
                                  key={cat}
                                  className="pill pill-clickable"
                                  onClick={() => {
                                    navigator.clipboard.writeText(cat);
                                    toast.success("已复制");
                                  }}
                                >
                                  {cat}
                                </span>
                              ))}
                            </div>
                          ) : "—"}
                        </span>
                      </div>
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">标签</span>
                        <span className="task-detail-value">
                          {task.VideoInfo?.Tags && task.VideoInfo.Tags.length > 0 ? (
                            <div className="task-detail-tags">
                              {task.VideoInfo.Tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="pill pill-clickable"
                                  onClick={() => {
                                    navigator.clipboard.writeText(tag);
                                    toast.success("已复制");
                                  }}
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : "—"}
                        </span>
                      </div>
                    </div>
                    {task.VideoInfo?.Actors && task.VideoInfo.Actors.length > 0 && (
                      <div className="task-detail-item full-width">
                        <span className="task-detail-label">演员</span>
                        <span className="task-detail-value">{task.VideoInfo.Actors.join("、")}</span>
                      </div>
                    )}
                    {task.VideoInfo?.Director && (
                      <div className="task-detail-item">
                        <span className="task-detail-label">导演/系列</span>
                        <span className="task-detail-value">{task.VideoInfo.Director}</span>
                      </div>
                    )}
                    {(task.VideoInfo?.Duration || task.VideoInfo?.Resolution || task.VideoInfo?.FileSize || task.CreatedAt) && (
                      <>
                        <div className="task-detail-divider" />
                        <div className="task-detail-info-bar">
                          {task.VideoInfo?.Duration ? (
                            <div className="info-bar-item">
                              <Clock size={14} className="info-bar-icon" />
                              <span className="info-bar-text">{task.VideoInfo.Duration} 分钟</span>
                            </div>
                          ) : null}
                          {task.VideoInfo?.Resolution && (
                            <div className="info-bar-item">
                              <Monitor size={14} className="info-bar-icon" />
                              <span className="info-bar-text">{task.VideoInfo.Resolution}</span>
                            </div>
                          )}
                          {task.VideoInfo?.FileSize ? (
                            <div className="info-bar-item">
                              <HardDrive size={14} className="info-bar-icon" />
                              <span className="info-bar-text">{(task.VideoInfo.FileSize / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                          ) : null}
                          {task.CreatedAt && (
                            <div className="info-bar-item">
                              <Calendar size={14} className="info-bar-icon" />
                              <span className="info-bar-text">{new Date(task.CreatedAt).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    start: "开始",
    pause: "暂停",
    resume: "继续",
    cancel: "取消",
    retry: "重试",
    delete: "删除",
  };
  return map[action] ?? action;
}
