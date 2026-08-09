import { useCallback } from "react";
import { toast } from "@/lib/i18n/toast";
import type { DownloadTask } from "@/types";
import { useTaskStore } from "@/store/task-store";
import { actionLabel, type TranslateFunction } from "./task-helpers";

interface UseTaskActionsParams {
  tasks: DownloadTask[];
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  fetchTasks: () => void;
  t: TranslateFunction;
}

export function useTaskActions({
  tasks,
  selectedIds,
  setSelectedIds,
  fetchTasks,
  t,
}: UseTaskActionsParams): {
  handleSubmit: (linkInput: string, setLinkInput: (v: string) => void, setShowAddModal: (v: boolean) => void) => void;
  handleAction: (task: DownloadTask, action: string) => Promise<void>;
  handleDelete: (task: DownloadTask) => Promise<void>;
  handleBatchAction: (action: string) => Promise<void>;
} {
  const handleSubmit = useCallback(
    (linkInput: string, setLinkInput: (v: string) => void, setShowAddModal: (v: boolean) => void): void => {
      const parsedUrls = linkInput
        .split(/[\n\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.startsWith("http://") || s.startsWith("https://"));

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
          .then(async (res) => {
            if (res.status === 409) {
              const data = await res.json();
              const matchTypeText: Record<string, string> = {
                exact: t("createTask.exactMatch"),
                mirror: t("createTask.mirrorMatch"),
                path: t("createTask.pathMatch"),
              };
              const matchLabel = matchTypeText[data.matchType] || t("createTask.matchFallback");
              const idLabel = data.type === 'gallery'
                ? t("createTask.galleryLabel", { id: data.galleryId })
                : t("createTask.taskLabel", { id: data.taskId });

              toast.warning(
                t("createTask.duplicateRecord", {
                  matchLabel,
                  idLabel,
                  status: data.existingStatus || t("createTask.unknownStatus"),
                  urlInfo: data.existingUrl ? t("createTask.existingUrl", { url: data.existingUrl }) : '',
                }),
                { duration: 8000 },
              );
              return null;
            }

            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          })
          .then((data) => {
            if (data === null) return;

            /*
             * API now returns complete DownloadTask object for all types.
             * No more placeholder construction needed — SSE gallery:created
             * event will also arrive for real-time updates.
             */
            if (data?.ID) {
              useTaskStore.getState().addTask(data as DownloadTask);
              const idLabel = data.DisplayID ?? data.ID;
              if (data.TaskType === "gallery") {
                toast.success("tasks.galleryTaskCreated", { id: idLabel });
              } else if (data.TaskType === "sniff") {
                toast.success("tasks.sniffTaskCreated", { id: idLabel });
              } else {
                toast.success("tasks.videoTaskCreated", { id: idLabel });
              }
            }
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error("tasks.addFailedShort", { error: msg });
          });
      }
    },
    []
  );

  const handleAction = useCallback(
    async (task: DownloadTask, action: string) => {
      const isGallery = task.TaskType === "gallery";
      const isSniff = task.TaskType === "sniff";
      const taskId = task.ID;

      const resolveEndpoint = (): string | null => {
        if (isSniff) {
          // Sniff tasks are managed under /api/sniff, not /api/tasks.
          return action === "delete" ? `/api/sniff?id=${taskId}` : null;
        }
        if (isGallery) {
          const galleryActions = ["start", "retry", "pause", "resume", "delete"];
          if (galleryActions.includes(action)) return `/api/shelf/${taskId}`;
          return null;
        }
        return `/api/tasks/${taskId}`;
      };

      const endpoint = resolveEndpoint();
      if (!endpoint) {
        const msgKey = isSniff ? "tasks.sniffTaskNotSupported" : "tasks.galleryTaskNotSupported";
        toast.warning(msgKey, { action: actionLabel(action, t) });
        return;
      }

      try {
        const method = action === "delete" ? "DELETE" : "POST";
        const label = isSniff ? t("tasks.taskTypeSniff") : isGallery ? t("tasks.taskTypeGallery") : t("tasks.taskTypeTask");
        toast.info("tasks.taskActionSubmitting", { type: label, id: task.DisplayID ?? taskId, action: actionLabel(action, t) });

        const fetchOpts: RequestInit = { method };
        if (!isSniff && action !== "delete") {
          /*
           * Generic action name sent directly to backend.
           * Backend routes to specific operation based on task status.
           * (Previously frontend translated: start → resume/retry-failed, etc.)
           */
          fetchOpts.headers = { "Content-Type": "application/json" };
          fetchOpts.body = JSON.stringify({ action });
        }
        const res = await fetch(endpoint, fetchOpts);
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
      const isGallery = task.TaskType === "gallery";
      const isSniff = task.TaskType === "sniff";
      const taskId = task.ID;
      const taskType = isSniff ? "sniff" : isGallery ? "gallery" : "video";
      const label = isSniff ? t("tasks.taskTypeSniff") : isGallery ? t("tasks.taskTypeGallery") : t("tasks.taskTypeTask");
      if (!confirm(t("tasks.confirmDelete", { type: label, id: task.DisplayID ?? taskId }))) return;

      useTaskStore.getState().removeTask(taskId, taskType);

      try {
        const endpoint = isSniff ? `/api/sniff?id=${taskId}` : isGallery ? `/api/shelf/${taskId}` : `/api/tasks/${taskId}`;
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

  /*
   * Batch action: frontend uses server-provided AllowedActions field
   * to determine applicable tasks, eliminating 40+ lines of hardcoded
   * status-action qualification logic.
   */
  const handleBatchAction = useCallback(
    async (action: string) => {
      if (selectedIds.size === 0) {
        toast.error("tasks.pleaseSelectTasks");
        return;
      }
      const keys = Array.from(selectedIds);
      const isDelete = action === "delete";

      if (isDelete && !confirm(t("tasks.confirmBatchDelete", { count: keys.length }))) return;

      const selectedTasks = keys
        .map((key) => tasks.find((t) => `${t.TaskType || "video"}-${t.ID}` === key))
        .filter((t): t is DownloadTask => !!t);

      if (isDelete) {
        selectedTasks.forEach((task) => {
          const taskType = task.TaskType === "sniff" ? "sniff" : task.TaskType === "gallery" ? "gallery" : "video";
          useTaskStore.getState().removeTask(task.ID, taskType);
        });

        const results = await Promise.allSettled(
          selectedTasks.map((task) => {
            const isGallery = task.TaskType === "gallery";
            const isSniff = task.TaskType === "sniff";
            const endpoint = isSniff
              ? `/api/sniff?id=${task.ID}`
              : isGallery
                ? `/api/shelf/${task.ID}`
                : `/api/tasks/${task.ID}`;
            return fetch(endpoint, { method: "DELETE" });
          })
        );

        const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
        const fail = results.length - ok;
        setSelectedIds(new Set());
        if (fail === 0) {
          toast.success("tasks.batchDeleteComplete", { count: ok });
        } else {
          toast.warning("tasks.batchResult", { ok, fail });
          results.forEach((r, i) => {
            if (r.status !== "fulfilled" || !r.value.ok) {
              const task = selectedTasks[i];
              const taskType = task.TaskType === "sniff" ? "sniff" : task.TaskType === "gallery" ? "gallery" : "video";
              useTaskStore.getState().clearDeletedKey(task.ID, taskType);
            }
          });
          fetchTasks();
        }
        return;
      }

      /*
       * Use server-provided AllowedActions to determine which tasks
       * can perform the requested action. Tasks without the action
       * in their AllowedActions are skipped.
       */
      const applicable: DownloadTask[] = [];
      let skipped = 0;

      for (const task of selectedTasks) {
        const allowed = task.AllowedActions ?? [];
        if (allowed.includes(action)) {
          applicable.push(task);
        } else {
          skipped++;
        }
      }

      if (applicable.length === 0) {
        toast.info(t("tasks.noApplicableTasks", { action: actionLabel(action, t), skipped }));
        return;
      }

      const results = await Promise.allSettled(
        applicable.map((task) => {
          const isGallery = task.TaskType === "gallery";
          const id = task.ID;
          const endpoint = isGallery ? `/api/shelf/${id}` : `/api/tasks/${id}`;
          return fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
        })
      );

      const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
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

  return { handleSubmit, handleAction, handleDelete, handleBatchAction };
}
