import { useCallback } from "react";
import { toast } from "@/lib/i18n/toast";
import type { DownloadTask, TaskStatus } from "@/types";
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

      const SUBMIT_CONCURRENCY = 5;
      let nextIndex = 0;
      let succeeded = 0;
      let failed = 0;
      let finished = 0;
      const total = urls.length;

      const submitOne = (u: string): void => {
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

            if (data?.ID) {
              useTaskStore.getState().addTask(data as DownloadTask);
            }
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            toast.error("tasks.addFailedShort", { error: msg });
            failed++;
          })
          .finally(() => {
            succeeded++;
            finished++;
            if (nextIndex < total) {
              submitOne(urls[nextIndex++]);
            } else if (finished === total) {
              if (total > 1) {
                if (failed === 0) {
                  toast.success("tasks.batchSubmitComplete", { count: succeeded });
                } else {
                  toast.warning("tasks.batchSubmitPartial", { ok: succeeded, fail: failed });
                }
              }
            }
          });
      };

      const seedCount = Math.min(SUBMIT_CONCURRENCY, total);
      for (let i = 0; i < seedCount; i++) {
        submitOne(urls[nextIndex++]);
      }
    },
    [t]
  );

  const handleAction = useCallback(
    async (task: DownloadTask, action: string) => {
      const isGallery = task.TaskType === "gallery";
      const isSniff = task.TaskType === "sniff";
      const taskId = task.ID;

      const resolveEndpoint = (): string | null => {
        if (isSniff) {
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
          fetchOpts.headers = { "Content-Type": "application/json" };
          fetchOpts.body = JSON.stringify({ action });
        }
        const res = await fetch(endpoint, fetchOpts);
        if (!res.ok) throw new Error(await res.text());

        const optimistic = computeOptimisticStatus(task, action);
        if (optimistic) {
          useTaskStore.getState().updateTask(
            task.ID,
            isGallery ? "gallery" : isSniff ? "sniff" : "video",
            optimistic,
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
      }
    },
    [t]
  );

  function computeOptimisticStatus(
    task: DownloadTask,
    action: string,
  ): { Status: TaskStatus; AllowedActions: string[] } | null {
    const isGallery = task.TaskType === "gallery";
    const hasScraped = (task.ImageCount ?? 0) > 0 || (task.VideoCount ?? 0) > 0;

    switch (action) {
      case "start":
      case "retry":
      case "resume":
        // 乐观更新为 preparing 状态，让用户立即感知操作生效
        // 后续由 SSE 推送真实的 scraping/downloading 状态
        if (isGallery) {
          return { Status: "preparing", AllowedActions: ["pause", "delete"] };
        }
        return { Status: "preparing", AllowedActions: ["pause", "delete"] };

      case "pause":
        return { Status: "paused", AllowedActions: ["start", "delete"] };

      default:
        return null;
    }
  }

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

      for (const t of applicable) {
        const tt = t.TaskType === "gallery" ? "gallery" : t.TaskType === "sniff" ? "sniff" : "video";
        const optimistic = computeOptimisticStatus(t, action);
        if (optimistic) {
          useTaskStore.getState().updateTask(t.ID, tt, optimistic);
        }
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
