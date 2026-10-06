import type { CSSProperties } from "react";
import type { TaskStatus } from "@/types";

/*
 * Task-page task state machine → semantic fill class (--status-* tokens,
 * same source as the status pill). Post-download phases (merging /
 * transcoding / probing) stay unmapped: the shimmer flag carries their
 * look. Styles live in styles/components/progress-bar.scss.
 */
const FILL_CLASS_BY_STATUS: Partial<Record<TaskStatus, string>> = {
  pending: "fill-pending",
  scraped: "fill-downloading",
  downloading: "fill-downloading",
  partial: "fill-partial",
  completed: "fill-completed",
  failed: "fill-failed",
  cancelled: "fill-cancelled",
  preparing: "fill-preparing",
  paused: "fill-paused",
  scraping: "fill-scraping",
  scrape_pending: "fill-scrape-pending",
  download_pending: "fill-download-pending",
};

export interface ProgressBarProps {
  /** Current progress 0-100 (ignored when indeterminate); clamped to range */
  progress?: number;
  /** Task state machine status → fill-* semantic fill; omit for accent */
  status?: TaskStatus;
  /** Semantic tone for non-task callers (shelf cards), legacy modifiers */
  tone?: "completed" | "failed";
  /** Indeterminate mode: 30%-wide status-colored slider (identifying/queued/paused) */
  indeterminate?: boolean;
  /** Post-processing shimmer: --transcode-shimmer purple flow (merging/transcoding/probing) */
  shimmer?: boolean;
  /** Fill width floor in percent so an empty bar stays visible */
  minProgress?: number;
  height?: number;
  minWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export default function ProgressBar({
  progress = 0,
  status,
  tone,
  indeterminate = false,
  shimmer = false,
  minProgress = 0,
  height,
  minWidth,
  className,
  style,
}: ProgressBarProps): React.JSX.Element {
  const fillClass = [
    "progress-bar-fill",
    status ? FILL_CLASS_BY_STATUS[status] : tone ?? "",
    shimmer ? "transcoding" : "",
    indeterminate ? "progress-bar-indeterminate" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className ? `progress-bar ${className}` : "progress-bar"}
      style={{
        ...(height !== undefined && { height }),
        ...(minWidth !== undefined && { minWidth }),
        ...style,
      }}
    >
      <div
        className={fillClass}
        style={
          indeterminate
            ? undefined
            : { width: `${Math.min(Math.max(progress, minProgress), 100)}%` }
        }
      />
    </div>
  );
}
