export type VideoStatusFilter = "all" | "scraping" | "downloading" | "completed" | "failed";
export type VideoSortBy = "date_desc" | "date_asc" | "videos_desc" | "size_desc";

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
  { value: "videos_desc", labelKey: "video.sortVideosDesc" },
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
