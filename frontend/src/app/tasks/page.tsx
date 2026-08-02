import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";
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
  Settings,
  Wifi,
} from "lucide-react";
import type { DownloadTask } from "@/types";
import { useTaskStore } from "@/store/task-store";
import ResourceToolbar from "@/components/ui/resource-toolbar";
import TaskSettingsPanel from "@/components/tasks/task-settings-panel";
import { useRouteState } from "@/lib/core/infra/route-state";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import { useI18n } from "@/lib/i18n";
import {
  useStatusLabel,
  TYPE_PILL_KEYS,
  FILTER_PILL_KEYS,
  SORT_OPTION_KEYS,
  STATUS_ORDER,
  STATUS_FILTER_GROUPS,
  getEffectiveFilterStatus,
  type StatusFilter,
  type TypeFilter,
  type SortBy,
} from "./_lib/task-helpers";
import { useTaskActions } from "./_lib/use-task-actions";
import { TaskTableRow } from "./_components/task-table-row";
import { AddTaskModal } from "./_components/add-task-modal";
import { DataStream, DiskActivity } from "@/components/ops/data-stream";
import { ConsoleLog } from "@/components/console-log";
import { TaskDetailPopover } from "./_components/task-detail-popover";
import { Pagination } from "@/components/ui/pagination";

export default function TasksPage(): React.JSX.Element {
  const { t } = useI18n();
  const STATUS_LABEL = useStatusLabel(t);
  const { tasks, loading, fetchTasks, connectSSE } = useTaskStore();
  const { pathname } = useLocation();
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
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [addTab, setAddTab] = useState<"link" | "search">("link");
  /*
   * Whether the user has already toggled addTab manually. Before the
   * first toggle, the server-persisted value may restore; afterwards the
   * user's choice wins (async-loaded data must never override it).
   */
  const addTabTouched = useRef(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [apiStats, setApiStats] = useState<{ current_speed_str?: string; disk_io_str?: string } | null>(null);

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

  /* Restore the server-persisted addTab (first load only, unless the user has already toggled it). */
  useEffect(() => {
    if (addTabTouched.current) return;
    const restored = savedData?.addTab;
    if (restored === "link" || restored === "search") {
      setAddTab(restored);
    }
  }, [savedData]);

  /* Mark touched and persist once the user toggles, so the default value never overwrites the server data on mount. */
  const handleSetAddTab = useCallback((tab: "link" | "search") => {
    addTabTouched.current = true;
    setAddTab(tab);
  }, []);

  useEffect(() => {
    if (addTabTouched.current) {
      saveState({ addTab });
    }
  }, [addTab, saveState]);

  useEffect(() => {
    fetchTasks();
    const unsub = connectSSE();
    return () => unsub();
  }, [fetchTasks, connectSSE]);

  const { sniffTaskEventId, lastSniffTaskEvent } = useTaskStore();
  useEffect(() => {
    if (sniffTaskEventId === 0 || !lastSniffTaskEvent) return;
    const evt = lastSniffTaskEvent;
    if (evt.action === "galleryCreated") {
      toast.info("tasks.sniffResults", { found: evt.totalCreated ?? 0, skipped: evt.totalSkipped ?? 0 });
    }
  }, [sniffTaskEventId, lastSniffTaskEvent]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const t of tasks) {
      const effectiveStatus = getEffectiveFilterStatus(t);
      if (effectiveStatus === "scrape_pending") {
        counts["scraping"] = (counts["scraping"] || 0) + 1;
      } else if (effectiveStatus === "download_pending") {
        counts["downloading"] = (counts["downloading"] || 0) + 1;
      } else {
        counts[effectiveStatus] = (counts[effectiveStatus] || 0) + 1;
      }
    }
    return counts;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;

    if (statusFilter !== "all") {
      const groupStatuses = STATUS_FILTER_GROUPS[statusFilter];
      if (groupStatuses) {
        result = result.filter((t) => {
          const effectiveStatus = getEffectiveFilterStatus(t);
          return groupStatuses.includes(effectiveStatus);
        });
      } else {
        result = result.filter((t) => getEffectiveFilterStatus(t) === statusFilter);
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

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTasks = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [filteredTasks, safePage, pageSize]);

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

  const { handleSubmit, handleAction, handleDelete, handleBatchAction } = useTaskActions({
    tasks,
    selectedIds,
    setSelectedIds,
    fetchTasks,
    t,
  });

  const toggleExpand = useCallback((task: DownloadTask): void => {
    const key = task.DisplayID ?? String(task.ID);
    setExpandedTask(expandedTask === key ? null : key);
  }, [expandedTask, setExpandedTask]);

  const toggleSelect = useCallback((key: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback((): void => {
    if (selectedIds.size === filteredTasks.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTasks.map((t) => `${t.TaskType || "video"}-${t.ID}`)));
    }
  }, [selectedIds, filteredTasks]);

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
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 88, whiteSpace: "nowrap" }}>
                    <button
                      onClick={toggleSelectAll}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        color: allSelected || someSelected ? "var(--accent)" : "var(--text-muted)",
                        marginRight: 6,
                        verticalAlign: "middle",
                      }}
                      title={allSelected ? t("tasks.deselectAll") : t("tasks.selectAll")}
                    >
                      {allSelected || someSelected ? <CheckSquare size={16} /> : <SquareIcon size={16} />}
                    </button>
                    {t("tasks.colId")}
                  </th>
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
                {paginatedTasks.map((task) => (
                  <TaskTableRow
                    key={`${task.TaskType || "video"}-${task.ID}`}
                    task={task}
                    isSelected={selectedIds.has(`${task.TaskType || "video"}-${task.ID}`)}
                    onToggleSelect={toggleSelect}
                    onToggleExpand={toggleExpand}
                    onAction={handleAction}
                    onDelete={handleDelete}
                    STATUS_LABEL={STATUS_LABEL}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filteredTasks.length > pageSize && (
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
                currentPage={safePage}
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
        )}
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
