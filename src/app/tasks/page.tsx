﻿"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
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
import { getSiteModuleByUrl, getSiteModuleName } from "@/lib/sites/site-modules";
import { useI18n } from "@/lib/i18n";
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
  TooltipPortal,
} from "@/components/ui/tooltip";

function useStatusLabel(t: (key: string, params?: Record<string, string | number>) => string): Record<TaskStatus, string> {
  return {
    pending: t("common.pending"),
    scraping: t("common.scraping"),
    downloading: t("common.downloading"),
    paused: t("common.paused"),
    completed: t("common.completed"),
    partial: t("common.partial"),
    failed: t("common.failed"),
    cancelled: t("common.cancelled"),
    transcoding: t("common.transcoding"),
  };
}

type StatusFilter = "all" | TaskStatus;
type TypeFilter = "all" | "video" | "gallery" | "sniff";
type SortBy = "date_desc" | "date_asc" | "progress_desc" | "progress_asc" | "status";

const TYPE_PILL_KEYS = [
  { value: "all", labelKey: "tasks.typeAll" },
  { value: "video", labelKey: "tasks.typeVideo" },
  { value: "gallery", labelKey: "tasks.typeGallery" },
  { value: "sniff", labelKey: "tasks.typeSniff" },
];

const FILTER_PILL_KEYS = [
  { value: "all", labelKey: "tasks.typeAll" },
  { value: "scraping", labelKey: "common.scraping" },
  { value: "pending", labelKey: "common.pending" },
  { value: "downloading", labelKey: "common.downloading" },
  { value: "completed", labelKey: "common.completed" },
  { value: "failed", labelKey: "common.failed" },
];

