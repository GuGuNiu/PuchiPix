import type { TaskStatus, DownloadTask } from "@/types";
import { formatFileSize } from "@/lib/utils";

export { formatFileSize };

export type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

export type StatusFilter = "all" | TaskStatus;
export type TypeFilter = "all" | "video" | "gallery" | "sniff";
export type SortBy = "date_desc" | "date_asc" | "progress_desc" | "progress_asc" | "status";

export const TYPE_PILL_KEYS = [
  { value: "all", labelKey: "tasks.typeAll", icon: "layers" as const },
  { value: "video", labelKey: "tasks.typeVideo", icon: "film" as const },
  { value: "gallery", labelKey: "tasks.typeGallery", icon: "image" as const },
  { value: "sniff", labelKey: "tasks.typeSniff", icon: "wifi" as const },
];

export const FILTER_PILL_KEYS = [
  { value: "all", labelKey: "tasks.typeAll" },
  { value: "scraping", labelKey: "common.scraping" },
  { value: "downloading", labelKey: "common.downloading" },
  { value: "pending", labelKey: "common.pending" },
  { value: "completed", labelKey: "common.completed" },
  { value: "failed", labelKey: "common.failed" },
];

export const STATUS_FILTER_GROUPS: Record<string, TaskStatus[]> = {
  scraping: ["scraping", "scrape_pending", "pending"],
  downloading: ["downloading", "download_pending", "transcoding"],
};

export const SORT_OPTION_KEYS = [
  { value: "date_desc", labelKey: "tasks.sortDateDesc" },
  { value: "date_asc", labelKey: "tasks.sortDateAsc" },
  { value: "progress_desc", labelKey: "tasks.sortProgressDesc" },
  { value: "progress_asc", labelKey: "tasks.sortProgressAsc" },
  { value: "status", labelKey: "tasks.sortStatus" },
];

export const STATUS_ORDER: Record<TaskStatus, number> = {
  scraping: 0,
  scrape_pending: 1,
  downloading: 2,
  download_pending: 3,
  pending: 4,
  paused: 5,
  transcoding: 6,
  failed: 7,
  cancelled: 8,
  partial: 9,
  completed: 10,
};

export function useStatusLabel(t: TranslateFunction): Record<TaskStatus, string> {
  return {
    pending: t("common.pending"),
    scrape_pending: t("common.scrapePending"),
    scraping: t("common.scraping"),
    download_pending: t("common.downloadPending"),
    downloading: t("common.downloading"),
    paused: t("common.paused"),
    completed: t("common.completed"),
    partial: t("common.partial"),
    failed: t("common.failed"),
    cancelled: t("common.cancelled"),
    transcoding: t("common.transcoding"),
  };
}

export function getProgressStage(task: DownloadTask, t: TranslateFunction): string {
  if (task.ProgressStage) {
    return t(task.ProgressStage);
  }
  // Fallback for older server responses without ProgressStage field.
  if (task.TaskType === "sniff") {
    if (task.Status === "scraping") return t("tasks.progressStageAnalyzing");
    if (task.Status === "completed") return t("tasks.progressStageCompleted");
    if (task.Status === "failed") return t("tasks.progressStageFailed");
    return t("tasks.progressStagePending");
  }
  if (task.Status === "scraping") return t("tasks.progressStageScraping");
  if (task.Status === "scrape_pending") return t("tasks.progressStageScrapePending");
  if (task.Status === "download_pending") return t("tasks.progressStageDownloadPending");
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
