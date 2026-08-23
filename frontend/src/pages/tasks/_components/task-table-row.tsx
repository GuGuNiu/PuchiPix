import { Fragment } from "react";
import {
  Play,
  Pause,
  Square,
  Trash2,
  RotateCw,
  CheckSquare,
  Square as SquareIcon,
  Copy,
  Radar,
  ImageIcon,
  Film,
} from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import type { DownloadTask, TaskStatus } from "@/types";
import { useI18n } from "@/lib/i18n";
import {
  formatFileSize,
  getProgressStage,
} from "../_lib/task-helpers";

interface TaskTableRowProps {
  task: DownloadTask;
  isSelected: boolean;
  onToggleSelect: (key: string) => void;
  onToggleExpand: (task: DownloadTask) => void;
  onAction: (task: DownloadTask, action: string) => void;
  onDelete: (task: DownloadTask) => void;
  STATUS_LABEL: Record<TaskStatus, string>;
  animClass?: string;
}

export function TaskTableRow({
  task,
  isSelected,
  onToggleSelect,
  onToggleExpand,
  onAction,
  onDelete,
  STATUS_LABEL,
  animClass,
}: TaskTableRowProps): React.JSX.Element {
  const { t, locale } = useI18n();

  const isGallery = task.TaskType === "gallery";
  const isSniff = task.TaskType === "sniff";
  const isPreparing = task.Status === "preparing";
  const isIdentifying = task.Status === "scraping" || task.Status === "scrape_pending";
  const isWaitingSlot = task.Status === "scrape_pending" || task.Status === "download_pending" || isPreparing;
  const canStart = !isGallery && !isSniff
    ? (task.Status === "pending" || task.Status === "paused" || task.Status === "failed" || task.Status === "cancelled")
    : (task.Status === "pending" || task.Status === "scrape_pending" || task.Status === "download_pending" || task.Status === "paused" || task.Status === "failed" || task.Status === "scraping");
  const canPause = !isGallery && !isSniff && (task.Status === "downloading" || isPreparing);
  const canPauseGallery = isGallery && (task.Status === "scraping" || task.Status === "downloading" || task.Status === "scrape_pending" || task.Status === "download_pending" || task.Status === "pending" || isPreparing);
  const canCancel = !isGallery && !isSniff &&
    (task.Status === "downloading" ||
      task.Status === "paused" ||
      task.Status === "pending" ||
      task.Status === "scraping");
  const canRetry = !isSniff && task.Status === "failed";
  const canRetryPartial = isGallery && task.Status === "partial";
  const canDelete = true;
  const idStr = String(task.DisplayID ?? task.ID);
  const idDisplay = idStr.length > 8 ? idStr.slice(0, 8) + "..." : idStr;

  const rawTitle = isSniff
    ? task.URL
    : isGallery
      ? (task.GalleryTitle || "")
      : (task.GalleryTitle || task.VideoInfo?.Title || "");
  const titleDisplay = isIdentifying && !rawTitle
    ? t("tasks.identifying")
    : (rawTitle || task.URL);
  const progress = typeof task.Progress === "number" ? task.Progress : 0;
  const progressPct = progress.toFixed(1) + "%";
  const stage = getProgressStage(task, t);
  const fillClass =
    task.Status === "completed"
      ? "completed"
      : task.Status === "failed" || task.Status === "cancelled"
        ? "failed"
        : isPreparing
          ? "preparing"
          : (isIdentifying || isWaitingSlot)
            ? ""
            : "";

  const taskKey = `${task.TaskType || "video"}-${task.ID}`;

  return (
    <Fragment key={taskKey}>
      <tr
        className={animClass || undefined}
        onClick={() => onToggleExpand(task)}
        style={{
          cursor: "pointer",
          background: isSelected
            ? "var(--accent-soft)"
            : isSniff
              ? "rgba(99, 102, 241, 0.04)"
              : undefined,
        }}
      >
        <td
          onClick={(e) => e.stopPropagation()}
          style={{
            fontFamily: "monospace",
            color: isSniff ? "#6366f1" : "var(--text-secondary)",
            fontWeight: isSniff ? 700 : undefined,
            whiteSpace: "nowrap",
            verticalAlign: "middle",
          }}
        >
          <span
            onClick={(e) => { e.stopPropagation(); onToggleSelect(taskKey); }}
            style={{
              cursor: "pointer",
              color: isSelected ? "var(--accent)" : "var(--text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 16,
            }}
          >
            {isSelected ? (
              <CheckSquare size={16} style={{ display: "block", flexShrink: 0, marginTop: -1 }} />
            ) : (
              <SquareIcon size={16} style={{ display: "block", flexShrink: 0, marginTop: -1 }} />
            )}
            <span style={{ display: "block", lineHeight: "16px", height: 16, fontSize: 12, fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace" }}>
              {idDisplay}
            </span>
          </span>
        </td>
        <td>
          {isSniff ? (
            <span title={t("tasks.sniffTaskLabel")} style={{ color: "var(--accent-light)" }}>
              <Radar size={15} />
            </span>
          ) : isGallery ? (
            <span title={t("tasks.galleryTaskLabel")} style={{ color: "var(--text-muted)" }}>
              <ImageIcon size={15} />
            </span>
          ) : (
            <span title={t("tasks.videoTaskLabel")} style={{ color: "var(--text-muted)" }}>
              <Film size={15} />
            </span>
          )}
        </td>
        <td
          style={{
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
          title={task.Person && task.Person !== "null" ? task.Person : ""}
        >
          {task.Person && task.Person !== "null" ? task.Person : "—"}
        </td>
        <td
          style={{
            maxWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={titleDisplay}
        >
          {isIdentifying && !rawTitle ? (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
              {titleDisplay}
            </span>
          ) : (
            titleDisplay
          )}
        </td>
        <td>
          {task.Status === "failed" && task.ErrorMsg ? (
            <span
              className={`status-pill status-pill-${task.Status}`}
              data-tooltip={task.ErrorMsg}
              style={{ cursor: "help" }}
            >
              {STATUS_LABEL[task.Status] ?? task.Status}
            </span>
          ) : (
            <span className={`status-pill status-pill-${task.Status}`}>
              {STATUS_LABEL[task.Status] ?? task.Status}
            </span>
          )}
        </td>
        <td>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              minWidth: 70,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                lineHeight: "16px",
                fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
              }}
            >
              {(isIdentifying || isWaitingSlot) ? stage : progressPct}
            </span>
            <div className="progress-bar" style={{ width: "100%" }}>
              <div
                className={`progress-bar-fill ${fillClass} ${(isIdentifying || isWaitingSlot) ? "progress-bar-indeterminate" : ""}`}
                style={(isIdentifying || isWaitingSlot) ? {} : { width: `${progress}%` }}
              />
            </div>
          </div>
        </td>
        <td style={{ whiteSpace: "nowrap" }}>
          {isSniff ? (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>
              {task.Status === "completed" ? t("tasks.sniffFound", { count: task.SniffTotalFound ?? 0 }) : task.Status === "scraping" ? t("tasks.sniffDiscovered", { count: task.SniffTotalFound ?? 0 }) : "—"}
            </span>
          ) : isIdentifying ? (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>{t("tasks.identifying")}</span>
          ) : isWaitingSlot ? (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 12 }}>{stage}</span>
          ) : isGallery ? (
            <span className="dual-capsule" title={t("tasks.gallerySegmentTitle", { images: task.ImageCount ?? 0, videos: task.VideoCount ?? 0 })}>
              <span className="dual-capsule-left accent-green">{task.ImageCount || 0}P</span>
              <span className="dual-capsule-right accent-orange">{task.VideoCount || 0}V</span>
            </span>
          ) : task.TotalSegments ? (
            <span className="dual-capsule" title={t("tasks.segmentTitle", { current: task.Segment ?? 0, total: task.TotalSegments })}>
              <span className="dual-capsule-left">{task.Segment ?? 0}</span>
              <span className="dual-capsule-right">{task.TotalSegments}</span>
            </span>
          ) : (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
          )}
        </td>
        <td style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
          {isSniff ? (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
          ) : isGallery ? (
            task.GalleryTotalSize && task.GalleryTotalSize > 0
              ? formatFileSize(task.GalleryTotalSize)
              : task.DownloadedSize && task.DownloadedSize > 0
                ? formatFileSize(task.DownloadedSize)
                : task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
                  ? formatFileSize(task.DownloadInfo.ActualSize)
                  : task.DownloadInfo?.FileSizeText
                    ? task.DownloadInfo.FileSizeText
                    : "—"
          ) : task.FileSize && task.FileSize > 0 ? (
            `${(task.FileSize / 1024 / 1024).toFixed(1)} MB`
          ) : task.DownloadedBytes && task.DownloadedBytes > 0 ? (
            `${(task.DownloadedBytes / 1024 / 1024).toFixed(1)} MB`
          ) : (
            "—"
          )}
        </td>
        <td>
          <div className="action-buttons">
            {canStart && (
              <button
                className="btn btn-primary btn-sm"
                onClick={(e) => { e.stopPropagation(); onAction(task, "start"); }}
                title={t("tasks.actionStart")}
              >
                <Play size={14} />
              </button>
            )}
            {(canPause || canPauseGallery) && (
              <button
                className="btn btn-warning btn-sm"
                onClick={(e) => { e.stopPropagation(); onAction(task, "pause"); }}
                title={t("tasks.actionPause")}
              >
                <Pause size={14} />
              </button>
            )}
            {canCancel && (
              <button
                className="btn btn-danger btn-sm"
                onClick={(e) => { e.stopPropagation(); onAction(task, "cancel"); }}
                title={t("tasks.actionCancel")}
              >
                <Square size={14} />
              </button>
            )}
            {canDelete && (
              <button
                className="btn btn-outline btn-sm"
                onClick={(e) => { e.stopPropagation(); onDelete(task); }}
                title={t("tasks.actionDelete")}
              >
                <Trash2 size={14} />
              </button>
            )}
            {canRetry && (
              <button
                className="btn btn-outline btn-sm"
                onClick={(e) => { e.stopPropagation(); onAction(task, "retry"); }}
                title={t("tasks.actionRetry")}
              >
                <RotateCw size={14} />
              </button>
            )}
            {canRetryPartial && (
              <button
                className="btn btn-outline btn-sm"
                style={{ borderColor: "var(--warning)", color: "var(--warning)" }}
                onClick={(e) => { e.stopPropagation(); onAction(task, "retry"); }}
                title={t("tasks.retryFailedFiles")}
              >
                <RotateCw size={14} />
              </button>
            )}
            <button
              className="btn btn-outline btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                const isGallery = task.TaskType === "gallery";
                const isSniff = task.TaskType === "sniff";
                const summary = {
                  ID: task.ID,
                  DisplayID: task.DisplayID,
                  Type: isSniff ? t("tasks.typeSniff") : isGallery ? t("tasks.typeGallery") : t("tasks.typeVideo"),
                  Title: isGallery ? (task.GalleryTitle || "—") : (task.VideoInfo?.Title || "—"),
                  URL: task.URL,
                  M3U8URL: task.M3U8URL || undefined,
                  Status: STATUS_LABEL[task.Status] ?? task.Status,
                  Progress: `${task.Progress.toFixed(1)}%`,
                  FilePath: task.FilePath || undefined,
                  CreatedAt: task.CreatedAt ? new Date(task.CreatedAt).toLocaleString(locale) : undefined,
                  UpdatedAt: task.UpdatedAt ? new Date(task.UpdatedAt).toLocaleString(locale) : undefined,
                  ...(isSniff ? {
                    SniffTotalFound: task.SniffTotalFound ?? 0,
                    SniffTotalCreated: task.SniffTotalCreated ?? 0,
                    SniffTotalSkipped: task.SniffTotalSkipped ?? 0,
                  } : isGallery ? {
                    ImageCount: task.ImageCount ?? 0,
                    VideoCount: task.VideoCount ?? 0,
                    DownloadMethod: task.DownloadMethod,
                    DownloadInfo: task.DownloadInfo ? {
                      FileSizeText: task.DownloadInfo.FileSizeText,
                      ActualSize: task.DownloadInfo.ActualSize > 0 ? formatFileSize(task.DownloadInfo.ActualSize) : undefined,
                      Provider: task.DownloadInfo.Provider,
                      Status: task.DownloadInfo.Status,
                      DownloadURL: task.DownloadInfo.DownloadURL,
                      ZipFileName: task.DownloadInfo.ZipFileName || undefined,
                      Parallelism: task.DownloadInfo.Parallelism || undefined,
                      AvgSpeed: task.DownloadInfo.AvgSpeed || undefined,
                      VerifiedCount: task.DownloadInfo.VerifiedCount || undefined,
                      CountMatched: task.DownloadInfo.CountMatched,
                    } : undefined,
                  } : {
                    Segment: task.Segment ?? undefined,
                    TotalSegments: task.TotalSegments ?? undefined,
                    FileSize: task.VideoInfo?.FileSize ? formatFileSize(task.VideoInfo.FileSize) : undefined,
                    Duration: task.VideoInfo?.Duration ? t("tasks.durationMinutes", { count: task.VideoInfo.Duration }) : undefined,
                    Resolution: task.VideoInfo?.Resolution || undefined,
                    Tags: task.VideoInfo?.Tags?.length ? task.VideoInfo.Tags : undefined,
                    Actors: task.VideoInfo?.Actors?.length ? task.VideoInfo.Actors : undefined,
                  }),
                  ErrorMsg: task.ErrorMsg || undefined,
                };
                navigator.clipboard.writeText(JSON.stringify(summary, null, 2)).then(
                  () => toast.success("tasks.taskDataCopied", { id: task.DisplayID ?? task.ID }),
                  () => toast.error("tasks.copyFailed"),
                );
              }}
              title={t("tasks.copyTaskData")}
            >
              <Copy size={14} />
            </button>
          </div>
        </td>
      </tr>
    </Fragment>
  );
}
