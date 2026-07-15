﻿"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Play,
  Pause,
  Square,
  Trash2,
  RotateCw,
  Inbox,
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
  Radar,
  Link as LinkIcon,
  Search as SearchIcon,
  ClipboardPaste,
  FileText,
  Settings,
} from "lucide-react";
import type { TaskStatus, DownloadTask } from "@/types";
import { useTaskStore } from "@/store/task-store";
import ResourceToolbar from "@/components/ui/resource-toolbar";
import BatchSearchPanel from "@/components/tasks/batch-search-panel";
import TaskSettingsPanel from "@/components/tasks/task-settings-panel";
import { useRouteState } from "@/lib/core/route-state";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import { getSiteModuleByUrl } from "@/lib/sites/site-modules";

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "等待中",
  scraping: "识别中",
  downloading: "下载中",
  paused: "已暂停",
  completed: "已完成",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
  transcoding: "转码中",
};

type StatusFilter = "all" | TaskStatus;
type TypeFilter = "all" | "video" | "gallery" | "sniff";
type SortBy = "date_desc" | "date_asc" | "progress_desc" | "progress_asc" | "status";

const TYPE_PILLS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "gallery", label: "图包" },
  { value: "sniff", label: "嗅探" },
];

const FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "scraping", label: "识别中" },
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
  scraping: 0,
  downloading: 1,
  pending: 2,
  paused: 3,
  transcoding: 4,
  failed: 5,
  cancelled: 6,
  partial: 7,
  completed: 8,
};

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 从标题中去除人物名前缀
 * 如果标题以人物名开头，去除人物名及后续的分隔符（-、—、–）
 */
function stripPersonFromTitle(title: string, person?: string): string {
  if (!title || !person) return title;
  if (title.startsWith(person)) {
    const after = title.slice(person.length);
    return after.replace(/^[\s\-\u2013\u2014]+/, "").trim() || title;
  }
  return title;
}

/**
 * 根据任务状态和进度推断当前处理阶段
 *
 */
function getProgressStage(task: DownloadTask): string {
  if (task.TaskType === "sniff") {
    if (task.Status === "scraping") return "分析中";
    if (task.Status === "completed") return "已完成";
    if (task.Status === "failed") return "失败";
    return "等待中";
  }
  if (task.Status === "scraping") return "识别中";
  if (task.Status === "completed") return "已完成";
  if (task.Status === "failed") return "失败";
  if (task.Status === "cancelled") return "已取消";
  if (task.Status === "paused") return "已暂停";
  if (task.TaskType === "gallery") return "下载中";
  if (task.Progress >= 99) return "探测中";
  if (task.Progress >= 97) return "转码中";
  if (task.Progress >= 95) return "合并中";
  return "下载中";
}

