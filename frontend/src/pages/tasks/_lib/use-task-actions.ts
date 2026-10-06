import { useCallback, useRef } from "react";
import { toast } from "@/lib/i18n/toast";
import type { DownloadTask, TaskStatus } from "@/types";
import { useTaskStore } from "@/store/task-store";
import { actionLabel, getAllowedActions, type TranslateFunction } from "./task-helpers";

interface UseTaskActionsParams {
  tasks: DownloadTask[];
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  fetchTasks: () => Promise<void>;
  t: TranslateFunction;
}

const REQUEST_TIMEOUT_MS = 60_000;
const SUBMIT_CONCURRENCY = 5;
const DELETE_CONCURRENCY = 3;
const ACTION_CONCURRENCY = 4;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function responseError(data: unknown, status: number): string {
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error) return error;
  }
  return `HTTP ${status}`;
}

async function requestJSON(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchWithTimeout(url, init);
  const data = await readResponse(response);
  if (!response.ok) {
    throw new Error(responseError(data, response.status));
  }
  return data;
}

async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;
  const run = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

function taskTypeOf(task: DownloadTask): "video" | "gallery" | "sniff" {
  if (task.TaskType === "gallery") return "gallery";
  if (task.TaskType === "sniff") return "sniff";
  return "video";
}

