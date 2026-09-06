export type VideoStatusFilter = "all" | "scraping" | "downloading" | "completed" | "failed";
export type VideoSortBy = "date_desc" | "date_asc" | "size_desc";

/** One entry of GET /api/videos — a video-pipeline download (download_tasks ⋈ video_infos). */
export interface VideoShelfItem {
  ID: number;
  DisplayID: string;
  Title: string;
  Status: string;
  Progress: number;
  Duration: number;
  Resolution: string;
  TotalSize: number;
  SourceURL: string;
  CreatedAt: string;
  UpdatedAt: string;
  HasFile: boolean;
}

/** Direct stream URL (http.ServeFile → Range support, seekable). */
export function videoFileUrl(id: number): string {
  return `/api/videos/${id}/file`;
}

export const VIDEO_FILTER_PILLS: { value: VideoStatusFilter; labelKey: string }[] = [
  { value: "all", labelKey: "video.filterAll" },
  { value: "scraping", labelKey: "video.filterScraping" },
  { value: "downloading", labelKey: "video.filterDownloading" },
  { value: "completed", labelKey: "video.filterCompleted" },
  { value: "failed", labelKey: "video.filterFailed" },
];

export const VIDEO_SORT_OPTIONS = [
  { value: "date_desc", labelKey: "video.sortDateDesc" },
  { value: "date_asc", labelKey: "video.sortDateAsc" },
  { value: "size_desc", labelKey: "video.sortSizeDesc" },
];

export const VIDEO_STATUS_LABEL: Record<string, string> = {
  scraping: "video.statusScraping",
  scrape_pending: "video.statusScrapePending",
  completed: "video.statusCompleted",
  downloading: "video.statusDownloading",
  download_pending: "video.statusDownloadPending",
  partial: "video.statusPartial",
  failed: "video.statusFailed",
  pending: "video.statusPending",
};

export const VIDEO_STATUS_CLASS: Record<string, string> = {
  scraping: "badge-info",
  scrape_pending: "badge-info",
  completed: "badge-success",
  downloading: "badge-info",
  download_pending: "badge-info",
  partial: "badge-warning",
  failed: "badge-danger",
  pending: "badge-default",
};

/**
 * DB duration semantics: video_infos.duration (and gallery_videos.duration)
 * stores MINUTES — manager.go writes `durationSeconds/60` rounded to 0.1
 * after probing the transcoded MP4, and every other consumer (tasks page
 * "durationMinutes", gallery detail "min") reads it as minutes.
 *
 * 12.8 → "12:48"; 75.5 → "1:15:30"; 0 → "—"
 */
export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return "—";
  return formatClock(minutes * 60);
}

/**
 * Clock format for HTMLMediaElement.duration (seconds, from the real file
 * metadata): 128.4 → "2:08"; 3725 → "1:02:05".
 */
export function formatClock(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}
