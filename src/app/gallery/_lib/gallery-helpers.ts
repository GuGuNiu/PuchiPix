export const GALLERY_STATUS_LABEL: Record<string, string> = {
  scraping: "gallery.statusScraping",
  completed: "gallery.statusCompleted",
  downloading: "gallery.statusDownloading",
  partial: "gallery.statusPartial",
  failed: "gallery.statusFailed",
  pending: "gallery.statusPending",
};

export const GALLERY_STATUS_CLASS: Record<string, string> = {
  scraping: "badge-info",
  completed: "badge-success",
  downloading: "badge-info",
  partial: "badge-warning",
  failed: "badge-danger",
  pending: "badge-default",
};

export type StatusFilter = "all" | "scraping" | "downloading" | "completed" | "failed";
export type SortBy = "date_desc" | "date_asc" | "images_desc";

export const FILTER_PILLS: { value: StatusFilter; labelKey: string }[] = [
  { value: "all", labelKey: "gallery.filterAll" },
  { value: "scraping", labelKey: "gallery.filterScraping" },
  { value: "downloading", labelKey: "gallery.filterDownloading" },
  { value: "completed", labelKey: "gallery.filterCompleted" },
  { value: "failed", labelKey: "gallery.filterFailed" },
];

export const SORT_OPTIONS = [
  { value: "date_desc", labelKey: "gallery.sortDateDesc" },
  { value: "date_asc", labelKey: "gallery.sortDateAsc" },
  { value: "images_desc", labelKey: "gallery.sortImagesDesc" },
];

export type ZipStatus = 'idle' | 'downloading' | 'completed' | 'failed' | 'extracting';

export interface ImageItem {
  ID: number;
  LocalPath?: string;
  URL: string;
  Status: string;
  PageIndex: number;
  OrderIndex: number;
}
