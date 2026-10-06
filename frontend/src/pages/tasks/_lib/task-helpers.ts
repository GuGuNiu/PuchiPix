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
  /*
   * "pending" is intentionally NOT in the scraping group: held-back tasks
   * (queue-full rejections) are written to DB as "pending" by StatusReporter
   * and must show as waiting, not as actively identifying.
   */
  scraping: ["scraping", "scrape_pending"],
  downloading: ["downloading", "download_pending", "merging", "transcoding", "probing"],
};

export const SORT_OPTION_KEYS = [
  { value: "date_desc", labelKey: "tasks.sortDateDesc" },
  { value: "date_asc", labelKey: "tasks.sortDateAsc" },
  { value: "progress_desc", labelKey: "tasks.sortProgressDesc" },
  { value: "progress_asc", labelKey: "tasks.sortProgressAsc" },
  { value: "status", labelKey: "tasks.sortStatus" },
];

export const STATUS_ORDER: Record<TaskStatus, number> = {
  preparing: 0,
  scraping: 1,
  scraped: 2,
  scrape_pending: 3,
  downloading: 4,
  merging: 5,
  download_pending: 6,
  pending: 7,
  paused: 8,
  transcoding: 9,
  probing: 10,
  failed: 11,
  cancelled: 12,
  partial: 13,
  completed: 14,
};

export function useStatusLabel(t: TranslateFunction): Record<TaskStatus, string> {
  return {
    pending: t("common.pending"),
    preparing: t("common.preparing"),
    scrape_pending: t("common.scrapePending"),
    scraping: t("common.scraping"),
    scraped: t("common.downloadPending"),
    download_pending: t("common.downloadPending"),
    downloading: t("common.downloading"),
    merging: t("tasks.progressStageMerging"),
    paused: t("common.paused"),
    completed: t("common.completed"),
    partial: t("common.partial"),
    failed: t("common.failed"),
    cancelled: t("common.cancelled"),
    transcoding: t("common.transcoding"),
    probing: t("tasks.progressStageProbing"),
  };
}

export function getProgressStage(task: DownloadTask, t: TranslateFunction): string {
  if (task.ProgressStage) {
    return t(task.ProgressStage);
  }
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
  if (task.Status === "merging") return t("tasks.progressStageMerging");
  if (task.Status === "probing") return t("tasks.progressStageProbing");
  /*
   * Post-processing phases are identified by the status field rather
   * than progress thresholds, matching the backend ComputeProgressStage.
   */
  if (task.Status === "transcoding") {
    /*
     * Fallback for rows persisted before "probing" became a real status:
     * the manager emitted exactly one progress=100 event after the ffmpeg
     * transcode completed and before probing duration/resolution; live
     * transcode events are clamped to <100 by the backend parser.
     */
    if (task.Progress >= 100) return t("tasks.progressStageProbing");
    return t("tasks.progressStageTranscoding");
  }
  return t("tasks.progressStageDownloading");
}

export function getAllowedActions(status: TaskStatus, taskType: DownloadTask["TaskType"]): string[] {
  if (taskType === "sniff") return ["delete"];
  if (taskType === "gallery") {
    switch (status) {
      case "pending":
      case "scrape_pending":
      case "scraped":
      case "download_pending":
        return ["start", "pause", "delete"];
      case "scraping":
      case "downloading":
        return ["pause", "cancel", "delete"];
      case "paused":
        return ["start", "resume", "delete"];
      case "failed":
      case "partial":
        return ["retry", "delete"];
      case "completed":
        return ["delete"];
      case "cancelled":
        return ["retry", "delete"];
      default:
        return ["delete"];
    }
  }
  switch (status) {
    case "pending":
      return ["start", "delete"];
    case "scraping":
    case "downloading":
      return ["pause", "cancel", "delete"];
    case "paused":
      return ["resume", "cancel", "delete"];
    case "failed":
    case "cancelled":
      return ["retry", "delete"];
    case "completed":
    case "partial":
      return ["delete"];
    case "scrape_pending":
    case "download_pending":
      return ["pause", "delete"];
    case "transcoding":
    case "merging":
    case "probing":
      return ["cancel", "delete"];
    default:
      return ["delete"];
  }
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

/**
 * Backend rows store tags and actors as JSON-array strings, but SSE payloads
 * and older deployments may still deliver the raw `["a","b"]` literal or a
 * plain comma-separated string; both are decoded here.
 */
export function normalizeStringArray(value: unknown): string[] {
  const cleanValues = (values: unknown[]): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of values) {
      if (typeof item !== 'string') continue;
      const normalized = item.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      const key = normalized.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(normalized);
    }
    return result;
  };

  if (Array.isArray(value)) {
    return cleanValues(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "null" || trimmed === "[]") return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return cleanValues(parsed);
        }
      }
      // Malformed JSON: fall through to the delimited split below.
      catch {
      }
    }
    return cleanValues(trimmed.split(/[,，、|；;｜/／]/));
  }
  return [];
}

/** Resolve the tag list for the detail popover: VideoInfo first, top-level passthrough second. */
export function resolveTaskTags(task: DownloadTask): string[] {
  const fromVideoInfo = normalizeStringArray(task.VideoInfo?.Tags);
  if (fromVideoInfo.length > 0) return fromVideoInfo;
  return normalizeStringArray(task.Tags);
}

/**
 * VideoInfo.Actors first, then the top-level Actors field fed by SSE
 * task:metadata, then the Person column.
 */
export function resolveTaskActors(task: DownloadTask): string[] {
  const fromVideoInfo = normalizeStringArray(task.VideoInfo?.Actors);
  if (fromVideoInfo.length > 0) return fromVideoInfo;
  const fromTask = normalizeStringArray(task.Actors);
  if (fromTask.length > 0) return fromTask;
  return normalizeStringArray(task.Person);
}