const SORT_OPTION_KEYS = [
  { value: "date_desc", labelKey: "tasks.sortDateDesc" },
  { value: "date_asc", labelKey: "tasks.sortDateAsc" },
  { value: "progress_desc", labelKey: "tasks.sortProgressDesc" },
  { value: "progress_asc", labelKey: "tasks.sortProgressAsc" },
  { value: "status", labelKey: "tasks.sortStatus" },
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
function getProgressStage(task: DownloadTask, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (task.TaskType === "sniff") {
    if (task.Status === "scraping") return t("tasks.progressStageAnalyzing");
    if (task.Status === "completed") return t("tasks.progressStageCompleted");
    if (task.Status === "failed") return t("tasks.progressStageFailed");
    return t("tasks.progressStagePending");
  }
  if (task.Status === "scraping") return t("tasks.progressStageScraping");
  if (task.Status === "completed") return t("tasks.progressStageCompleted");
  if (task.Status === "failed") return t("tasks.progressStageFailed");
  if (task.Status === "cancelled") return t("tasks.progressStageCancelled");
  if (task.Status === "paused") return t("tasks.progressStagePaused");
  if (task.TaskType === "gallery") return t("tasks.progressStageDownloading");
  if (task.Progress >= 99) return t("tasks.progressStageProbing");
  if (task.Progress >= 97) return t("tasks.progressStageTranscoding");
  if (task.Progress >= 95) return t("tasks.progressStageMerging");
  return t("tasks.progressStageDownloading");
}

export default function TasksPage(): React.JSX.Element {
  const { t, locale } = useI18n();
  const STATUS_LABEL = useStatusLabel(t);
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
      toast.info("tasks.sniffResults", { found: evt.totalCreated ?? 0, skipped: evt.totalSkipped ?? 0 });
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
      toast.error("tasks.pleaseInputValidLink");
      return;
    }

    setLinkInput("");
    setShowAddModal(false);

    const urls = [...parsedUrls];
    if (urls.length > 1) {
      toast.success("tasks.addingTasksInBackground", { count: urls.length });
    } else {
      toast.success("tasks.taskCreating");
    }

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
            toast.success("tasks.sniffTaskCreated", { id: sId });
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
            toast.success("tasks.galleryTaskCreated", { id: data.seq ?? data.galleryId });
          } else if (data?.ID) {
            useTaskStore.getState().addTask(data as DownloadTask);
            toast.success("tasks.videoTaskCreated", { id: data.DisplayID ?? data.ID });
          }
        })
        .catch((err) => {
          toast.error("tasks.addFailedShort", { error: err.message });
        });
    }
  };

  const handleAction = useCallback(
    async (task: DownloadTask, action: string) => {
      const isGallery = task.TaskType === 'gallery';
      const isSniff = task.TaskType === 'sniff';
      const taskId = task.ID;
      const taskKey = `${task.TaskType || 'video'}-${taskId}`;
      
      try {
        let endpoint: string;
        if (isSniff) {
          if (action === 'delete') {
            endpoint = `/api/tasks/sniff/${taskId}`;
          } else {
            toast.warning("tasks.sniffTaskNotSupported", { action: actionLabel(action, t) });
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
            toast.warning("tasks.galleryTaskNotSupported", { action: actionLabel(action, t) });
            return;
          }
        } else {
          endpoint = `/api/tasks/${taskId}/${action}`;
        }
        
        const method = action === 'delete' ? 'DELETE' : 'POST';
        
        const label = isSniff ? t("tasks.taskTypeSniff") : isGallery ? t("tasks.taskTypeGallery") : t("tasks.taskTypeTask");
        toast.info("tasks.taskActionSubmitting", { type: label, id: task.DisplayID ?? taskId, action: actionLabel(action, t) });
        
        const res = await fetch(endpoint, { method });
        if (!res.ok) throw new Error(await res.text());
        
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
      }
    },
    [t]
  );

  const handleDelete = useCallback(
    async (task: DownloadTask) => {
      const isGallery = task.TaskType === 'gallery';
      const isSniff = task.TaskType === 'sniff';
      const taskId = task.ID;
      const taskType = isSniff ? 'sniff' : isGallery ? 'gallery' : 'video';
      const label = isSniff ? t("tasks.taskTypeSniff") : isGallery ? t("tasks.taskTypeGallery") : t("tasks.taskTypeTask");
      if (!confirm(t("tasks.confirmDelete", { type: label, id: task.DisplayID ?? taskId }))) return;

      useTaskStore.getState().removeTask(taskId, taskType);

      try {
        const endpoint = isSniff ? `/api/tasks/sniff/${taskId}` : isGallery ? `/api/gallery/${taskId}` : `/api/tasks/${taskId}`;
        const res = await fetch(endpoint, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text());
        toast.success("tasks.deleted", { type: label, id: task.DisplayID ?? taskId });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
        useTaskStore.getState().clearDeletedKey(taskId, taskType);
        fetchTasks();
      }
    },
    [fetchTasks, t]
  );

  const handleBatchAction = useCallback(
    async (action: string) => {
      if (selectedIds.size === 0) {
        toast.error("tasks.pleaseSelectTasks");
        return;
      }
      const keys = Array.from(selectedIds);
      const isDelete = action === "delete";

      if (isDelete && !confirm(t("tasks.confirmBatchDelete", { count: keys.length }))) return;

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
          toast.success("tasks.batchDeleteComplete", { count: ok });
        } else {
          toast.warning("tasks.batchResult", { ok, fail });
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
        toast.info(t("tasks.noApplicableTasks", { action: actionLabel(action, t), skipped }));
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
          // {t("tasks.batchStart")}对 failed/cancelled 任务使用 retry 端点（重置进度和错误信息）
          if (action === 'start' && ['failed', 'cancelled'].includes(task.Status || '')) {
            return fetch(`/api/tasks/${id}/retry`, { method: "POST" });
          }
          return fetch(`/api/tasks/${id}/${action}`, { method: "POST" });
        })
      );

      const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
      const fail = results.length - ok;

      if (fail === 0 && skipped === 0) {
        toast.success(t("tasks.batchActionComplete", { action: actionLabel(action, t), count: ok }));
      } else if (fail === 0) {
        toast.success(t("tasks.batchActionCompleteWithSkipped", { action: actionLabel(action, t), count: ok, skipped }));
      } else {
        toast.warning(t("tasks.batchResultWithSkipped", { ok, fail, skipped }));
      }
    },
    [selectedIds, tasks, t]
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
          primaryFilters={TYPE_PILL_KEYS.map(p => ({ value: p.value, label: t(p.labelKey) }))}
          primaryFilterValue={typeFilter}
          onPrimaryFilterChange={(v) => setTypeFilter(v as TypeFilter)}
          secondaryFilters={FILTER_PILL_KEYS.map((p) => ({ value: p.value, label: t(p.labelKey), count: statusCounts[p.value] || 0 }))}
          secondaryFilterValue={statusFilter}
          onSecondaryFilterChange={(v) => setStatusFilter(v as StatusFilter)}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t("tasks.searchPlaceholder")}
          sortOptions={SORT_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
          sortValue={sortBy}
          onSortChange={(v) => setSortBy(v as SortBy)}
        >
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={14} />
            {t("tasks.addTask")}
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowSettingsPanel(true)}
            title={t("tasks.settings")}
          >
            <Settings size={14} />
            {t("tasks.settings")}
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
              {t("tasks.selected", { count: selectedIds.size })}
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleBatchAction("start")}
            >
              <Play size={12} />
              {t("tasks.batchStart")}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => handleBatchAction("retry")}
              title={t("tasks.batchRetryTitle")}
            >
              <RotateCw size={12} />
              {t("tasks.batchRetry")}
            </button>
            <button
              className="btn btn-warning btn-sm"
              onClick={() => handleBatchAction("pause")}
            >
              <Pause size={12} />
              {t("tasks.batchPause")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => handleBatchAction("cancel")}
            >
              <Square size={12} />
              {t("tasks.batchCancel")}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => handleBatchAction("delete")}
            >
              <Trash2 size={12} />
              {t("tasks.batchDelete")}
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
              {tasks.length === 0 ? t("tasks.noTasksTitle") : t("tasks.noMatchingTasks")}
            </div>
            <div className="empty-state-subtext">
              {tasks.length === 0
                ? t("tasks.noTasksInputHint")
                : t("tasks.tryAdjustFilter")}
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
                      title={allSelected ? t("tasks.deselectAll") : t("tasks.selectAll")}
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
                  <th style={{ width: 56 }}>{t("tasks.colId")}</th>
                  <th style={{ width: 48, whiteSpace: "nowrap" }}>{t("tasks.colType")}</th>
                  <th style={{ width: 100 }}>{t("tasks.colPerson")}</th>
                  <th style={{ width: 300 }}>{t("tasks.colTitle")}</th>
                  <th style={{ width: 64, whiteSpace: "nowrap" }}>{t("tasks.colSource")}</th>
                  <th style={{ width: 68 }}>{t("tasks.colStatus")}</th>
                  <th style={{ width: 140 }}>{t("tasks.colProgress")}</th>
                  <th style={{ width: 80, whiteSpace: "nowrap" }}>{t("tasks.colSegments")}</th>
                  <th style={{ width: 80, whiteSpace: "nowrap" }}>{t("tasks.colFileSize")}</th>
                  <th style={{ width: 190, whiteSpace: "nowrap" }}>{t("tasks.colActions")}</th>
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
                        : (task.Status === "pending");
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
                    ? t("tasks.identifying")
                    : (rawTitle || task.URL);
                  const progress = task.Progress;
                  const progressPct = progress.toFixed(1) + "%";
                  const stage = getProgressStage(task, t);
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
                              title={t("tasks.sniffTaskLabel")}
                              style={{ color: "#6366f1" }}
                            >
                              <Radar size={15} />
                            </span>
                          ) : isGallery ? (
                            <span
                              title={t("tasks.galleryTaskLabel")}
                              style={{ color: "var(--text-muted)" }}
                            >
                              <ImageIcon size={15} />
                            </span>
                          ) : (
                            <span
                              title={t("tasks.videoTaskLabel")}
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
                              {getSiteModuleName(siteModule, locale)}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
                          )}
                        </td>
                        <td>
                          {task.Status === 'failed' && task.ErrorMsg ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span className={`status-pill status-pill-${task.Status}`}>
                                {STATUS_LABEL[task.Status] ?? task.Status}
                              </span>
                              <span 
                                style={{ 
                                  fontSize: 11, 
                                  color: 'var(--danger)', 
                                  maxWidth: 120,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }} 
                                title={task.ErrorMsg}
                              >
                                {task.ErrorMsg}
                              </span>
                            </div>
                          ) : (
                            <span className={`status-pill status-pill-${task.Status}`}>
                              {STATUS_LABEL[task.Status] ?? task.Status}
                            </span>
                          )}
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
                              {task.Status === 'completed' ? t("tasks.sniffFound", { count: task.SniffTotalFound ?? 0 }) : task.Status === 'scraping' ? t("tasks.sniffDiscovered", { count: task.SniffTotalFound ?? 0 }) : "—"}
                            </span>
                          ) : isIdentifying ? (
                            <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>{t("tasks.identifying")}</span>
                          ) : isGallery ? (
                            <span className="dual-capsule" title={t("tasks.gallerySegmentTitle", { images: task.ImageCount ?? 0, videos: task.VideoCount ?? 0 })}>
                              <span className="dual-capsule-left accent-green">{task.ImageCount || 0}P</span>
                              <span className="dual-capsule-right accent-orange">{task.VideoCount || 0}V</span>
                            </span>
                          ) : task.TotalSegments ? (
                            <span className="dual-capsule" title={t("tasks.segmentTitle", { current: task.Segment ?? 0, total: task.TotalSegments })}>
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
                            task.GalleryTotalSize && task.GalleryTotalSize > 0
                              ? formatFileSize(task.GalleryTotalSize)
                              : task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
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
                                title={t("tasks.actionStart")}
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
                                title={t("tasks.actionPause")}
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
                                title={t("tasks.actionCancel")}
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
                                title={t("tasks.actionDelete")}
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
                                title={t("tasks.actionRetry")}
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
                                title={t("tasks.retryFailedFiles")}
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
                                  Type: isSniff ? t("tasks.typeSniff") : isGallery ? t("tasks.typeGallery") : t("tasks.typeVideo"),
                                  Title: isGallery ? (task.GalleryTitle || '—') : (task.VideoInfo?.Title || '—'),
                                  URL: task.URL,
                                  M3U8URL: task.M3U8URL || undefined,
                                  Status: STATUS_LABEL[task.Status] ?? task.Status,
                                  Progress: `${task.Progress.toFixed(1)}%`,
                                  FilePath: task.FilePath || undefined,
                                  CreatedAt: task.CreatedAt ? new Date(task.CreatedAt).toLocaleString(locale) : undefined,
                                  UpdatedAt: task.UpdatedAt ? new Date(task.UpdatedAt).toLocaleString(locale) : undefined,
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
                                    Duration: task.VideoInfo?.Duration ? t("tasks.durationMinutes", { count: task.VideoInfo.Duration }) : undefined,
                                    Resolution: task.VideoInfo?.Resolution || undefined,
                                    Tags: task.VideoInfo?.Tags?.length ? task.VideoInfo.Tags : undefined,
                                    Actors: task.VideoInfo?.Actors?.length ? task.VideoInfo.Actors : undefined,
                                  }),
                                  ErrorMsg: task.ErrorMsg || undefined,
                                };
                                navigator.clipboard.writeText(JSON.stringify(summary, null, 2)).then(
                                  () => toast.success("tasks.taskDataCopied", { id: task.DisplayID ?? task.ID }),
                                  () => toast.error("tasks.copyFailed"),
                                );
                              }}
                              title={t("tasks.copyTaskData")}
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
                {t("tasks.addTask")}
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
                  {t("tasks.linkImport")}
                </button>
                <button
                  className={`modal-tab ${addTab === "search" ? "active" : ""}`}
                  onClick={() => setAddTab("search")}
                >
                  <SearchIcon size={14} className="tab-icon" />
                  {t("tasks.batchSearch")}
                </button>
              </div>

              {addTab === "link" ? (
                <div>
                  <div className="modal-section">
                    <div className="modal-input-group">
                      <div className="modal-input-label">
                        <span>{t("tasks.pasteLinks")}</span>
                        <div className="input-stats-bar">
                          <div className="input-stat-item stat-input">
                            <FileText size={14} className="stat-icon" />
                            <span className="stat-label">{t("tasks.statInput")}</span>
                            <span className="stat-value">{totalInputLines}</span>
                            <span className="stat-label">{t("tasks.statLines")}</span>
                          </div>
                          <div className={`input-stat-item ${parsedUrls.length > 0 ? "stat-detected" : "stat-input"}`}>
                            <LinkIcon size={14} className="stat-icon" />
                            <span className="stat-label">{t("tasks.statDetected")}</span>
                            <span className="stat-value">{parsedUrls.length}</span>
                            <span className="stat-label">{t("tasks.statItems")}</span>
                          </div>
                        </div>
                      </div>
                      <textarea
                        className="form-control"
                        placeholder={t("tasks.linkInputPlaceholder")}
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
                          {t("tasks.autoDetectHint")}
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
                                    toast.error("tasks.clipboardNoLinks");
                                    return prev;
                                  }
                                  const existing = prev
                                    .split(/[\n\s,]+/)
                                    .map((s) => s.trim())
                                    .filter((s) => s.startsWith("http"));
                                  const newUrls = urls.filter((u) => !existing.includes(u));
                                  if (newUrls.length === 0) {
                                    toast.info("tasks.clipboardAllExist");
                                    return prev;
                                  }
                                    toast.success("tasks.pastedNewLinks", { count: newUrls.length });
                                  return prev ? prev + "\n" + newUrls.join("\n") : newUrls.join("\n");
                                });
                              } catch {
                                toast.error("tasks.clipboardReadFail");
                              }
                            }}
                          >
                            <ClipboardPaste size={12} />
                            {t("tasks.paste")}
                          </button>
                          <button
                            className="quick-action-btn"
                            onClick={() => {
                              setLinkInput("");
                              toast.info("tasks.clipboardCleared");
                            }}
                            disabled={!linkInput}
                          >
                            <Trash2 size={12} />
                            {t("tasks.clear")}
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
                      ? t("tasks.batchImport", { count: parsedUrls.length })
                      : t("tasks.addTask")}
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
                  {isSniffTask ? t("tasks.detailTaskTypeSniff") : isGalleryTask ? t("tasks.detailTaskTypeGallery") : t("tasks.detailTaskTypeVideo")}{t("tasks.detailTaskSuffix")} #{task.DisplayID ?? task.ID}
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
                    <span className="task-detail-label">{isGalleryTask ? t("tasks.detailSourcePage") : t("tasks.detailVideoLink")}</span>
                    <span className="task-detail-value task-detail-value-with-copy">
                      <span className="task-detail-value-text">{task.URL}</span>
                      <button
                        className="btn-copy-inline"
                        onClick={() => {
                          navigator.clipboard.writeText(task.URL);
                          toast.success("common.copied");
                        }}
                        title={t("common.copy")}
                      >
                        <Copy size={13} />
                      </button>
                    </span>
                  </div>
                  {isSniffTask && (
                    <>
                      <div className="task-detail-row full-width">
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">{t("tasks.colStatus")}</span>
                          <span className="task-detail-value">{STATUS_LABEL[task.Status] ?? task.Status}</span>
                        </div>
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">{t("tasks.detailFoundGalleries")}</span>
                          <span className="task-detail-value">{t("tasks.countUnit", { count: task.SniffTotalFound ?? 0 })}</span>
                        </div>
                      </div>
                      <div className="task-detail-row full-width">
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">{t("tasks.detailCreatedTasks")}</span>
                          <span className="task-detail-value">{t("tasks.countUnit", { count: task.SniffTotalCreated ?? 0 })}</span>
                        </div>
                        <div className="task-detail-item task-detail-item-flex">
                          <span className="task-detail-label">{t("tasks.detailSkipped")}</span>
                          <span className="task-detail-value">{t("tasks.countUnit", { count: task.SniffTotalSkipped ?? 0 })}</span>
                        </div>
                      </div>
                      {task.Status === 'failed' && task.ErrorMsg && (
                        <div className="task-detail-item full-width">
                          <div className="failure-reason-card">
                            <div className="failure-reason-header">
                              <span className="failure-reason-icon">⚠</span>
                              <span className="failure-reason-title">{t("tasks.detailFailureReason")}</span>
                            </div>
                            <div className="failure-reason-content">
                              <strong>{task.ErrorMsg}</strong>
                            </div>
                          </div>
                        </div>
                      )}
                      {task.ErrorMsg && task.Status !== 'failed' && (
                        <div className="task-detail-item full-width">
                          <span className="task-detail-label">{t("tasks.errorMsg")}</span>
                          <span className="task-detail-value" style={{ color: "var(--danger)" }}>{task.ErrorMsg}</span>
                        </div>
                      )}
                      {task.CreatedAt && (
                        <div className="task-detail-item full-width">
                          <span className="task-detail-label">{t("tasks.createdAt")}</span>
                          <span className="task-detail-value">{new Date(task.CreatedAt).toLocaleString(locale)}</span>
                        </div>
                      )}
                    </>
                  )}
                  {task.M3U8URL && (
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">{t("tasks.m3u8Url")}</span>
                      <span className="task-detail-value task-detail-value-with-copy">
                        <span className="task-detail-value-text">{task.M3U8URL}</span>
                        <button
                          className="btn-copy-inline"
                          onClick={() => {
                            navigator.clipboard.writeText(task.M3U8URL);
                            toast.success("common.copied");
                          }}
                          title={t("common.copy")}
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                    </div>
                  )}
                  {task.FilePath && (
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">{isGalleryTask ? t("tasks.savePath") : t("tasks.filePath")}</span>
                      <span className="task-detail-value task-detail-value-with-copy">
                        <span className="task-detail-value-text">{task.FilePath}</span>
                        <button
                          className="btn-copy-inline"
                          onClick={() => {
                            navigator.clipboard.writeText(task.FilePath!);
                            toast.success("common.copied");
                          }}
                          title={t("common.copy")}
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                    </div>
                  )}
                  {isGalleryTask && task.GalleryTitle && (
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">{t("tasks.detailGalleryTitle")}</span>
                      <span className="task-detail-value task-detail-value-with-copy">
                        <span className="task-detail-value-text">{task.GalleryTitle}</span>
                        <button
                          className="btn-copy-inline"
                          onClick={() => {
                            navigator.clipboard.writeText(task.GalleryTitle!);
                            toast.success("common.copied");
                          }}
                          title={t("common.copy")}
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                    </div>
                    )}
                  {task.Person && isGalleryTask && (
                    <div className="task-detail-item">
                      <span className="task-detail-label">{t("tasks.person")}</span>
                      <span className="task-detail-value">{task.Person}</span>
                    </div>
                  )}
                  {isGalleryTask && (task.ImageCount !== undefined || task.VideoCount !== undefined || (task.DownloadMethod && task.DownloadMethod !== 'pending')) && (
                    <div className="task-detail-row full-width">
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">{t("tasks.detailImageCount")}</span>
                        <span className="task-detail-value">{t("tasks.imageUnit", { count: task.ImageCount ?? 0 })}</span>
                      </div>
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">{t("tasks.detailVideoCount")}</span>
                        <span className="task-detail-value">{t("tasks.countUnit", { count: task.VideoCount ?? 0 })}</span>
                      </div>
                      <div className="task-detail-item task-detail-item-flex">
                        <span className="task-detail-label">{t("tasks.detailDownloadMethod")}</span>
                        <span className="task-detail-value">
                          {task.DownloadMethod === 'zip' ? t("tasks.downloadMethodZip") :
                            task.DownloadMethod === 'scrape' ? t("tasks.downloadMethodScrape") :
                              task.DownloadMethod === 'both' ? t("tasks.downloadMethodBoth") : (task.DownloadMethod ?? '—')}
                        </span>
                      </div>
                    </div>
                    )}
                  {task.Status === 'failed' && task.ErrorMsg && (
                    <div className="task-detail-item full-width">
                      <div className="failure-reason-card">
                        <div className="failure-reason-header">
                          <span className="failure-reason-icon">⚠</span>
                          <span className="failure-reason-title">{t("tasks.detailFailureReason")}</span>
                        </div>
                        <div className="failure-reason-content">
                          <strong>{task.ErrorMsg}</strong>
                        </div>
                      </div>
                    </div>
                  )}
                  {task.ErrorMsg && task.Status !== 'failed' && (
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">{t("tasks.errorMsg")}</span>
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
                      <span className="task-detail-label">{t("tasks.detailVideoTitle")}</span>
                      <span className="task-detail-value task-detail-value-with-copy">
                        <span className="task-detail-value-text">{task.VideoInfo.Title}</span>
                        <button
                          className="btn-copy-inline"
                          onClick={() => {
                            navigator.clipboard.writeText(task.VideoInfo!.Title!);
                            toast.success("common.copied");
                          }}
                          title={t("common.copy")}
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                    </div>
                  )}
                  {isGalleryTask && task.GalleryTitle && (
                    <div className="task-detail-item full-width">
                      <span className="task-detail-label">{t("tasks.detailTags")}</span>
                      <span className="task-detail-value">
                        {task.GalleryTitle ? (
                          <div className="task-detail-tags">
                            {task.GalleryTitle.split(/[\s\-_,]+/).filter((t: string) => t.length > 1 && !/\d+P/i.test(t)).slice(0, 8).map((tag: string) => (
                              <span
                                key={tag}
                                className="pill pill-clickable"
                                onClick={() => {
                                  navigator.clipboard.writeText(tag);
                                  toast.success("common.copied");
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
                        <span className="task-detail-label">{t("tasks.detailTags")}</span>
                        <span className="task-detail-value">
                          {task.VideoInfo?.Tags && task.VideoInfo.Tags.length > 0 ? (
                            <div className="task-detail-tags">
                              {task.VideoInfo.Tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="pill pill-clickable"
                                  onClick={() => {
                                    navigator.clipboard.writeText(tag);
                                    toast.success("common.copied");
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
                      <span className="task-detail-label">{t("tasks.detailActors")}</span>
                      <span className="task-detail-value">{task.VideoInfo.Actors.join("、")}</span>
                    </div>
                  )}
                  {!isGalleryTask && task.VideoInfo?.Director && (
                    <div className="task-detail-item">
                      <span className="task-detail-label">{t("tasks.detailDirector")}</span>
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
                            <span className="info-bar-text">{t("tasks.durationMinutes", { count: task.VideoInfo.Duration })}</span>
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
                              {task.GalleryTotalSize && task.GalleryTotalSize > 0
                                ? formatFileSize(task.GalleryTotalSize)
                                : task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
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
                            <span className="info-bar-text">{new Date(task.CreatedAt).toLocaleString(locale)}</span>
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

function actionLabel(action: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const map: Record<string, string> = {
    start: t("tasks.actionStart"),
    pause: t("tasks.actionPause"),
    resume: t("tasks.actionResume"),
    cancel: t("tasks.actionCancel"),
    retry: t("tasks.actionRetry"),
    delete: t("tasks.actionDelete"),
  };
  return map[action] ?? action;
}