function taskKeyOf(task: DownloadTask): string {
  return `${taskTypeOf(task)}-${task.ID}`;
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
  const batchInFlightRef = useRef(false);

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
      if (parsedUrls.length > 1) {
        toast.success("tasks.addingTasksInBackground", { count: parsedUrls.length });
      } else {
        toast.success("tasks.taskCreating");
      }

      void (async () => {
        let created = 0;
        let skipped = 0;
        let failed = 0;
        const results = await runBounded(parsedUrls, SUBMIT_CONCURRENCY, async (url) => {
          const response = await fetchWithTimeout("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const data = await readResponse(response);
          if (response.status === 409) {
            return "skipped" as const;
          }
          if (!response.ok) {
            throw new Error(responseError(data, response.status));
          }
          if (data && typeof data === "object" && "ID" in data) {
            const task = data as DownloadTask;
            if (task.TaskType !== "sniff") {
              useTaskStore.getState().addTask(task);
            }
          }
          return "created" as const;
        });

        results.forEach((result) => {
          if (result.status === "rejected") {
            failed++;
            const reason = result.reason;
            toast.error("tasks.addFailedShort", {
              error: reason instanceof Error ? reason.message : String(reason),
            });
            return;
          }
          if (result.value === "created") created++;
          else skipped++;
        });

        if (parsedUrls.length > 1) {
          if (failed === 0) {
            toast.success("tasks.batchSubmitComplete", { count: created });
          } else {
            toast.warning("tasks.batchSubmitPartial", { ok: created, fail: failed });
          }
        } else if (skipped > 0) {
          toast.info("tasks.batchSubmitComplete", { count: skipped });
        }
      })();
    },
    [t]
  );

  const computeOptimisticStatus = useCallback(
    (task: DownloadTask, action: string): { Status: TaskStatus; AllowedActions: string[] } | null => {
      const taskType = taskTypeOf(task);
      let status: TaskStatus | null = null;
      switch (action) {
        case "start":
        case "retry":
        case "resume":
          status = "preparing";
          break;
        case "pause":
          status = "paused";
          break;
        case "cancel":
          status = "cancelled";
          break;
        default:
          return null;
      }
      return { Status: status, AllowedActions: getAllowedActions(status, taskType) };
    },
    []
  );

  const handleAction = useCallback(
    async (task: DownloadTask, action: string) => {
      if (useTaskStore.getState().batchActionInProgress) return;
      const taskType = taskTypeOf(task);
      const taskId = task.ID;
      const endpoint = taskType === "sniff"
        ? action === "delete" ? `/api/sniff?id=${taskId}` : null
        : taskType === "gallery"
          ? `/api/shelf/${taskId}`
          : `/api/tasks/${taskId}`;

      if (!endpoint) {
        const msgKey = taskType === "sniff" ? "tasks.sniffTaskNotSupported" : "tasks.galleryTaskNotSupported";
        toast.warning(msgKey, { action: actionLabel(action, t) });
        return;
      }

      try {
        const label = taskType === "sniff" ? t("tasks.taskTypeSniff") : taskType === "gallery" ? t("tasks.taskTypeGallery") : t("tasks.taskTypeTask");
        toast.info("tasks.taskActionSubmitting", {
          type: label,
          id: task.DisplayID ?? taskId,
          action: actionLabel(action, t),
        });
        const method = action === "delete" ? "DELETE" : "POST";
        if (action !== "delete") {
          useTaskStore.getState().markTaskAction(taskId, taskType);
        }
        const init: RequestInit = { method };
        if (taskType !== "sniff" && action !== "delete") {
          init.headers = { "Content-Type": "application/json" };
          init.body = JSON.stringify({ action });
        }
        const data = await requestJSON(endpoint, init);
        const responseStatus = data && typeof data === "object" && "status" in data
          ? (data as { status?: string }).status
          : undefined;
        if (responseStatus === "already-running") {
          useTaskStore.getState().clearTaskAction(taskId, taskType);
        } else {
          const optimistic = computeOptimisticStatus(task, action);
          if (optimistic) {
            useTaskStore.getState().updateTask(taskId, taskType, optimistic);
          }
        }
        await fetchTasks();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
        if (action !== "delete") {
          useTaskStore.getState().clearTaskAction(taskId, taskType);
        }
        await fetchTasks();
      }
    },
    [computeOptimisticStatus, fetchTasks, t]
  );

  const handleDelete = useCallback(
    async (task: DownloadTask) => {
      if (useTaskStore.getState().batchActionInProgress) return;
      const taskType = taskTypeOf(task);
      const taskId = task.ID;
      const label = taskType === "sniff" ? t("tasks.taskTypeSniff") : taskType === "gallery" ? t("tasks.taskTypeGallery") : t("tasks.taskTypeTask");
      if (!confirm(t("tasks.confirmDelete", { type: label, id: task.DisplayID ?? taskId }))) return;

      useTaskStore.getState().removeTask(taskId, taskType);
      const endpoint = taskType === "sniff" ? `/api/sniff?id=${taskId}` : taskType === "gallery" ? `/api/shelf/${taskId}` : `/api/tasks/${taskId}`;
      try {
        await requestJSON(endpoint, { method: "DELETE" });
        toast.success("tasks.deleted", { type: label, id: task.DisplayID ?? taskId });
        await fetchTasks();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(msg);
        useTaskStore.getState().clearDeletedKey(taskId, taskType);
        useTaskStore.getState().addTask(task);
        await fetchTasks();
      }
    },
    [fetchTasks, t]
  );

  const handleBatchAction = useCallback(
    async (action: string) => {
      if (batchInFlightRef.current) return;
      if (selectedIds.size === 0) {
        toast.error("tasks.pleaseSelectTasks");
        return;
      }

      const keys = Array.from(selectedIds);
      const selectedTasks = keys
        .map((key) => tasks.find((task) => taskKeyOf(task) === key))
        .filter((task): task is DownloadTask => !!task);
      if (selectedTasks.length === 0) {
        toast.error("tasks.pleaseSelectTasks");
        return;
      }

      const isDelete = action === "delete";
      if (isDelete && !confirm(t("tasks.confirmBatchDelete", { count: selectedTasks.length }))) return;

      batchInFlightRef.current = true;
      useTaskStore.getState().setBatchActionInProgress(true);
      try {
        if (isDelete) {
          selectedTasks.forEach((task) => useTaskStore.getState().removeTask(task.ID, taskTypeOf(task)));
          const results = await runBounded(selectedTasks, DELETE_CONCURRENCY, async (task) => {
            const endpoint = taskTypeOf(task) === "sniff"
              ? `/api/sniff?id=${task.ID}`
              : taskTypeOf(task) === "gallery"
                ? `/api/shelf/${task.ID}`
                : `/api/tasks/${task.ID}`;
            return requestJSON(endpoint, { method: "DELETE" });
          });
          const failedKeys = new Set<string>();
          let ok = 0;
          results.forEach((result, index) => {
            const task = selectedTasks[index];
            if (result.status === "fulfilled") {
              ok++;
              return;
            }
            failedKeys.add(taskKeyOf(task));
            useTaskStore.getState().clearDeletedKey(task.ID, taskTypeOf(task));
            useTaskStore.getState().addTask(task);
          });
          setSelectedIds(failedKeys);
          const fail = failedKeys.size;
          if (fail === 0) {
            toast.success("tasks.batchDeleteComplete", { count: ok });
          } else {
            toast.warning("tasks.batchResult", { ok, fail });
          }
          await fetchTasks();
          return;
        }

        const applicable: DownloadTask[] = [];
        let skipped = 0;
        for (const task of selectedTasks) {
          if (getAllowedActions(task.Status, taskTypeOf(task)).includes(action)) {
            applicable.push(task);
          } else {
            skipped++;
          }
        }
        if (applicable.length === 0) {
          toast.info(t("tasks.noApplicableTasks", { action: actionLabel(action, t), skipped }));
          return;
        }

        applicable.forEach((task) => {
          useTaskStore.getState().markTaskAction(task.ID, taskTypeOf(task));
        });
        const results = await runBounded(applicable, ACTION_CONCURRENCY, async (task) => {
          const endpoint = taskTypeOf(task) === "gallery" ? `/api/shelf/${task.ID}` : `/api/tasks/${task.ID}`;
          return requestJSON(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          });
        });
        let ok = 0;
        let noop = 0;
        let fail = 0;
        results.forEach((result, index) => {
          if (result.status === "rejected") {
            fail++;
            const task = applicable[index];
            useTaskStore.getState().clearTaskAction(task.ID, taskTypeOf(task));
            return;
          }
          const data = result.value;
          const responseStatus = data && typeof data === "object" && "status" in data
            ? (data as { status?: string }).status
            : undefined;
          if (responseStatus === "already-running") {
            noop++;
            const task = applicable[index];
            useTaskStore.getState().clearTaskAction(task.ID, taskTypeOf(task));
          } else ok++;
        });
        skipped += noop;
        if (fail === 0 && skipped === 0) {
          toast.success(t("tasks.batchActionComplete", { action: actionLabel(action, t), count: ok }));
        } else if (fail === 0) {
          toast.success(t("tasks.batchActionCompleteWithSkipped", { action: actionLabel(action, t), count: ok, skipped }));
        } else {
          toast.warning(t("tasks.batchResultWithSkipped", { ok, fail, skipped }));
        }
        await fetchTasks();
      } finally {
        batchInFlightRef.current = false;
        useTaskStore.getState().setBatchActionInProgress(false);
      }
    },
    [fetchTasks, selectedIds, setSelectedIds, t, tasks]
  );

  return { handleSubmit, handleAction, handleDelete, handleBatchAction };
}
