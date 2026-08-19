import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/i18n/toast";
import {
  Search,
  Square,
  RefreshCw,
  Plus,
  Trash2,
  Loader2,
  Inbox,
} from "lucide-react";
import { useSniffStore, SNIFF_ACTIVE_STATUSES, type SniffTask } from "@/store/sniff-store";
import { useI18n } from "@/lib/i18n";

const POLL_INTERVAL = 2000;

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "common.pending",
  scraping: "common.scraping",
  running: "common.downloading",
  completed: "common.completed",
  failed: "common.failed",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function SniffPage(): React.JSX.Element {
  const { t } = useI18n();
  const { tasks, loading, fetchTasks, startSniff, deleteSniff } = useSniffStore();
  const [inputUrl, setInputUrl] = useState("");
  const [starting, setStarting] = useState(false);

  const runningTask = useMemo(
    () =>
      tasks.find((x) =>
        (SNIFF_ACTIVE_STATUSES as readonly string[]).includes(x.Status),
      ) ?? null,
    [tasks],
  );
  const running = runningTask !== null;

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      fetchTasks();
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [running, fetchTasks]);

  const handleStart = async (): Promise<void> => {
    if (!inputUrl.trim()) {
      toast.error("sniff.pleaseInputLink");
      return;
    }
    setStarting(true);
    try {
      await startSniff(inputUrl.trim());
      setInputUrl("");
      toast.success("sniff.sniffStarted");
      fetchTasks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "sniff.createTaskFailed");
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (): Promise<void> => {
    if (!runningTask) return;
    try {
      await deleteSniff(runningTask.ID);
      toast.success("sniff.sniffStopped");
      fetchTasks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleDelete = async (task: SniffTask): Promise<void> => {
    if (!confirm(t("tasks.confirmDelete", { type: t("tasks.taskTypeSniff"), id: task.DisplayID ?? task.ID }))) return;
    try {
      await deleteSniff(task.ID);
      fetchTasks();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleAdd = async (task: SniffTask): Promise<void> => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: task.URL, format: "mp4" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || t("sniff.createTaskFailed"));
      }
      toast.success("sniff.addedToDownload");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t("sniff.title")}</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">{t("sniff.control")}</div>
        </div>

        <div className="sniff-control">
          <div className="form-group">
            <label>{t("sniff.targetUrl")}</label>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="https://example.com/video-page"
              disabled={running}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleStart();
                }
              }}
            />
          </div>
          {running ? (
            <button
              className="btn btn-danger"
              onClick={handleStop}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner spinner-sm" />
              ) : (
                <>
                  <Square size={16} />
                  {t("sniff.stopSniff")}
                </>
              )}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={starting || loading}
            >
              {starting ? (
                <span className="spinner spinner-sm" />
              ) : (
                <>
                  <Search size={16} />
                  {t("sniff.startSniff")}
                </>
              )}
            </button>
          )}
        </div>

        <div className={`sniff-status-banner ${running ? "active" : ""}`}>
          <span
            className={`status-dot ${running ? "active" : "disconnected"}`}
          />
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {running
              ? t("sniff.sniffRunning", { url: runningTask?.URL || "—" })
              : t("sniff.snifferIdle")}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">{t("sniff.capturedLinks")}</div>
            <div className="card-subtitle">
              {tasks.length > 0
                ? t("sniff.foundStreams", { count: tasks.length })
                : t("sniff.notCaptured")}
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => fetchTasks()}>
            <RefreshCw size={14} />
            {t("common.refresh")}
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Inbox size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">{t("sniff.notCaptured")}</div>
            <div className="empty-state-subtext">
              {t("sniff.startToDiscover")}
            </div>
          </div>
        ) : (
          <div className="sniff-results-list">
            {tasks.map((task) => {
              const statusKey =
                STATUS_LABEL_KEY[task.Status] || task.Status || "—";
              const isBusy = (SNIFF_ACTIVE_STATUSES as readonly string[]).includes(
                task.Status,
              );
              return (
                <div className="sniff-result-item" key={task.ID}>
                  <div className="sniff-result-info">
                    <div className="sniff-result-url" title={task.URL}>
                      {task.URL}
                    </div>
                    <div className="sniff-result-meta">
                      <span className={`badge ${task.Status === "failed" ? "badge-danger" : task.Status === "completed" ? "badge-success" : "badge-info"}`}>
                        {isBusy ? (
                          <Loader2 size={10} style={{ animation: "spin 0.6s linear infinite", marginRight: 4 }} />
                        ) : null}
                        {t(statusKey)}
                      </span>
                      {task.TotalFound > 0 && (
                        <span>
                          {t("sniff.foundStreams", { count: task.TotalFound })}
                        </span>
                      )}
                      {task.TotalCreated > 0 && (
                        <span>
                          {t("tasks.countUnit", { count: task.TotalCreated })}
                        </span>
                      )}
                      {task.TotalSkipped > 0 && (
                        <span>
                          {t("tasks.countUnit", { count: task.TotalSkipped })}
                        </span>
                      )}
                      {task.ErrorMsg && (
                        <span className="text-danger" title={task.ErrorMsg}>
                          {task.ErrorMsg}
                        </span>
                      )}
                      <span>{formatTime(task.CreatedAt)}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {task.Status === "completed" && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleAdd(task)}
                        disabled={isBusy}
                      >
                        <Plus size={14} />
                        {t("common.addTask")}
                      </button>
                    )}
                    <button
                      className="btn btn-outline btn-sm"
                      style={{ color: "var(--danger)" }}
                      onClick={() => handleDelete(task)}
                      title={t("common.delete")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
