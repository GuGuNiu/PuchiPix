import type { TaskStatus, DownloadTask } from "@/types";
import { formatFileSize } from "@/lib/utils";

// 重新导出 formatFileSize 以保持向后兼容
export { formatFileSize };

export type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

export type StatusFilter = "all" | TaskStatus;
export type TypeFilter = "all" | "video" | "gallery" | "sniff";
export type SortBy = "date_desc" | "date_asc" | "progress_desc" | "progress_asc" | "status";

export const TYPE_PILL_KEYS = [
  { value: "all", labelKey: "tasks.typeAll" },
  { value: "video", labelKey: "tasks.typeVideo" },
  { value: "gallery", labelKey: "tasks.typeGallery" },
  { value: "sniff", labelKey: "tasks.typeSniff" },
];

export const FILTER_PILL_KEYS = [
  { value: "all", labelKey: "tasks.typeAll" },
  { value: "scraping", labelKey: "common.scraping" },
  { value: "pending", labelKey: "common.pending" },
  { value: "downloading", labelKey: "common.downloading" },
  { value: "completed", labelKey: "common.completed" },
  { value: "failed", labelKey: "common.failed" },
];

export const SORT_OPTION_KEYS = [
  { value: "date_desc", labelKey: "tasks.sortDateDesc" },
  { value: "date_asc", labelKey: "tasks.sortDateAsc" },
  { value: "progress_desc", labelKey: "tasks.sortProgressDesc" },
  { value: "progress_asc", labelKey: "tasks.sortProgressAsc" },
  { value: "status", labelKey: "tasks.sortStatus" },
];

export const STATUS_ORDER: Record<TaskStatus, number> = {
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

export function useStatusLabel(t: TranslateFunction): Record<TaskStatus, string> {
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

/**
 * 从标题中去除人物名前缀
 * 如果标题以人物名开头，去除人物名及后续的分隔符（-、—、–）
 */
export function stripPersonFromTitle(title: string, person?: string): string {
  if (!title || !person) return title;
  if (title.startsWith(person)) {
    const after = title.slice(person.length);
    return after.replace(/^[\s\-\u2013\u2014]+/, "").trim() || title;
  }
  return title;
}

/**
 * 根据任务状态和进度推断当前处理阶段
 */
export function getProgressStage(task: DownloadTask, t: TranslateFunction): string {
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

export function actionLabel(action: string, t: TranslateFunction): string {
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