export default function TasksPage(): React.JSX.Element {
  const { tasks, loading, fetchTasks, connectSSE } = useTaskStore();
  const pathname = usePathname();
  const { savedData, saveState } = useRouteState(pathname, {
    ttl: 5 * 60 * 1000,
    saveScroll: true,
  });

  const { values: urlValues, update: updateUrl } = useUrlState({
    status: "all",
    type: "all",
    sort: "date_desc",
    task: "",
  });
  const [searchQuery, setSearchQuery] = useDebouncedUrlParam("q", "");

  const statusFilter = urlValues.status as StatusFilter;
  const typeFilter = (urlValues.type as TypeFilter) || "all";
  const sortBy = urlValues.sort as SortBy;
  const expandedTask = (urlValues.task as string) || null;

  const setStatusFilter = useCallback(
    (v: StatusFilter) => updateUrl({ status: v === "all" ? null : v }),
    [updateUrl]
  );
  const setTypeFilter = useCallback(
    (v: TypeFilter) => updateUrl({ type: v === "all" ? null : v }),
    [updateUrl]
  );
  const setSortBy = useCallback(
    (v: SortBy) => updateUrl({ sort: v === "date_desc" ? null : v }),
    [updateUrl]
  );
  const setExpandedTask = useCallback(
    (key: string | null) => updateUrl({ task: key }),
    [updateUrl]
  );

  const [linkInput, setLinkInput] = useState("");
  const [addTab, setAddTab] = useState<"link" | "search">(
    () => (savedData?.addTab as "link" | "search") ?? "link"
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  useEffect(() => {
    saveState({ addTab });
  }, [addTab, saveState]);

  useEffect(() => {
    fetchTasks();
    const unsub = connectSSE();
    return () => unsub();
  }, [fetchTasks, connectSSE]);

  // 嗅探任务事件 Toast 通知
  const { sniffTaskEventId, lastSniffTaskEvent } = useTaskStore();
  useEffect(() => {
    if (sniffTaskEventId === 0 || !lastSniffTaskEvent) return;
    const evt = lastSniffTaskEvent;
    if (evt.action === 'galleryCreated') {
      toast.info(`嗅探任务：已发现 ${evt.totalCreated ?? 0} 个图包，跳过 ${evt.totalSkipped ?? 0} 个已完成`);
    }
  }, [sniffTaskEventId, lastSniffTaskEvent]);

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

    if (typeFilter === "video") {
      result = result.filter((t) => t.TaskType !== "gallery" && t.TaskType !== "sniff");
    } else if (typeFilter === "gallery") {
      result = result.filter((t) => t.TaskType === "gallery");
    } else if (typeFilter === "sniff") {
      result = result.filter((t) => t.TaskType === "sniff");
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) =>
          (t.VideoInfo?.Title || "").toLowerCase().includes(q) ||
          (t.GalleryTitle || "").toLowerCase().includes(q) ||
          t.URL.toLowerCase().includes(q) ||
          (t.M3U8URL || "").toLowerCase().includes(q) ||
          (t.Person || "").toLowerCase().includes(q)
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
  }, [tasks, statusFilter, typeFilter, searchQuery, sortBy]);

  const parsedUrls = useMemo(() => {
    return linkInput
      .split(/[\n\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
  }, [linkInput]);

  const totalInputLines = useMemo(() => {
    if (!linkInput.trim()) return 0;
    return linkInput
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length;
  }, [linkInput]);

  const handleSubmit = (): void => {
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
          if (data?.type === "sniff") {
            const placeholder: DownloadTask = {
              ID: data.sniffId,
              DisplayID: data.seq,
              URL: u,
              M3U8URL: "",
              Status: "scraping",
              Progress: 0,
              FilePath: "",
              Format: "",
              Priority: 0,
              ErrorMsg: "",
              CreatedAt: new Date().toISOString(),
              UpdatedAt: new Date().toISOString(),
              TaskType: "sniff",
              SniffTotalFound: 0,
              SniffTotalCreated: 0,
              SniffTotalSkipped: 0,
            };
            useTaskStore.getState().addTask(placeholder);
            const sId = data.seq ?? `#${data.sniffId}`;
            toast.success(`嗅探任务 ${sId} 已创建，正在分析列表页...`);
          } else if (data?.type === "gallery") {
            const placeholder: DownloadTask = {
              ID: data.galleryId,
              DisplayID: data.seq,
              URL: u,
              M3U8URL: "",
              Status: "scraping",
              Progress: 0,
              FilePath: "",
              Format: "",
              Priority: 0,
              ErrorMsg: "",
              CreatedAt: new Date().toISOString(),
              UpdatedAt: new Date().toISOString(),
              TaskType: "gallery",
              GalleryTitle: "",
              ImageCount: 0,
              VideoCount: 0,
              DownloadMethod: "pending",
            };
            useTaskStore.getState().addTask(placeholder);
            toast.success(`图包 #${data.seq ?? data.galleryId} 已创建，正在识别...`);
          } else if (data?.ID) {
            useTaskStore.getState().addTask(data as DownloadTask);
            toast.success(`任务 #${data.DisplayID ?? data.ID} 已创建，正在识别...`);
          }
        })
        .catch((err) => {
          toast.error(`添加失败: ${err.message}`);
        });
    }
  };

  const handleAction = useCallback(
    async (task: DownloadTask, action: string) => {
      const isGallery = task.TaskType === 'gallery';
      const isSniff = task.TaskType === 'sniff';
      const taskId = task.ID;
      try {
        let endpoint: string;
        if (isSniff) {
          if (action === 'delete') {
            endpoint = `/api/tasks/sniff/${taskId}`;
          } else {
            toast.warning(`嗅探任务不支持${actionLabel(action)}操作`);
            return;
          }
        } else if (isGallery) {
          if (action === 'start') {
            endpoint = `/api/gallery/${taskId}/download`;
          } else if (action === 'retry') {
            endpoint = `/api/gallery/${taskId}/retry-failed`;
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
        const label = isSniff ? '嗅探任务' : isGallery ? '图包' : '任务';
        toast.success(`${label} #${task.DisplayID ?? taskId} 已${actionLabel(action)}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
      }
    },
    []
  );

  const handleDelete = useCallback(
    async (task: DownloadTask) => {
      const isGallery = task.TaskType === 'gallery';
      const isSniff = task.TaskType === 'sniff';
      const taskId = task.ID;
      const taskType = isSniff ? 'sniff' : isGallery ? 'gallery' : 'video';
      const label = isSniff ? '嗅探任务' : isGallery ? '图包' : '任务';
      if (!confirm(`确认删除${label} #${task.DisplayID ?? taskId}？`)) return;

      useTaskStore.getState().removeTask(taskId, taskType);

      try {
        const endpoint = isSniff ? `/api/tasks/sniff/${taskId}` : isGallery ? `/api/gallery/${taskId}` : `/api/tasks/${taskId}`;
        const res = await fetch(endpoint, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text());
        toast.success(`已删除${label} #${task.DisplayID ?? taskId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
        // 删除失败：清除删除标记并重新拉取，让任务回到列表中
        useTaskStore.getState().clearDeletedKey(taskId, taskType);
        fetchTasks();
      }
    },
    [fetchTasks]
  );

  const handleBatchAction = useCallback(
    async (action: string) => {
      if (selectedIds.size === 0) {
        toast.error("请先选择任务");
        return;
      }
      const keys = Array.from(selectedIds);
      const isDelete = action === "delete";

      if (isDelete && !confirm(`确认批量删除 ${keys.length} 个任务？`)) return;

      if (isDelete) {
        const selectedTasks = keys
          .map((key) => tasks.find((t) => `${t.TaskType || 'video'}-${t.ID}` === key))
          .filter((t): t is DownloadTask => !!t);

        selectedTasks.forEach((task) => {
          const taskType = task.TaskType === 'sniff' ? 'sniff' : task.TaskType === 'gallery' ? 'gallery' : 'video';
          useTaskStore.getState().removeTask(task.ID, taskType);
        });

        const results = await Promise.allSettled(
          selectedTasks.map((task) => {
            const isGallery = task.TaskType === 'gallery';
            const isSniff = task.TaskType === 'sniff';
            const endpoint = isSniff
              ? `/api/tasks/sniff/${task.ID}`
              : isGallery
                ? `/api/gallery/${task.ID}`
                : `/api/tasks/${task.ID}`;
            return fetch(endpoint, { method: "DELETE" });
          })
        );

        const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
        const fail = results.length - ok;
        setSelectedIds(new Set());
        if (fail === 0) {
          toast.success(`批量删除完成：${ok} 个`);
        } else {
          toast.warning(`完成：${ok} 成功，${fail} 失败`);
          results.forEach((r, i) => {
            if (r.status !== 'fulfilled' || !r.value.ok) {
              const task = selectedTasks[i];
              const taskType = task.TaskType === 'sniff' ? 'sniff' : task.TaskType === 'gallery' ? 'gallery' : 'video';
              useTaskStore.getState().clearDeletedKey(task.ID, taskType);
            }
          });
          fetchTasks();
        }
        return;
      }

      // 非删除操作：并行处理 + 智能过滤
      const selectedTasks = keys
        .map((key) => tasks.find((t) => `${t.TaskType || 'video'}-${t.ID}` === key))
        .filter((t): t is DownloadTask => !!t);

      // 按任务类型和操作类型分类
      const applicable: DownloadTask[] = [];
      let skipped = 0;

      for (const task of selectedTasks) {
        const isGallery = task.TaskType === 'gallery';
        const isSniff = task.TaskType === 'sniff';

        if (isSniff) {
          skipped++;
          continue;
        }

        if (isGallery) {
          // Gallery 仅支持 start/retry
          if (action === 'start' || action === 'retry') {
            applicable.push(task);
          } else {
            skipped++;
          }
          continue;
        }

        // 视频任务：按操作和状态过滤
        const status = task.Status;
        if (action === 'pause' && !['downloading', 'scraping'].includes(status || '')) {
          skipped++;
        } else if (action === 'start' && !['pending', 'paused', 'failed', 'cancelled'].includes(status || '')) {
          skipped++;
        } else if (action === 'retry' && !['failed', 'cancelled'].includes(status || '')) {
          skipped++;
        } else if (action === 'cancel' && !['downloading', 'paused', 'pending', 'scraping'].includes(status || '')) {
          skipped++;
        } else {
          applicable.push(task);
        }
      }

      if (applicable.length === 0) {
        toast.info(`没有可${actionLabel(action)}的任务（${skipped} 个已跳过）`);
        return;
      }

      const results = await Promise.allSettled(
        applicable.map((task) => {
          const isGallery = task.TaskType === 'gallery';
          const id = task.ID;
          if (isGallery) {
            if (action === 'start') {
              return fetch(`/api/gallery/${id}/download`, { method: "POST" });
            }
            if (action === 'retry') {
              return fetch(`/api/gallery/${id}/retry-failed`, { method: "POST" });
            }
          }
          // 批量开始对 failed/cancelled 任务使用 retry 端点（重置进度和错误信息）
          if (action === 'start' && ['failed', 'cancelled'].includes(task.Status || '')) {
            return fetch(`/api/tasks/${id}/retry`, { method: "POST" });
          }
          return fetch(`/api/tasks/${id}/${action}`, { method: "POST" });
        })
      );

      const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
      const fail = results.length - ok;

      if (fail === 0 && skipped === 0) {
        toast.success(`批量${actionLabel(action)}完成：${ok} 个`);
      } else if (fail === 0) {
        toast.success(`批量${actionLabel(action)}完成：${ok} 个${skipped > 0 ? `，${skipped} 个跳过` : ''}`);
      } else {
        toast.warning(`完成：${ok} 成功，${fail} 失败${skipped > 0 ? `，${skipped} 个跳过` : ''}`);
      }
    },
    [selectedIds, tasks]
  );

  const toggleExpand = (task: DownloadTask): void => {
    const key = task.DisplayID ?? String(task.ID);
    setExpandedTask(expandedTask === key ? null : key);
  };

  const toggleSelect = (key: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = (): void => {
    if (selectedIds.size === filteredTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map((t) => `${t.TaskType || 'video'}-${t.ID}`)));
    }
  };

  const allSelected = selectedIds.size > 0 && selectedIds.size === filteredTasks.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <ResourceToolbar
          primaryFilters={TYPE_PILLS}
          primaryFilterValue={typeFilter}
          onPrimaryFilterChange={(v) => setTypeFilter(v as TypeFilter)}
          secondaryFilters={FILTER_PILLS.map((p) => ({ ...p, count: statusCounts[p.value] || 0 }))}
          secondaryFilterValue={statusFilter}
          onSecondaryFilterChange={(v) => setStatusFilter(v as StatusFilter)}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="搜索标题或链接..."
          sortOptions={SORT_OPTIONS}
          sortValue={sortBy}
          onSortChange={(v) => setSortBy(v as SortBy)}
        >
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={14} />
            添加任务
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowSettingsPanel(true)}
            title="任务设置"
          >
            <Settings size={14} />
            任务设置
          </button>
        </ResourceToolbar>

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
              className="btn btn-outline btn-sm"
              onClick={() => handleBatchAction("retry")}
              title="重试失败/已取消的任务"
            >
              <RotateCw size={12} />
              批量重试
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
                  <th style={{ width: 48, whiteSpace: "nowrap" }}>类型</th>
                  <th style={{ width: 100 }}>人物</th>
                  <th style={{ width: 300 }}>标题</th>
                  <th style={{ width: 64, whiteSpace: "nowrap" }}>来源</th>
                  <th style={{ width: 68 }}>状态</th>
                  <th style={{ width: 140 }}>进度</th>
                  <th style={{ width: 80, whiteSpace: "nowrap" }}>分片/数量</th>
                  <th style={{ width: 80, whiteSpace: "nowrap" }}>文件大小</th>
                  <th style={{ width: 190, whiteSpace: "nowrap" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((task) => {
                  const isSelected = selectedIds.has(`${task.TaskType || 'video'}-${task.ID}`);
                  const isGallery = task.TaskType === 'gallery';
                  const isSniff = task.TaskType === 'sniff';
                  const isIdentifying = task.Status === 'scraping';
                  const canStart = !isGallery && !isSniff
                    ? (task.Status === "pending" || task.Status === "paused")
                    : (task.Status === "failed" || task.Status === "pending");
                  const canPause = !isGallery && !isSniff && task.Status === "downloading";
                  const canCancel = !isGallery && !isSniff &&
                    (task.Status === "downloading" ||
                      task.Status === "paused" ||
                      task.Status === "pending" ||
                      task.Status === "scraping");
                  const canRetry = !isSniff && task.Status === "failed";
                  const canRetryPartial = isGallery && task.Status === "partial";
                  const canDelete = true;
                  const idStr = String(task.DisplayID ?? task.ID);
                  const idDisplay =
                    idStr.length > 8
                      ? idStr.slice(0, 8) + "..."
                      : idStr;

                  const rawTitle = isSniff
                    ? task.URL
                    : isGallery
                      ? stripPersonFromTitle(task.GalleryTitle || "", task.Person)
                      : (task.VideoInfo?.Title || "");
                  const titleDisplay = isIdentifying && !rawTitle
                    ? "识别中..."
                    : (rawTitle || task.URL);
                  const progress = task.Progress;
                  const progressPct = progress.toFixed(1) + "%";
                  const stage = getProgressStage(task);
                  const fillClass =
                    task.Status === "completed"
                      ? "completed"
                      : task.Status === "failed" || task.Status === "cancelled"
                        ? "failed"
                        : isIdentifying
                          ? ""
                          : "";

                  const siteModule = getSiteModuleByUrl(
                    task.VideoInfo?.SourceURL || task.URL || ""
                  );

                  return (
                    <Fragment key={`${task.TaskType || 'video'}-${task.ID}`}>
                      <tr
                        onClick={() => toggleExpand(task)}
                        style={{
                          cursor: "pointer",
                          background: isSelected
                            ? "var(--accent-soft)"
                            : isSniff
                              ? "rgba(99, 102, 241, 0.04)"
                              : undefined,
                        }}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => toggleSelect(`${task.TaskType || 'video'}-${task.ID}`)}
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
                            color: isSniff ? "#6366f1" : "var(--text-secondary)",
                            fontWeight: isSniff ? 700 : undefined,
                          }}
                        >
                          {idDisplay}
                        </td>
                        <td>
                          {isSniff ? (
                            <span
                              title="嗅探任务"
                              style={{ color: "#6366f1" }}
                            >
                              <Radar size={15} />
                            </span>
                          ) : isGallery ? (
                            <span
                              title="图库任务"
                              style={{ color: "var(--text-muted)" }}
                            >
                              <ImageIcon size={15} />
                            </span>
                          ) : (
                            <span
                              title="视频任务"
                              style={{ color: "var(--text-muted)" }}
                            >
                              <Film size={15} />
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            maxWidth: 120,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                            color: "var(--text-secondary)",
                          }}
                          title={task.Person || ""}
                        >
                          {task.Person || "—"}
                        </td>
                        <td
                          style={{
                            maxWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={titleDisplay}
                        >
                          {isIdentifying && !rawTitle ? (
                            <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                              {titleDisplay}
                            </span>
                          ) : (
                            titleDisplay
                          )}
                        </td>
                        <td>
                          {siteModule ? (
                            <span className="source-pill">
                              {siteModule.nameCn}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                          )}
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
                              flexDirection: "column",
                              gap: 3,
                              minWidth: 70,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--text-secondary)",
                                whiteSpace: "nowrap",
                                lineHeight: "16px",
                                fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
                              }}
                            >
                              {isIdentifying ? stage : progressPct}
                            </span>
                            <div className="progress-bar" style={{ width: "100%" }}>
                              <div
                                className={`progress-bar-fill ${fillClass} ${isIdentifying ? "progress-bar-indeterminate" : ""}`}
                                style={isIdentifying ? {} : { width: `${progress}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {isSniff ? (
                            <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>
                              {task.Status === 'completed' ? `发现 ${task.SniffTotalFound ?? 0}` : task.Status === 'scraping' ? `已发现 ${task.SniffTotalFound ?? 0}` : "—"}
                            </span>
                          ) : isIdentifying ? (
                            <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>识别中...</span>
                          ) : isGallery ? (
                            <span className="dual-capsule" title={`图片 ${task.ImageCount ?? 0} / 视频 ${task.VideoCount ?? 0}`}>
                              <span className="dual-capsule-left accent-green">{task.ImageCount || 0}P</span>
                              <span className="dual-capsule-right accent-orange">{task.VideoCount || 0}V</span>
                            </span>
                          ) : task.TotalSegments ? (
                            <span className="dual-capsule" title={`分片 ${task.Segment ?? 0} / ${task.TotalSegments}`}>
                              <span className="dual-capsule-left">{task.Segment ?? 0}</span>
                              <span className="dual-capsule-right">{task.TotalSegments}</span>
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                          {isSniff ? (
                            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                          ) : isGallery ? (
                            task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
                              ? formatFileSize(task.DownloadInfo.ActualSize)
                              : task.DownloadInfo?.FileSizeText
                                ? task.DownloadInfo.FileSizeText
                                : "—"
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
                                  handleAction(task, "start");
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
                                  handleAction(task, "pause");
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
                                  handleAction(task, "cancel");
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
                                  handleDelete(task);
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
                                  handleAction(task, "retry");
                                }}
                                title="重试"
                              >
                                <RotateCw size={14} />
                              </button>
                            )}
                            {canRetryPartial && (
                              <button
                                className="btn btn-outline btn-sm"
                                style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAction(task, "retry");
                                }}
                                title="重试失败文件"
                              >
                                <RotateCw size={14} />
                              </button>
                            )}
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                              const isGallery = task.TaskType === 'gallery';
                                const isSniff = task.TaskType === 'sniff';
                                const summary = {
                                  ID: task.ID,
                                  DisplayID: task.DisplayID,
                                  Type: isSniff ? '嗅探' : isGallery ? '图包' : '视频',
                                  Title: isGallery ? (task.GalleryTitle || '—') : (task.VideoInfo?.Title || '—'),
                                  URL: task.URL,
                                  M3U8URL: task.M3U8URL || undefined,
                                  Status: STATUS_LABEL[task.Status] ?? task.Status,
                                  Progress: `${task.Progress.toFixed(1)}%`,
                                  FilePath: task.FilePath || undefined,
                                  CreatedAt: task.CreatedAt ? new Date(task.CreatedAt).toLocaleString('zh-CN') : undefined,
                                  UpdatedAt: task.UpdatedAt ? new Date(task.UpdatedAt).toLocaleString('zh-CN') : undefined,
                                  ...(isSniff ? {
                                    SniffTotalFound: task.SniffTotalFound ?? 0,
                                    SniffTotalCreated: task.SniffTotalCreated ?? 0,
                                    SniffTotalSkipped: task.SniffTotalSkipped ?? 0,
                                  } : isGallery ? {
                                    ImageCount: task.ImageCount ?? 0,
                                    VideoCount: task.VideoCount ?? 0,
                                    DownloadMethod: task.DownloadMethod,
                                    DownloadInfo: task.DownloadInfo ? {
                                      FileSizeText: task.DownloadInfo.FileSizeText,
                                      ActualSize: task.DownloadInfo.ActualSize > 0 ? formatFileSize(task.DownloadInfo.ActualSize) : undefined,
                                      Provider: task.DownloadInfo.Provider,
                                      Status: task.DownloadInfo.Status,
                                      DownloadURL: task.DownloadInfo.DownloadURL,
                                      ZipFileName: task.DownloadInfo.ZipFileName || undefined,
                                      Parallelism: task.DownloadInfo.Parallelism || undefined,
                                      AvgSpeed: task.DownloadInfo.AvgSpeed || undefined,
                                      VerifiedCount: task.DownloadInfo.VerifiedCount || undefined,
                                      CountMatched: task.DownloadInfo.CountMatched,
                                    } : undefined,
                                  } : {
                                    Segment: task.Segment ?? undefined,
                                    TotalSegments: task.TotalSegments ?? undefined,
                                    FileSize: task.VideoInfo?.FileSize ? formatFileSize(task.VideoInfo.FileSize) : undefined,
                                    Duration: task.VideoInfo?.Duration ? `${task.VideoInfo.Duration} 分钟` : undefined,
                                    Resolution: task.VideoInfo?.Resolution || undefined,
                                    Tags: task.VideoInfo?.Tags?.length ? task.VideoInfo.Tags : undefined,
                                    Actors: task.VideoInfo?.Actors?.length ? task.VideoInfo.Actors : undefined,
                                  }),
                                  ErrorMsg: task.ErrorMsg || undefined,
                                };
                                navigator.clipboard.writeText(JSON.stringify(summary, null, 2)).then(
                                  () => toast.success(`已复制 #${task.DisplayID ?? task.ID} 数据`),
                                  () => toast.error("复制失败"),
                                );
                              }}
                              title="复制任务数据"
                            >
                              <Copy size={14} />
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
      </div>

      <TaskSettingsPanel
        open={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
      />

      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                <Plus size={18} style={{ flexShrink: 0 }} />
                添加任务
              </h2>
              <button className="btn-close" onClick={() => setShowAddModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-tab-bar">
                <button
                  className={`modal-tab ${addTab === "link" ? "active" : ""}`}
                  onClick={() => setAddTab("link")}
                >
                  <LinkIcon size={14} className="tab-icon" />
                  链接导入
                </button>
                <button
                  className={`modal-tab ${addTab === "search" ? "active" : ""}`}
                  onClick={() => setAddTab("search")}
                >
                  <SearchIcon size={14} className="tab-icon" />
                  批量搜索
                </button>
              </div>

              {addTab === "link" ? (
                <div>
                  <div className="modal-section">
                    <div className="modal-input-group">
                      <div className="modal-input-label">
                        <span>粘贴链接</span>
                        <div className="input-stats-bar">
                          <div className="input-stat-item stat-input">
                            <FileText size={14} className="stat-icon" />
                            <span className="stat-label">已输入</span>
                            <span className="stat-value">{totalInputLines}</span>
                            <span className="stat-label">行</span>
                          </div>
                          <div className={`input-stat-item ${parsedUrls.length > 0 ? "stat-detected" : "stat-input"}`}>
                            <LinkIcon size={14} className="stat-icon" />
                            <span className="stat-label">已识别</span>
                            <span className="stat-value">{parsedUrls.length}</span>
                            <span className="stat-label">个</span>
                          </div>
                        </div>
                      </div>
                      <textarea
                        className="form-control"
                        placeholder="支持 M3U8 直链、视频页面或图库页面地址，多个链接换行分隔"
                        value={linkInput}
                        onChange={(e) => setLinkInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmit();
                          }
                        }}
                        rows={8}
                        style={{
                          width: "100%",
                          resize: "vertical",
                          minHeight: 160,
                          fontSize: 13,
                          fontFamily: "var(--font-mono), ui-monospace, monospace",
                          lineHeight: 1.6,
                        }}
                      />
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 8,
                        }}
                      >
                        <p className="modal-input-hint" style={{ margin: 0 }}>
                          自动识别 HTTP(S) 链接，支持混合导入
                        </p>
                        <div className="quick-actions-bar" style={{ margin: 0 }}>
                          <button
                            className="quick-action-btn"
                            onClick={async () => {
                              try {
                                const text = await navigator.clipboard.readText();
                                setLinkInput((prev) => {
                                  const urls = text
                                    .split(/[\n\s,]+/)
                                    .map((s) => s.trim())
                                    .filter((s) => s.startsWith("http://") || s.startsWith("https://"));
                                  if (urls.length === 0) {
                                    toast.error("剪贴板中没有检测到有效链接");
                                    return prev;
                                  }
                                  const existing = prev
                                    .split(/[\n\s,]+/)
                                    .map((s) => s.trim())
                                    .filter((s) => s.startsWith("http"));
                                  const newUrls = urls.filter((u) => !existing.includes(u));
                                  if (newUrls.length === 0) {
                                    toast.info("所有链接已存在");
                                    return prev;
                                  }
                                  toast.success(`已粘贴 ${newUrls.length} 个新链接`);
                                  return prev ? prev + "\n" + newUrls.join("\n") : newUrls.join("\n");
                                });
                              } catch {
                                toast.error("无法读取剪贴板，请手动粘贴");
                              }
                            }}
                          >
                            <ClipboardPaste size={12} />
                            粘贴
                          </button>
                          <button
                            className="quick-action-btn"
                            onClick={() => {
                              setLinkInput("");
                              toast.info("已清空输入框");
                            }}
                            disabled={!linkInput}
                          >
                            <Trash2 size={12} />
                            清空
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    className="btn-block-primary"
                    onClick={handleSubmit}
                    disabled={parsedUrls.length === 0}
                    style={{ marginTop: 4 }}
                  >
                    {parsedUrls.length > 1
                      ? `批量导入 ${parsedUrls.length} 个任务`
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

      {expandedTask !== null && (() => {
        const task = tasks.find((t) => (t.DisplayID ?? String(t.ID)) === expandedTask);
        if (!task) return null;
        const isGalleryTask = task.TaskType === 'gallery';
        const isSniffTask = task.TaskType === 'sniff';
        return (
          <div className="task-detail-overlay" onClick={() => setExpandedTask(null)}>
            <div className="task-detail-popover" onClick={(e) => e.stopPropagation()}>
              <div className="task-detail-popover-header">
                <span className="task-detail-popover-title">
                  {isSniffTask ? '嗅探任务' : isGalleryTask ? '图包' : '任务'}详情 #{task.DisplayID ?? task.ID}
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
                  {isSniffTask && (
                    <>
                      <div className="task-detail-row full-width">
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">状态</span>
                          <span className="task-detail-value">{STATUS_LABEL[task.Status] ?? task.Status}</span>
                        </div>
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">发现图包</span>
                          <span className="task-detail-value">{task.SniffTotalFound ?? 0} 个</span>
                        </div>
                      </div>
                      <div className="task-detail-row full-width">
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">已创建任务</span>
                          <span className="task-detail-value">{task.SniffTotalCreated ?? 0} 个</span>
                        </div>
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">已跳过</span>
                          <span className="task-detail-value">{task.SniffTotalSkipped ?? 0} 个</span>
                        </div>
                      </div>
                      {task.Status === 'failed' && task.ErrorMsg && (
                        <div className="task-detail-item full-width">
                          <div className="failure-reason-card">
                            <div className="failure-reason-header">
                              <span className="failure-reason-icon">⚠</span>
                              <span className="failure-reason-title">失败原因</span>
                            </div>
                            <div className="failure-reason-content">
                              {task.ErrorMsg}
                            </div>
                          </div>
                        </div>
                      )}
                      {task.ErrorMsg && task.Status !== 'failed' && (
                        <div className="task-detail-item full-width">
                          <span className="task-detail-label">错误信息</span>
                          <span className="task-detail-value" style={{ color: "var(--danger)" }}>{task.ErrorMsg}</span>
                        </div>
                      )}
                      {task.CreatedAt && (
                        <div className="task-detail-item full-width">
                          <span className="task-detail-label">创建时间</span>
                          <span className="task-detail-value">{new Date(task.CreatedAt).toLocaleString('zh-CN')}</span>
                        </div>
                      )}
                    </>
                  )}
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
                  {task.Person && isGalleryTask && (
                    <div className="task-detail-item">
                      <span className="task-detail-label">主角</span>
                      <span className="task-detail-value">{task.Person}</span>
                    </div>
                  )}
                  {isGalleryTask && (task.ImageCount !== undefined || task.VideoCount !== undefined || (task.DownloadMethod && task.DownloadMethod !== 'pending')) && (
                    <div className="task-detail-row full-width">
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">图片数量</span>
                        <span className="task-detail-value">{task.ImageCount ?? 0} 张</span>
                      </div>
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">视频数量</span>
                        <span className="task-detail-value">{task.VideoCount ?? 0} 个</span>
                      </div>
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">下载方式</span>
                        <span className="task-detail-value">
                          {task.DownloadMethod === 'zip' ? 'ZIP 压缩包' :
                            task.DownloadMethod === 'scrape' ? '逐张爬取' :
                              task.DownloadMethod === 'both' ? 'ZIP + 爬取' : (task.DownloadMethod ?? '—')}
                        </span>
                      </div>
                    </div>
                    )}
                  {task.Status === 'failed' && task.ErrorMsg && (
                    <div className="task-detail-item full-width">
                      <div className="failure-reason-card">
                        <div className="failure-reason-header">
                          <span className="failure-reason-icon">⚠</span>
                          <span className="failure-reason-title">失败原因</span>
                        </div>
                        <div className="failure-reason-content">
                          {task.ErrorMsg}
                        </div>
                      </div>
                    </div>
                  )}
                  {task.ErrorMsg && task.Status !== 'failed' && (
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
                  {isGalleryTask && task.GalleryTitle && (
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">标签</span>
                      <span className="task-detail-value">
                        {task.GalleryTitle ? (
                          <div className="task-detail-tags">
                            {task.GalleryTitle.split(/[\s\-_,]+/).filter((t: string) => t.length > 1 && !/\d+P/i.test(t)).slice(0, 8).map((tag: string) => (
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
                  )}
                  {!isGalleryTask && (
                    <div className="task-detail-row full-width">
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
                  )}
                  {!isGalleryTask && task.VideoInfo?.Actors && task.VideoInfo.Actors.length > 0 && (
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">演员</span>
                      <span className="task-detail-value">{task.VideoInfo.Actors.join("、")}</span>
                    </div>
                  )}
                  {!isGalleryTask && task.VideoInfo?.Director && (
                    <div className="task-detail-item">
                      <span className="task-detail-label">导演/系列</span>
                      <span className="task-detail-value">{task.VideoInfo.Director}</span>
                    </div>
                  )}
                  {(task.VideoInfo?.Duration || task.VideoInfo?.Resolution || task.VideoInfo?.FileSize || task.CreatedAt || isGalleryTask) && (
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
                        {isGalleryTask && (
                          <div className="info-bar-item">
                            <HardDrive size={14} className="info-bar-icon" />
                            <span className="info-bar-text">
                              {task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
                                ? formatFileSize(task.DownloadInfo.ActualSize)
                                : task.DownloadInfo?.FileSizeText
                                  ? task.DownloadInfo.FileSizeText
                                  : '—'}
                            </span>
                          </div>
                        )}
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

function actionLabel(action: string): string {
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

function getUrlType(url: string): string {
  if (url.includes(".m3u8") || url.includes(".m3u")) return "M3U8";
  if (url.includes("/gallery/") || url.includes("/album/") || url.includes("photo")) return "图库";
  return "页面";
}

