import { useEffect, useState, useCallback, useMemo, useRef, useReducer } from "react";
import { useLocation } from "react-router-dom";
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
  Settings,
  Wifi,
  ImageIcon,
  Film,
  Radar,
  Copy,
} from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import type { DownloadTask } from "@/types";
import { useTaskStore } from "@/store/task-store";
import { formatFileSize } from "@/lib/utils";
import ResourceToolbar from "@/components/ui/resource-toolbar";
import TaskSettingsPanel from "@/components/tasks/task-settings-panel";
import { useRouteState } from "@/lib/core/infra/route-state";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import { useI18n } from "@/lib/i18n";
import {
  useStatusLabel,
  getProgressStage,
  resolveTaskActors,
  resolveTaskTags,
  TYPE_PILL_KEYS,
  FILTER_PILL_KEYS,
  SORT_OPTION_KEYS,
  STATUS_ORDER,
  STATUS_FILTER_GROUPS,
  type StatusFilter,
  type TypeFilter,
  type SortBy,
} from "./_lib/task-helpers";
import { useTaskActions } from "./_lib/use-task-actions";
import { AddTaskModal } from "./_components/add-task-modal";
import { DataStream, DiskActivity } from "@/components/ops/data-stream";
import { ConsoleLog } from "@/components/ops/console-log";
import { TaskDetailPopover } from "./_components/task-detail-popover";
import { Pagination } from "@/components/ui/pagination";

// ===== TanStack Imports =====
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

const LOAD_MORE_THRESHOLD = 200; // pixels from bottom to trigger load

interface SseAnimState {
  updatedKeys: Set<string>;
  statusChangedKeys: Set<string>;
  newKeys: Set<string>;
  tableFlashing: boolean;
}

const initialSseAnimState: SseAnimState = {
  updatedKeys: new Set(),
  statusChangedKeys: new Set(),
  newKeys: new Set(),
  tableFlashing: false,
};

type SseAnimAction =
  | { type: "reset" }
  | { type: "snapshot"; prevTasks: DownloadTask[]; nextTasks: DownloadTask[] }
  | { type: "clearTableFlash" };

function sseAnimReducer(state: SseAnimState, action: SseAnimAction): SseAnimState {
  switch (action.type) {
    case "reset":
      return initialSseAnimState;
    case "snapshot": {
      const prevMap = new Map<string, DownloadTask>();
      for (const t of action.prevTasks) {
        prevMap.set(`${t.TaskType || "video"}-${t.ID}`, t);
      }
      const updatedKeys = new Set<string>();
      const statusChangedKeys = new Set<string>();
      const newKeys = new Set<string>();

      for (const t of action.nextTasks) {
        const key = `${t.TaskType || "video"}-${t.ID}`;
        const prev = prevMap.get(key);
        if (!prev) {
          newKeys.add(key);
        } else {
          if (
            prev.Status !== t.Status ||
            prev.Progress !== t.Progress ||
            prev.GalleryTitle !== t.GalleryTitle ||
            prev.Person !== t.Person ||
            prev.ImageCount !== t.ImageCount ||
            prev.VideoCount !== t.VideoCount ||
            prev.ErrorMsg !== t.ErrorMsg
          ) {
            updatedKeys.add(key);
            if (prev.Status !== t.Status) {
              statusChangedKeys.add(key);
            }
          }
        }
      }

      const hasChanges = updatedKeys.size > 0 || statusChangedKeys.size > 0 || newKeys.size > 0;
      return {
        updatedKeys,
        statusChangedKeys,
        newKeys,
        tableFlashing: hasChanges,
      };
    }
    case "clearTableFlash":
      return { ...state, tableFlashing: false };
    default:
      return state;
  }
}

