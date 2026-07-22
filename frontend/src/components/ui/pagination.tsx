"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

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

/**
 * A reusable pagination component with first/prev/numbers/next/last controls.
 * Replaces the inline pagination in pages like tasks/page.tsx.
 */
export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  maxVisible = 5,
  onPageChange,
  className = "",
  showTotal = true,
  labels,
}: PaginationProps) {
  const l = {
    first: labels?.first ?? "首页",
    previous: labels?.previous ?? "上一页",
    next: labels?.next ?? "下一页",
    last: labels?.last ?? "末页",
    page: labels?.page ?? "页",
    of: labels?.of ?? "/",
    items: labels?.items ?? "条",
  };

  const safePage = Math.min(currentPage, Math.max(1, totalPages));
  const canGoBack = safePage > 1;
  const canGoForward = safePage < totalPages;

  // Generate page numbers with ellipsis
  const pages = generatePages(safePage, totalPages, maxVisible);

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
      {/* First page */}
      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(1)}
        disabled={!canGoBack}
        title={l.first}
        style={{ padding: "4px 8px" }}
      >
        <ChevronsLeft size={14} />
      </button>

      {/* Previous page */}
      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(safePage - 1)}
        disabled={!canGoBack}
        title={l.previous}
        style={{ padding: "4px 8px" }}
      >
        <ChevronLeft size={14} />
      </button>

      {/* Page numbers */}
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
              className={`btn btn-sm ${page === safePage ? "btn-primary" : "btn-outline"}`}
              onClick={() => onPageChange(page)}
              style={{ minWidth: 32, padding: "4px 8px" }}
            >
              {page}
            </button>
          )
        )}
      </div>

      {/* Next page */}
      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(safePage + 1)}
        disabled={!canGoForward}
        title={l.next}
        style={{ padding: "4px 8px" }}
      >
        <ChevronRight size={14} />
      </button>

      {/* Last page */}
      <button
        className="btn btn-outline btn-sm"
        onClick={() => onPageChange(totalPages)}
        disabled={!canGoForward}
        title={l.last}
        style={{ padding: "4px 8px" }}
      >
        <ChevronsRight size={14} />
      </button>

      {/* Page info */}
      {showTotal && (
        <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
          {safePage} {l.of} {totalPages}
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
