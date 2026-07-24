"use client";

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
          return action === "delete" ? `/api/tasks/sniff?id=${taskId}` : null;
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
        if (isGallery && action !== "delete") {
          const galleryActionMap: Record<string, string> = {
            start: task.Status === "failed" ? "retry-failed" : "resume",
            retry: "retry-failed",
            pause: "pause",
            resume: "resume",
          };
          fetchOpts.headers = { "Content-Type": "application/json" };
          fetchOpts.body = JSON.stringify({ action: galleryActionMap[action] });
        } else if (!isSniff && !isGallery && action !== "delete") {
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
        const endpoint = isSniff ? `/api/tasks/sniff?id=${taskId}` : isGallery ? `/api/shelf/${taskId}` : `/api/tasks/${taskId}`;
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
          .map((key) => tasks.find((t) => `${t.TaskType || "video"}-${t.ID}` === key))
          .filter((t): t is DownloadTask => !!t);

        selectedTasks.forEach((task) => {
          const taskType = task.TaskType === "sniff" ? "sniff" : task.TaskType === "gallery" ? "gallery" : "video";
          useTaskStore.getState().removeTask(task.ID, taskType);
        });

        const results = await Promise.allSettled(
          selectedTasks.map((task) => {
            const isGallery = task.TaskType === "gallery";
            const isSniff = task.TaskType === "sniff";
            const endpoint = isSniff
              ? `/api/tasks/sniff?id=${task.ID}`
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

      const selectedTasks = keys
        .map((key) => tasks.find((t) => `${t.TaskType || "video"}-${t.ID}` === key))
        .filter((t): t is DownloadTask => !!t);

      const applicable: DownloadTask[] = [];
      let skipped = 0;

      for (const task of selectedTasks) {
        const isGallery = task.TaskType === "gallery";
        const isSniff = task.TaskType === "sniff";

        if (isSniff) {
          skipped++;
          continue;
        }

        if (isGallery) {
          if (action === "start") {
            const startableStatuses = ["pending", "scrape_pending", "download_pending", "paused", "failed", "scraping"];
            if (!startableStatuses.includes(task.Status || "")) {
              skipped++;
            } else {
              applicable.push(task);
            }
          } else if (action === "retry") {
            if (!["failed", "partial"].includes(task.Status || "")) {
              skipped++;
            } else {
              applicable.push(task);
            }
          } else if (action === "pause") {
            const pauseableStatuses = ["scraping", "downloading", "scrape_pending", "download_pending", "pending"];
            if (!pauseableStatuses.includes(task.Status || "")) {
              skipped++;
            } else {
              applicable.push(task);
            }
          } else if (action === "resume") {
            if (task.Status !== "paused") {
              skipped++;
            } else {
              applicable.push(task);
            }
          } else {
            skipped++;
          }
          continue;
        }

        const status = task.Status;
        if (action === "pause" && !["downloading", "scraping"].includes(status || "")) {
          skipped++;
        } else if (action === "start" && !["pending", "paused", "failed", "cancelled"].includes(status || "")) {
          skipped++;
        } else if (action === "retry" && !["failed", "cancelled"].includes(status || "")) {
          skipped++;
        } else if (action === "cancel" && !["downloading", "paused", "pending", "scraping"].includes(status || "")) {
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
          const isGallery = task.TaskType === "gallery";
          const id = task.ID;
          if (isGallery) {
            const galleryAction =
              action === "start"
                ? task.Status === "failed"
                  ? "retry-failed"
                  : "resume"
                : action === "retry"
                  ? "retry-failed"
                  : action === "pause"
                    ? "pause"
                    : action === "resume"
                      ? "resume"
                      : null;
            if (galleryAction) {
              return fetch(`/api/shelf/${id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: galleryAction }),
              });
            }
          }
          if (action === "start" && ["failed", "cancelled"].includes(task.Status || "")) {
            return fetch(`/api/tasks/${id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "retry" }),
            });
          }
          return fetch(`/api/tasks/${id}`, {
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
