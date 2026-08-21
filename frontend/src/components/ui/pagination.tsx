import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";

export interface PaginationProps {
  /** Current active page (1-based) */
  currentPage: number;
  /** Total number of pages */
  totalPages: number;
  /** Total number of items across all pages */
  totalItems?: number;
  /** Number of visible page buttons (default 5) */
  maxVisible?: number;
  /** Called when page changes */
  onPageChange: (page: number) => void;
  /** Custom class name */
  className?: string;
  /** Show total item count */
  showTotal?: boolean;
  /** Labels for accessibility */
  labels?: {
    first?: string;
    previous?: string;
    next?: string;
    last?: string;
    page?: string;
    of?: string;
    items?: string;
  };
}

/** Pagination component with first/prev/numbers/next/last controls. */
export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  maxVisible = 5,
  onPageChange,
  className = "",
  showTotal = true,
  labels,
}: PaginationProps): React.JSX.Element {
  const { t } = useI18n();
  const l = {
    first: labels?.first ?? t("tasks.firstPage"),
    previous: labels?.previous ?? t("tasks.prevPage"),
    next: labels?.next ?? t("tasks.nextPage"),
    last: labels?.last ?? t("tasks.lastPage"),
    page: labels?.page ?? t("common.pages"),
    of: labels?.of ?? "/",
    items: labels?.items ?? t("tasks.statItems"),
  };

  const clampedPage = Math.min(currentPage, Math.max(1, totalPages));
  const canGoBack = clampedPage > 1;
  const canGoForward = clampedPage < totalPages;

  const pages = generatePages(clampedPage, totalPages, maxVisible);

  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 13,
      }}
    >
      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(1)}
        disabled={!canGoBack}
        title={l.first}
        style={{ padding: "4px 8px" }}
      >
        <ChevronsLeft size={14} />
      </button>

      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(clampedPage - 1)}
        disabled={!canGoBack}
        title={l.previous}
        style={{ padding: "4px 8px" }}
      >
        <ChevronLeft size={14} />
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {pages.map((page, idx) =>
          typeof page === "string" ? (
            <span
              key={`ellipsis-${idx}`}
              style={{
                color: "var(--text-muted)",
                padding: "4px 6px",
                fontSize: 13,
                userSelect: "none",
              }}
            >
              {page}
            </span>
          ) : (
            <button
              key={page}
              className={`btn btn-sm ${page === clampedPage ? "btn-primary" : "btn-outline"}`}
              onClick={() => onPageChange(page)}
              style={{ minWidth: 32, padding: "4px 8px" }}
            >
              {page}
            </button>
          )
        )}
      </div>

      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(clampedPage + 1)}
        disabled={!canGoForward}
        title={l.next}
        style={{ padding: "4px 8px" }}
      >
        <ChevronRight size={14} />
      </button>

      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(totalPages)}
        disabled={!canGoForward}
        title={l.last}
        style={{ padding: "4px 8px" }}
      >
        <ChevronsRight size={14} />
      </button>

      {showTotal && (
        <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
          {clampedPage} {l.of} {totalPages}
          {totalItems != null && ` (${totalItems} ${l.items})`}
        </span>
      )}
    </div>
  );
}

function generatePages(
  current: number,
  total: number,
  maxVisible: number
): (number | string)[] {
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | string)[] = [];
  const half = Math.floor(maxVisible / 2);
  let start = Math.max(1, current - half);
  const end = Math.min(total, start + maxVisible - 1);

  if (end - start + 1 < maxVisible) {
    start = Math.max(1, end - maxVisible + 1);
  }

  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push("...");
  }

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (end < total) {
    if (end < total - 1) pages.push("...");
    pages.push(total);
  }

  return pages;
}
