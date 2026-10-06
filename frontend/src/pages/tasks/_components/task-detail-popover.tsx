import { Copy, Clock, Monitor, HardDrive, Calendar, X } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import type { DownloadTask, TaskStatus } from "@/types";
import { useI18n } from "@/lib/i18n";
import { formatFileSize } from "@/lib/utils";
import { resolveTaskActors, resolveTaskTags } from "../_lib/task-helpers";

interface TaskDetailPopoverProps {
  tasks: DownloadTask[];
  expandedTask: string | null;
  setExpandedTask: (id: string | null) => void;
  STATUS_LABEL: Record<TaskStatus, string>;
}

export function TaskDetailPopover({
  tasks,
  expandedTask,
  setExpandedTask,
  STATUS_LABEL,
}: TaskDetailPopoverProps): React.JSX.Element | null {
  const { t, locale } = useI18n();

  if (expandedTask === null) return null;

  const task = tasks.find((t) => `${t.TaskType || "video"}-${t.ID}` === expandedTask);
  if (!task) return null;

  const isGalleryTask = task.TaskType === "gallery";
  const isSniffTask = task.TaskType === "sniff";

  return (
    <div className="task-detail-overlay" onClick={() => setExpandedTask(null)}>
      <div className="task-detail-popover" onClick={(e) => e.stopPropagation()}>
        <div className="task-detail-popover-header">
          <span className="task-detail-popover-title">
            {isSniffTask ? t("tasks.detailTaskTypeSniff") : isGalleryTask ? t("tasks.detailTaskTypeGallery") : t("tasks.detailTaskTypeVideo")}{t("tasks.detailTaskSuffix")} #{task.DisplayID ?? task.ID}
          </span>
          <button
            className="btn-close"
            onClick={() => setExpandedTask(null)}
          >
            <X size={16} />
          </button>
        </div>
        <div className="task-detail-popover-body">
          <div className="task-detail-grid">
            <div className="task-detail-item full-width">
              <span className="task-detail-label">{isGalleryTask ? t("tasks.detailSourcePage") : t("tasks.detailVideoLink")}</span>
              <span className="task-detail-value task-detail-value-with-copy">
                <span className="task-detail-value-text">{task.URL}</span>
                <button
                  className="btn-copy-inline"
                  onClick={() => {
                    navigator.clipboard.writeText(task.URL);
                    toast.success("common.copied");
                  }}
                  title={t("common.copy")}
                >
                  <Copy size={13} />
                </button>
              </span>
            </div>
            {isSniffTask && (
              <>
                <div className="task-detail-row full-width">
                  <div className="task-detail-item task-detail-item-flex">
                    <span className="task-detail-label">{t("tasks.colStatus")}</span>
                    <span className="task-detail-value">{STATUS_LABEL[task.Status] ?? task.Status}</span>
                  </div>
                  <div className="task-detail-item task-detail-item-flex">
                    <span className="task-detail-label">{t("tasks.detailFoundGalleries")}</span>
                    <span className="task-detail-value">{t("tasks.countUnit", { count: task.SniffTotalFound ?? 0 })}</span>
                  </div>
                </div>
                <div className="task-detail-row full-width">
                  <div className="task-detail-item task-detail-item-flex">
                    <span className="task-detail-label">{t("tasks.detailCreatedTasks")}</span>
                    <span className="task-detail-value">{t("tasks.countUnit", { count: task.SniffTotalCreated ?? 0 })}</span>
                  </div>
                  <div className="task-detail-item task-detail-item-flex">
                    <span className="task-detail-label">{t("tasks.detailSkipped")}</span>
                    <span className="task-detail-value">{t("tasks.countUnit", { count: task.SniffTotalSkipped ?? 0 })}</span>
                  </div>
                </div>
                {task.Status === "failed" && task.ErrorMsg && (
                  <div className="task-detail-item full-width">
                    <div className="failure-reason-card">
                      <div className="failure-reason-header">
                        <span className="failure-reason-icon">⚠</span>
                        <span className="failure-reason-title">{t("tasks.detailFailureReason")}</span>
                      </div>
                      <div className="failure-reason-content">
                        <strong>{task.ErrorMsg}</strong>
                      </div>
                    </div>
                  </div>
                )}
                {task.ErrorMsg && task.Status !== "failed" && (
                  <div className="task-detail-item full-width">
                    <span className="task-detail-label">{t("tasks.errorMsg")}</span>
                    <span className="task-detail-value" style={{ color: "var(--danger)" }}>{task.ErrorMsg}</span>
                  </div>
                )}
                {task.CreatedAt && (
                  <div className="task-detail-item full-width">
                    <span className="task-detail-label">{t("tasks.createdAt")}</span>
                    <span className="task-detail-value">{new Date(task.CreatedAt).toLocaleString(locale)}</span>
                  </div>
                )}
              </>
            )}
            {task.M3U8URL && (
              <div className="task-detail-item full-width">
                <span className="task-detail-label">{t("tasks.m3u8Url")}</span>
                <span className="task-detail-value task-detail-value-with-copy">
                  <span className="task-detail-value-text">{task.M3U8URL}</span>
                  <button
                    className="btn-copy-inline"
                    onClick={() => {
                      navigator.clipboard.writeText(task.M3U8URL);
                      toast.success("common.copied");
                    }}
                    title={t("common.copy")}
                  >
                    <Copy size={13} />
                  </button>
                </span>
              </div>
            )}
            {task.FilePath && (
              <div className="task-detail-item full-width">
                <span className="task-detail-label">{isGalleryTask ? t("tasks.savePath") : t("tasks.filePath")}</span>
                <span className="task-detail-value task-detail-value-with-copy">
                  <span className="task-detail-value-text">{task.FilePath}</span>
                  <button
                    className="btn-copy-inline"
                    onClick={() => {
                      navigator.clipboard.writeText(task.FilePath!);
                      toast.success("common.copied");
                    }}
                    title={t("common.copy")}
                  >
                    <Copy size={13} />
                  </button>
                </span>
              </div>
            )}
            {isGalleryTask && task.GalleryTitle && (
              <div className="task-detail-item full-width">
                <span className="task-detail-label">{t("tasks.detailGalleryTitle")}</span>
                <span className="task-detail-value task-detail-value-with-copy">
                  <span className="task-detail-value-text">{task.GalleryTitle}</span>
                  <button
                    className="btn-copy-inline"
                    onClick={() => {
                      navigator.clipboard.writeText(task.GalleryTitle!);
                      toast.success("common.copied");
                    }}
                    title={t("common.copy")}
                  >
                    <Copy size={13} />
                  </button>
                </span>
              </div>
              )}
            {task.VideoInfo?.Title && (
              <div className="task-detail-item full-width">
                <span className="task-detail-label">{t("tasks.detailVideoTitle")}</span>
                <span className="task-detail-value task-detail-value-with-copy">
                  <span className="task-detail-value-text">{task.VideoInfo.Title}</span>
                  <button
                    className="btn-copy-inline"
                    onClick={() => {
                      navigator.clipboard.writeText(task.VideoInfo!.Title!);
                      toast.success("common.copied");
                    }}
                    title={t("common.copy")}
                  >
                    <Copy size={13} />
                  </button>
                </span>
              </div>
            )}
            {!isSniffTask && (
              <div className="task-detail-row full-width">
                <div className="task-detail-item task-detail-item-flex">
                  <span className="task-detail-label">{t("tasks.detailTags")}</span>
                  <span className="task-detail-value">
                    {(() => {
                      const tags = resolveTaskTags(task);
                      if (tags.length === 0) return "—";
                      return (
                        <div className="task-detail-tags">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="pill pill-clickable"
                              onClick={() => {
                                navigator.clipboard.writeText(tag);
                                toast.success("common.copied");
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </span>
                </div>
                <div className="task-detail-item task-detail-item-flex">
                  <span className="task-detail-label">{t("tasks.detailActors")}</span>
                  <span className="task-detail-value">
                    {(() => {
                      const actors = resolveTaskActors(task);
                      if (actors.length === 0) return "—";
                      return (
                        <div className="task-detail-tags">
                          {actors.map((actor) => (
                            <span
                              key={actor}
                              className="pill pill-clickable"
                              onClick={() => {
                                navigator.clipboard.writeText(actor);
                                toast.success("common.copied");
                              }}
                            >
                              {actor}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </span>
                </div>
              </div>
            )}
            {!isGalleryTask && (
              <div className="task-detail-row full-width">
                <div className="task-detail-item task-detail-item-flex">
                  <span className="task-detail-label">{t("tasks.detailImageCount")}</span>
                  <span className="task-detail-value">{t("tasks.imageUnit", { count: task.ImageCount ?? 0 })}</span>
                </div>
                <div className="task-detail-item task-detail-item-flex">
                  <span className="task-detail-label">{t("tasks.detailVideoCount")}</span>
                  <span className="task-detail-value">{t("tasks.countUnit", { count: task.VideoCount ?? 0 })}</span>
                </div>
                <div className="task-detail-item task-detail-item-flex">
                  <span className="task-detail-label">{t("tasks.detailDownloadMethod")}</span>
                  <span className="task-detail-value">
                    {task.DownloadMethod === "zip" ? t("tasks.downloadMethodZip") :
                      task.DownloadMethod === "scrape" ? t("tasks.downloadMethodScrape") :
                        task.DownloadMethod === "both" ? t("tasks.downloadMethodBoth") : (task.DownloadMethod ?? "—")}
                  </span>
                </div>
              </div>
              )}
            {task.Status === "failed" && task.ErrorMsg && !isSniffTask && (
              <div className="task-detail-item full-width">
                <div className="failure-reason-card">
                  <div className="failure-reason-header">
                    <span className="failure-reason-icon">⚠</span>
                    <span className="failure-reason-title">{t("tasks.detailFailureReason")}</span>
                  </div>
                  <div className="failure-reason-content">
                    <strong>{task.ErrorMsg}</strong>
                  </div>
                </div>
              </div>
            )}
            {task.ErrorMsg && task.Status !== "failed" && !isSniffTask && (
              <div className="task-detail-item full-width">
                <span className="task-detail-label">{t("tasks.errorMsg")}</span>
                <span
                  className="task-detail-value"
                  style={{ color: "var(--danger)" }}
                >
                  {task.ErrorMsg}
                </span>
              </div>
            )}
            {task.CreatedAt && !isSniffTask && (
              <div className="task-detail-item full-width">
                <span className="task-detail-label">{t("tasks.createdAt")}</span>
                <span className="task-detail-value">{new Date(task.CreatedAt).toLocaleString(locale)}</span>
              </div>
            )}
            {(task.VideoInfo?.Duration || task.VideoInfo?.Resolution || task.VideoInfo?.FileSize || task.CreatedAt || isGalleryTask) && (
              <>
                <div className="task-detail-divider" />
                <div className="task-detail-info-bar">
                  {task.VideoInfo?.Duration ? (
                    <div className="info-bar-item">
                      <Clock size={14} className="info-bar-icon" />
                      <span className="info-bar-text">{t("tasks.durationMinutes", { count: task.VideoInfo.Duration })}</span>
                    </div>
                  ) : null}
                  {task.VideoInfo?.Resolution && (
                    <div className="info-bar-item">
                      <Monitor size={14} className="info-bar-icon" />
                      <span className="info-bar-text">{task.VideoInfo.Resolution}</span>
                    </div>
                  )}
                  {task.VideoInfo?.FileSize ? (
                    <div className="info-bar-item">
                      <HardDrive size={14} className="info-bar-icon" />
                      <span className="info-bar-text">{(task.VideoInfo.FileSize / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                  ) : null}
                  {isGalleryTask && (
                    <div className="info-bar-item">
                      <HardDrive size={14} className="info-bar-icon" />
                      <span className="info-bar-text">
                        {task.GalleryTotalSize && task.GalleryTotalSize > 0
                          ? formatFileSize(task.GalleryTotalSize)
                          : task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
                            ? formatFileSize(task.DownloadInfo.ActualSize)
                            : task.DownloadInfo?.FileSizeText
                              ? task.DownloadInfo.FileSizeText
                              : "—"}
                      </span>
                    </div>
                  )}
                  {task.CreatedAt && (
                    <div className="info-bar-item">
                      <Calendar size={14} className="info-bar-icon" />
                      <span className="info-bar-text">{new Date(task.CreatedAt).toLocaleString(locale)}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
