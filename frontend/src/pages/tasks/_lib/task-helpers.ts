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
  // "pending" is intentionally NOT in the scraping group: held-back tasks
  // (queue-full rejections) are written to DB as "pending" by StatusReporter
  // and must show as waiting, not as actively identifying.
  scraping: ["scraping", "scrape_pending"],
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
  preparing: 0,
  scraping: 1,
  scrape_pending: 2,
  downloading: 3,
  download_pending: 4,
  pending: 5,
  paused: 6,
  transcoding: 7,
  failed: 8,
  cancelled: 9,
  partial: 10,
  completed: 11,
};

export function useStatusLabel(t: TranslateFunction): Record<TaskStatus, string> {
  return {
    pending: t("common.pending"),
    preparing: t("common.preparing"),
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
  // Post-processing phases are identified by the status field rather
  // than progress thresholds, matching the backend ComputeProgressStage.
  // Note: backend "merging" is surfaced via task.ProgressStage labels,
  // not as a frontend TaskStatus union member.
  if (task.Status === "transcoding") {
    // The manager emits exactly one progress=100 event after the ffmpeg
    // transcode completes and before probing duration/resolution; live
    // transcode events are clamped to <100 by the backend parser. So
    // 100 is the precise "probe window" signal, while any value below
    // it is real transcode percentage.
    if (task.Progress >= 100) return t("tasks.progressStageProbing");
    return t("tasks.progressStageTranscoding");
  }
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

/**
 * Defensive string-array decoder for scraped metadata fields.
 *
 * Backend rows store tags/actors as JSON-array strings; every API layer
 * is expected to decode them already, but SSE payloads and older
 * deployments may still deliver the raw `["a","b"]` literal (or a
 * comma/、-separated plain string). Treating such a value as string[]
 * rendered the whole JSON literal as one giant "tag pill" — this is
 * how the actor of task #HSYZH3 ("欣欣子") ended up displayed as a tag.
 */
export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "null" || trimmed === "[]") return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
        }
      } catch {
        // fall through to delimited split
      }
    }
    return trimmed
      .split(/[,、|;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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
 * Resolve the actor list for the detail popover: VideoInfo → top-level
 * Actors passthrough (SSE task:metadata) → Person column string last,
 * so 演员 still renders for tasks scraped before this field existed.
 */
export function resolveTaskActors(task: DownloadTask): string[] {
  const fromVideoInfo = normalizeStringArray(task.VideoInfo?.Actors);
  if (fromVideoInfo.length > 0) return fromVideoInfo;
  const fromTask = normalizeStringArray(task.Actors);
  if (fromTask.length > 0) return fromTask;
  return normalizeStringArray(task.Person);
}