export default function TasksPage(): React.JSX.Element {
  const { t, locale } = useI18n();
  const STATUS_LABEL = useStatusLabel(t);
  const {
    tasks,
    loading,
    fetchTasks,
    connectSSE,
    loadMoreTasks,
    hasMore,
    loadingMore,
  } = useTaskStore();
  const { pathname } = useLocation();
  const { savedData, saveState } = useRouteState(pathname, {
    ttl: 5 * 60 * 1000,
    saveScroll: true,
  });

  const [sseAnimState, dispatchSseAnim] = useReducer(sseAnimReducer, initialSseAnimState);
  const prevTasksRef = useRef<DownloadTask[]>([]);
  const tableFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreTriggeredRef = useRef(false);

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = useState("");

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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [addTab, setAddTab] = useState<"link" | "search">("link");
  const addTabTouched = useRef(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [apiStats, setApiStats] = useState<{ current_speed_str?: string; disk_io_str?: string } | null>(null);

  // Sync rowSelection to parent component state for backward compatibility
  const selectedIds = useMemo(() => new Set(Object.keys(rowSelection)), [rowSelection]);

  useEffect(() => {
    const fetchStats = async (): Promise<void> => {
      try {
        const res = await fetch("/api/stats");
        if (res.ok) {
          const data = await res.json();
          setApiStats(data);
        }
      } catch {
      }
    };
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const currentSpeedStr = apiStats?.current_speed_str ?? "0 B/s";
  const diskIoStr = apiStats?.disk_io_str ?? "—";

  useEffect(() => {
    if (addTabTouched.current) return;
    const restored = savedData?.addTab;
    if (restored === "link" || restored === "search") {
      setAddTab(restored);
    }
  }, [savedData]);

  const handleSetAddTab = useCallback((tab: "link" | "search") => {
    addTabTouched.current = true;
    setAddTab(tab);
  }, []);

  useEffect(() => {
    if (addTabTouched.current) {
      saveState({ addTab });
    }
  }, [addTab, saveState]);

  // Infinite scroll: when user scrolls near the bottom and there are more
  // tasks on the server, trigger loadMoreTasks to fetch the next page.
  useEffect(() => {
    if (!hasMore || loadingMore) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = (): void => {
      if (loadMoreTriggeredRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < LOAD_MORE_THRESHOLD) {
        loadMoreTriggeredRef.current = true;
        loadMoreTasks().finally(() => {
          setTimeout(() => {
            loadMoreTriggeredRef.current = false;
          }, 500);
        });
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasMore, loadingMore, loadMoreTasks]);

  useEffect(() => {
    loadMoreTriggeredRef.current = false;
  }, [statusFilter, typeFilter, searchQuery, sortBy]);

  useEffect(() => {
    if (tasks.length === 0) {
      fetchTasks();
    }
    const unsub = connectSSE();
    return () => unsub();
  }, [fetchTasks, connectSSE, tasks.length]);

  useEffect(() => {
    if (prevTasksRef.current.length === 0 && tasks.length === 0) return;

    if (tableFlashTimerRef.current) {
      clearTimeout(tableFlashTimerRef.current);
    }
    if (clearAnimTimerRef.current) {
      clearTimeout(clearAnimTimerRef.current);
    }

    tableFlashTimerRef.current = setTimeout(() => {
      dispatchSseAnim({
        type: "snapshot",
        prevTasks: prevTasksRef.current,
        nextTasks: tasks,
      });
      prevTasksRef.current = tasks;

      clearAnimTimerRef.current = setTimeout(() => {
        dispatchSseAnim({ type: "reset" });
      }, 900);
    }, 50);

    return () => {
      if (tableFlashTimerRef.current) clearTimeout(tableFlashTimerRef.current);
      if (clearAnimTimerRef.current) clearTimeout(clearAnimTimerRef.current);
    };
  }, [tasks]);

  // Filtered tasks based on status and type filters
  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (statusFilter !== "all") {
      const groupStatuses = STATUS_FILTER_GROUPS[statusFilter];
      if (groupStatuses) {
        result = result.filter((t) => {
          const effectiveStatus = t.EffectiveStatus ?? t.Status;
          return groupStatuses.includes(effectiveStatus);
        });
      } else {
        result = result.filter((t) => (t.EffectiveStatus ?? t.Status) === statusFilter);
      }
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

    return result;
  }, [tasks, statusFilter, typeFilter, searchQuery]);

  const { handleSubmit, handleAction, handleDelete, handleBatchAction } = useTaskActions({
    tasks,
    selectedIds,
    setSelectedIds: (ids: Set<string>) => {
      const newSelection: RowSelectionState = {};
      ids.forEach((id) => {
        newSelection[id] = true;
      });
      setRowSelection(newSelection);
    },
    fetchTasks,
    t,
  });

  // ===== TanStack Table Column Definitions =====
  const columns = useMemo<ColumnDef<DownloadTask>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <button
            onClick={table.getToggleAllRowsSelectedHandler()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: table.getIsAllRowsSelected() || table.getIsSomeRowsSelected() ? "var(--accent)" : "var(--text-muted)",
              marginRight: 6,
              verticalAlign: "middle",
            }}
            title={table.getIsAllRowsSelected() ? t("tasks.deselectAll") : t("tasks.selectAll")}
          >
            {table.getIsAllRowsSelected() || table.getIsSomeRowsSelected() ? (
              <CheckSquare size={16} />
            ) : (
              <SquareIcon size={16} />
            )}
          </button>
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            style={{ cursor: "pointer" }}
          />
        ),
        size: 60,
        enableSorting: false,
      },
      {
        id: "id",
        accessorKey: "DisplayID",
        header: () => (
          <>
            <button
              onClick={(() => {
                const allSelected = Object.keys(rowSelection).length === filteredTasks.length && filteredTasks.length > 0;
                if (allSelected) {
                  setRowSelection({});
                } else {
                  const newSelection: RowSelectionState = {};
                  filteredTasks.forEach((task) => {
                    newSelection[`${task.TaskType || "video"}-${task.ID}`] = true;
                  });
                  setRowSelection(newSelection);
                }
              })}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                color: (Object.keys(rowSelection).length > 0 && Object.keys(rowSelection).length === filteredTasks.length) || Object.keys(rowSelection).length > 0 ? "var(--accent)" : "var(--text-muted)",
                marginRight: 6,
                verticalAlign: "middle",
              }}
              title={(Object.keys(rowSelection).length === filteredTasks.length && filteredTasks.length > 0) ? t("tasks.deselectAll") : t("tasks.selectAll")}
            >
              {(Object.keys(rowSelection).length === filteredTasks.length && filteredTasks.length > 0) || Object.keys(rowSelection).length > 0 ? <CheckSquare size={16} /> : <SquareIcon size={16} />}
            </button>
            {t("tasks.colId")}
          </>
        ),
        cell: ({ row }) => {
          const task = row.original;
          const idStr = String(task.DisplayID ?? task.ID);
          const idDisplay = idStr.length > 8 ? idStr.slice(0, 8) + "..." : idStr;
          const isSniff = task.TaskType === "sniff";
          return (
            <span
              style={{
                fontFamily: "monospace",
                color: isSniff ? "#6366f1" : "var(--text-secondary)",
                fontWeight: isSniff ? 700 : undefined,
                whiteSpace: "nowrap",
              }}
            >
              {idDisplay}
            </span>
          );
        },
        size: 60,
      },
      {
        id: "colType",
        accessorKey: "TaskType",
        header: () => t("tasks.colType"),
        cell: ({ row }) => {
          const task = row.original;
          const isSniff = task.TaskType === "sniff";
          const isGallery = task.TaskType === "gallery";
          return isSniff ? (
            <span title={t("tasks.sniffTaskLabel")} style={{ color: "var(--accent-light)" }}>
              <Radar size={15} />
            </span>
          ) : isGallery ? (
            <span title={t("tasks.galleryTaskLabel")} style={{ color: "var(--text-muted)" }}>
              <ImageIcon size={15} />
            </span>
          ) : (
            <span title={t("tasks.videoTaskLabel")} style={{ color: "var(--text-muted)" }}>
              <Film size={15} />
            </span>
          );
        },
        size: 28,
      },
      {
        id: "colPerson",
        accessorKey: "Person",
        header: () => t("tasks.colPerson"),
        cell: ({ row }) => {
          const task = row.original;
          return (
            <span
              style={{
                maxWidth: 100,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
              title={task.Person && task.Person !== "null" ? task.Person : ""}
            >
              {task.Person && task.Person !== "null" ? task.Person : "—"}
            </span>
          );
        },
        size: 100,
      },
      {
        id: "colTitle",
        accessorFn: (row) => {
          const isSniff = row.TaskType === "sniff";
          const isIdentifying = row.Status === "scraping" || row.Status === "scrape_pending";
          if (isSniff) return row.URL;
          if (isIdentifying && !row.GalleryTitle && !row.VideoInfo?.Title) return "";
          return row.GalleryTitle || row.VideoInfo?.Title || row.URL;
        },
        header: () => t("tasks.colTitle"),
        cell: ({ row }) => {
          const task = row.original;
          const isSniff = task.TaskType === "sniff";
          const rawTitle = isSniff
            ? task.URL
            : task.GalleryTitle || task.VideoInfo?.Title || "";
          const isIdentifying = task.Status === "scraping" || task.Status === "scrape_pending";
          const titleDisplay = isIdentifying && !rawTitle ? t("tasks.identifying") : (rawTitle || task.URL);
          return (
            <span
              style={{
                display: "block",
                maxWidth: "100%",
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
            </span>
          );
        },
        size: 300,
      },
      {
        id: "colStatus",
        accessorKey: "Status",
        header: () => t("tasks.colStatus"),
        cell: ({ row }) => {
          const task = row.original;
          const label = STATUS_LABEL[task.Status] ?? task.Status;
          return task.Status === "failed" && task.ErrorMsg ? (
            <span
              className={`status-pill status-pill-${task.Status}`}
              data-tooltip={task.ErrorMsg}
              style={{ cursor: "help" }}
            >
              {label}
            </span>
          ) : (
            <span className={`status-pill status-pill-${task.Status}`}>
              {label}
            </span>
          );
        },
        size: 92,
      },
      {
        id: "colProgress",
        accessorKey: "Progress",
        header: () => t("tasks.colProgress"),
        cell: ({ row }) => {
          const task = row.original;
          const isPreparing = task.Status === "preparing";
          const isIdentifying = task.Status === "scraping" || task.Status === "scrape_pending";
          const isWaitingSlot = task.Status === "scrape_pending" || task.Status === "download_pending" || isPreparing;
          const isPaused = task.Status === "paused";
          // Transcode/post-process phase: purple fill driven by the
          // REAL transcode percentage (SSE carries phase progress 0→100
          // while status is "transcoding"); the stage text shows the
          // live percentage. The bar reverts to the normal green
          // completed fill once the task finishes.
          const isTranscoding = task.Status === "transcoding";
          const showStage = isIdentifying || isWaitingSlot || isPaused || isTranscoding;
          const stage = getProgressStage(task, t);
          const progress = typeof task.Progress === "number" ? task.Progress : 0;
          const transcodeText =
            isTranscoding && progress < 99 ? `${stage} ${progress.toFixed(1)}%` : stage;
          const fillClass =
            task.Status === "completed"
              ? "completed"
              : task.Status === "failed" || task.Status === "cancelled"
                ? "failed"
                : isPreparing
                  ? "preparing"
                  : "";
          return (
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
                {showStage ? transcodeText : progress.toFixed(1) + "%"}
              </span>
              <div className="progress-bar" style={{ width: "100%" }}>
                <div
                  className={`progress-bar-fill ${fillClass} ${isTranscoding ? "transcoding" : ""} ${showStage && !isTranscoding ? "progress-bar-indeterminate" : ""}`}
                  style={showStage && !isTranscoding ? {} : { width: `${progress}%` }}
                />
              </div>
            </div>
          );
        },
        size: 140,
      },
      {
        id: "colSegments",
        accessorFn: (row) => {
          if (row.TaskType === "gallery") return `${row.ImageCount ?? 0}P/${row.VideoCount ?? 0}V`;
          if (row.TotalSegments) return `${row.Segment ?? 0}/${row.TotalSegments}`;
          return "";
        },
        header: () => t("tasks.colSegments"),
        cell: ({ row }) => {
          const task = row.original;
          if (task.TaskType === "gallery") {
            return (
              <span className="dual-capsule" title={t("tasks.gallerySegmentTitle", { images: task.ImageCount ?? 0, videos: task.VideoCount ?? 0 })}>
                <span className="dual-capsule-left accent-green">{task.ImageCount || 0}P</span>
                <span className="dual-capsule-right accent-orange">{task.VideoCount || 0}V</span>
              </span>
            );
          }
          if (task.TotalSegments) {
            return (
              <span className="dual-capsule" title={t("tasks.segmentTitle", { current: task.Segment ?? 0, total: task.TotalSegments })}>
                <span className="dual-capsule-left">{task.Segment ?? 0}</span>
                <span className="dual-capsule-right">{task.TotalSegments}</span>
              </span>
            );
          }
          return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>;
        },
        size: 68,
      },
      {
        id: "colFileSize",
        accessorFn: (row) => {
          if (row.FileSize && row.FileSize > 0) return row.FileSize;
          if (row.DownloadedBytes && row.DownloadedBytes > 0) return row.DownloadedBytes;
          return 0;
        },
        header: () => t("tasks.colFileSize"),
        cell: ({ row }) => {
          const task = row.original;
          if (task.TaskType === "gallery") {
            return task.GalleryTotalSize && task.GalleryTotalSize > 0
              ? formatFileSize(task.GalleryTotalSize)
              : task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
                ? formatFileSize(task.DownloadInfo.ActualSize)
                : task.DownloadInfo?.FileSizeText
                  ? task.DownloadInfo.FileSizeText
                  : "—";
          }
          if (task.FileSize && task.FileSize > 0) return `${(task.FileSize / 1024 / 1024).toFixed(1)} MB`;
          if (task.DownloadedBytes && task.DownloadedBytes > 0) return `${(task.DownloadedBytes / 1024 / 1024).toFixed(1)} MB`;
          return "—";
        },
        size: 68,
      },
      {
        id: "colActions",
        header: () => t("tasks.colActions"),
        cell: ({ row }) => {
          const task = row.original;
          const isGallery = task.TaskType === "gallery";
          const isSniff = task.TaskType === "sniff";
          const isPreparing = task.Status === "preparing";
          const canStart = !isGallery && !isSniff
            ? (task.Status === "pending" || task.Status === "paused" || task.Status === "failed" || task.Status === "cancelled")
            : (task.Status === "pending" || task.Status === "scrape_pending" || task.Status === "download_pending" || task.Status === "paused" || task.Status === "failed" || task.Status === "scraping");
          const canPause = !isGallery && !isSniff && (task.Status === "downloading" || isPreparing);
          const canPauseGallery = isGallery && (task.Status === "scraping" || task.Status === "downloading" || task.Status === "scrape_pending" || task.Status === "download_pending" || task.Status === "pending" || isPreparing);
          const canCancel = !isGallery && !isSniff &&
            (task.Status === "downloading" ||
              task.Status === "paused" ||
              task.Status === "pending" ||
              task.Status === "scraping");
          const canRetry = !isSniff && task.Status === "failed";
          const canRetryPartial = isGallery && task.Status === "partial";
          const canDelete = true;
          return (
            <div className="action-buttons">
              {canStart && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleAction(task, "start"); }}
                  title={t("tasks.actionStart")}
                >
                  <Play size={14} />
                </button>
              )}
              {(canPause || canPauseGallery) && (
                <button
                  className="btn btn-warning btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleAction(task, "pause"); }}
                  title={t("tasks.actionPause")}
                >
                  <Pause size={14} />
                </button>
              )}
              {canCancel && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleAction(task, "cancel"); }}
                  title={t("tasks.actionCancel")}
                >
                  <Square size={14} />
                </button>
              )}
              {canDelete && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleDelete(task); }}
                  title={t("tasks.actionDelete")}
                >
                  <Trash2 size={14} />
                </button>
              )}
              {canRetry && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleAction(task, "retry"); }}
                  title={t("tasks.actionRetry")}
                >
                  <RotateCw size={14} />
                </button>
              )}
              {canRetryPartial && (
                <button
                  className="btn btn-outline btn-sm"
                  style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
                  onClick={(e) => { e.stopPropagation(); handleAction(task, "retry"); }}
                  title={t("tasks.retryFailedFiles")}
                >
                  <RotateCw size={14} />
                </button>
              )}
              <button
                className="btn btn-outline btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  const summary = {
                    ID: task.ID,
                    DisplayID: task.DisplayID,
                    Type: isSniff ? t("tasks.typeSniff") : isGallery ? t("tasks.typeGallery") : t("tasks.typeVideo"),
                    Title: isGallery ? (task.GalleryTitle || "—") : (task.VideoInfo?.Title || "—"),
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
                      Tags: resolveTaskTags(task).length > 0 ? resolveTaskTags(task) : undefined,
                      Actors: resolveTaskActors(task).length > 0 ? resolveTaskActors(task) : undefined,
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
          );
        },
        size: 190,
        enableSorting: false,
      },
    ],
    [t, STATUS_LABEL, rowSelection, filteredTasks.length, handleAction, handleDelete, locale]
  );

  // ===== TanStack Table Instance =====
  const table = useReactTable({
    data: filteredTasks,
    columns,
    state: {
      sorting,
      rowSelection,
      globalFilter,
    },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: true,
    enableMultiRowSelection: true,
    getRowId: (row) => `${row.TaskType || "video"}-${row.ID}`,
  });

  // Virtualizer setup
  const { getVirtualItems, getTotalSize } = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const t of tasks) {
      const effectiveStatus = t.EffectiveStatus ?? t.Status;
      if (effectiveStatus === "scrape_pending") {
        counts["scraping"] = (counts["scraping"] || 0) + 1;
      } else if (effectiveStatus === "download_pending" || effectiveStatus === "transcoding") {
        counts["downloading"] = (counts["downloading"] || 0) + 1;
      } else {
        counts[effectiveStatus] = (counts[effectiveStatus] || 0) + 1;
      }
    }
    return counts;
  }, [tasks]);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const clampedPage = Math.min(currentPage, totalPages);
  const paginatedTasks = useMemo(() => {
    const start = (clampedPage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [filteredTasks, clampedPage, pageSize]);

  const goToPage = useCallback((page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  useEffect(() => {
    const calculatePageSize = (): void => {
      const vh = window.innerHeight;
      const reservedHeight = 60 + 56 + 48 + 44 + 16;
      const availableHeight = vh - reservedHeight;
      const rowHeight = 52;
      const calculated = Math.max(5, Math.floor(availableHeight / rowHeight));
      setPageSize(calculated);
    };

    calculatePageSize();
    window.addEventListener("resize", calculatePageSize);
    return () => window.removeEventListener("resize", calculatePageSize);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, typeFilter, searchQuery, sortBy]);

  const toggleExpand = useCallback((task: DownloadTask): void => {
    const key = task.DisplayID ?? String(task.ID);
    setExpandedTask(expandedTask === key ? null : key);
  }, [expandedTask, setExpandedTask]);

  const toggleSelect = useCallback((key: string): void => {
    setRowSelection((prev) => {
      const next = { ...prev };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });
  }, []);

  const allSelected = selectedIds.size > 0 && selectedIds.size === filteredTasks.length;
  const someSelected = selectedIds.size > 0;

  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <ResourceToolbar
          primaryFilters={TYPE_PILL_KEYS.map(p => ({ value: p.value, label: t(p.labelKey), icon: p.icon }))}
          primaryFilterValue={typeFilter}
          onPrimaryFilterChange={(v) => setTypeFilter(v as TypeFilter)}
          secondaryFilters={FILTER_PILL_KEYS.map((p) => ({ value: p.value, label: t(p.labelKey), count: statusCounts[p.value] || 0 }))}
          secondaryFilterValue={statusFilter}
          onSecondaryFilterChange={(v) => setStatusFilter(v as StatusFilter)}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={t("tasks.search")}
          sortOptions={SORT_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
          sortValue={sortBy}
          onSortChange={(v) => setSortBy(v as SortBy)}
          refreshLabel={t("common.refresh")}
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

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 20px",
            background: "var(--accent-soft)",
            borderBottom: "1px solid var(--border-light)",
            fontSize: 13,
            minHeight: 40,
            boxSizing: "border-box",
          }}
        >
          <span style={{ fontWeight: 600, color: someSelected ? "var(--accent)" : "var(--text-muted)" }}>
            {someSelected
              ? t("tasks.selected", { count: selectedIds.size })
              : t("tasks.selectTasksToBatch")}
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleBatchAction("start")}
            disabled={!someSelected}
            title={someSelected ? t("tasks.batchStart") : t("tasks.batchStartDisabled")}
          >
            <Play size={12} />
            {t("tasks.batchStart")}
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => handleBatchAction("retry")}
            disabled={!someSelected}
            title={someSelected ? t("tasks.batchRetryTitle") : t("tasks.batchRetryDisabled")}
          >
            <RotateCw size={12} />
            {t("tasks.batchRetry")}
          </button>
          <button
            className="btn btn-warning btn-sm"
            onClick={() => handleBatchAction("pause")}
            disabled={!someSelected}
            title={someSelected ? t("tasks.batchPause") : t("tasks.batchPauseDisabled")}
          >
            <Pause size={12} />
            {t("tasks.batchPause")}
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => handleBatchAction("cancel")}
            disabled={!someSelected}
            title={someSelected ? t("tasks.batchCancel") : t("tasks.batchCancelDisabled")}
          >
            <Square size={12} />
            {t("tasks.batchCancel")}
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => handleBatchAction("delete")}
            disabled={!someSelected}
            title={someSelected ? t("tasks.batchDelete") : t("tasks.batchDeleteDisabled")}
          >
            <Trash2 size={12} />
            {t("tasks.batchDelete")}
          </button>
        </div>

        {loading && tasks.length === 0 ? (
          <div className="loading-container" style={{ flex: 1 }}>
            <div className="spinner" />
          </div>
        ) : filteredTasks.length === 0 ? (
          <div
            className="empty-state"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "400px",
            }}
          >
            <div className="empty-state-icon">
              <Inbox size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">
              {tasks.length === 0 ? t("tasks.noTasksTitle") : t("tasks.noMatchingTasks")}
            </div>
            <div className="empty-state-subtext">
              {tasks.length === 0 ? t("tasks.noTasksInputHint") : t("tasks.tryAdjustFilter")}
            </div>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            className={`table-wrapper${sseAnimState.tableFlashing ? " sse-table-updating" : ""}`}
            style={{ overflowY: "auto", height: "100%", position: "relative" }}
          >
            <table style={{ tableLayout: "fixed", width: "100%" }}>
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        style={{
                          width: header.getSize(),
                          whiteSpace: "nowrap",
                          padding: "14px 20px",
                          borderBottom: "1px solid var(--border-light)",
                        }}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => {
                  const task = row.original;
                  const key = `${task.TaskType || "video"}-${task.ID}`;
                  const animClasses: string[] = [];
                  if (sseAnimState.statusChangedKeys.has(key)) {
                    animClasses.push("sse-status-changed");
                  } else if (sseAnimState.updatedKeys.has(key)) {
                    animClasses.push("sse-row-updated");
                  }
                  if (sseAnimState.newKeys.has(key)) {
                    animClasses.push("sse-row-new");
                  }
                  return (
                    <tr
                      key={key}
                      className={animClasses.join(" ") || undefined}
                      onClick={() => toggleExpand(task)}
                      style={{
                        cursor: "pointer",
                        background: row.getIsSelected()
                          ? "var(--accent-soft)"
                          : task.TaskType === "sniff"
                            ? "rgba(99, 102, 241, 0.04)"
                            : undefined,
                      }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          style={{
                            padding: "14px 20px",
                            borderBottom: "1px solid var(--border-light)",
                            transition: "background-color 0.3s ease, color 0.2s ease",
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {loadingMore && (
              <div style={{ padding: "12px", textAlign: "center", color: "var(--text-muted)" }}>
                <div className="spinner" style={{ width: 20, height: 20, margin: "0 auto" }} />
              </div>
            )}
          </div>
        )}

        <div
          style={{
            position: "sticky",
            bottom: 0,
            background: "var(--bg-card)",
            display: "flex",
            alignItems: "center",
            padding: "8px 20px",
            borderTop: "1px solid var(--border-light)",
            fontSize: 13,
            zIndex: 10,
          }}
        >
            <div style={{ flex: 1 }}>
              <Pagination
                currentPage={clampedPage}
                totalPages={totalPages}
                totalItems={filteredTasks.length}
                onPageChange={goToPage}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "center", flex: 1 }}>
              <ConsoleLog />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", flex: 1 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "4px 12px",
                  background: "var(--bg-inset)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {t("dashboard.disk")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
                      fontSize: 13,
                      fontWeight: 800,
                      color: "var(--warning)",
                      letterSpacing: "-0.3px",
                    }}
                  >
                    {diskIoStr}
                  </span>
                  <DiskActivity />
                </div>

                <div style={{ width: 1, height: 12, background: "var(--border-light)" }} />

                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Wifi size={12} style={{ color: "var(--neon-cyan)" }} />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {t("dashboard.speed")}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
                      fontSize: 13,
                      fontWeight: 800,
                      color: "var(--neon-cyan)",
                      letterSpacing: "-0.3px",
                    }}
                  >
                    {currentSpeedStr}
                  </span>
                  <DataStream />
                </div>
              </div>
            </div>
          </div>
      </div>

      <TaskSettingsPanel
        open={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
      />

      <AddTaskModal
        show={showAddModal}
        onClose={() => setShowAddModal(false)}
        addTab={addTab}
        setAddTab={handleSetAddTab}
        linkInput={linkInput}
        setLinkInput={setLinkInput}
        onSubmit={handleSubmit}
        onJobCompleted={fetchTasks}
      />

      <TaskDetailPopover
        tasks={tasks}
        expandedTask={expandedTask}
        setExpandedTask={setExpandedTask}
        STATUS_LABEL={STATUS_LABEL}
      />
    </div>
  );
}
