import { useI18n } from "@/lib/i18n";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import { formatFileSize } from "@/lib/utils";
import { toast } from "@/lib/i18n/toast";
import {
  ArrowLeft,
  Trash2,
  RotateCw,
  Copy,
  ImageIcon,
  Video,
  HardDrive,
  Calendar,
  Folder,
  Globe,
} from "lucide-react";
import type { GalleryData } from "@/types";
import type { ZipStatus } from "../gallery-helpers";
import { VirtualImageGrid } from "./virtual-image-grid";
import { GalleryZipInfoPanel } from "./gallery-zip-info";

interface GalleryDetailPanelProps {
  gallery: GalleryData;
  progress?: { galleryId: number; completed: number; total: number; failed: number };
  loading: boolean;
  zipProgress?: { galleryId: number; downloaded: number; total: number; percent: number };
  zipStatus?: ZipStatus;
  onClose: () => void;
  onDelete: (id: number) => void;
  onRetry: (id: number) => void;
  onDownloadZip: (id: number, manualUrl?: string) => Promise<boolean>;
}

export function GalleryDetailPanel({
  gallery,
  progress,
  loading,
  zipProgress,
  zipStatus,
  onClose,
  onDelete,
  onRetry,
  onDownloadZip,
}: GalleryDetailPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const sidebarCollapsed = useSidebarCollapsed();
  const canRetry = gallery.Status === "failed" || gallery.Status === "partial";
  const images = gallery.Images ?? [];
  const videos = gallery.Videos ?? [];

  const zipInfo = gallery.DownloadInfo;
  const currentZipStatus: ZipStatus = zipStatus ?? (zipInfo?.Status === 'completed' ? 'completed' : zipInfo?.Status === 'downloading' ? 'downloading' : zipInfo?.Status === 'failed' ? 'failed' : 'idle') as ZipStatus;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: sidebarCollapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
        right: 0,
        bottom: 0,
        zIndex: 300,
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-card)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={onClose}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <ArrowLeft size={16} />
            {t("common.back")}
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            {t("gallery.galleryDetail", { id: gallery.ID })}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canRetry && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => onRetry(gallery.ID)}
              title={t("gallery.redownload")}
            >
              <RotateCw size={14} />
              {t("gallery.redownload")}
            </button>
          )}
          <button
            className="btn btn-danger btn-sm"
            onClick={() => onDelete(gallery.ID)}
            title={t("common.delete")}
          >
            <Trash2 size={14} />
            {t("common.delete")}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        {loading ? (
          <div className="loading-container" style={{ padding: 20 }}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            <div className="task-detail-grid">
              <div className="task-detail-item full-width">
                <span className="task-detail-label">{t("gallery.sourceUrl")}</span>
                <span className="task-detail-value task-detail-value-with-copy">
                  <span className="task-detail-value-text">{gallery.SourceURL}</span>
                  <button
                    className="btn-copy-inline"
                    onClick={() => {
                      navigator.clipboard.writeText(gallery.SourceURL);
                      toast.success("common.copied");
                    }}
                    title={t("common.copy")}
                  >
                    <Copy size={13} />
                  </button>
                </span>
              </div>

              {gallery.Description && (
                <div className="task-detail-item full-width">
                  <span className="task-detail-label">{t("gallery.description")}</span>
                  <span className="task-detail-value">{gallery.Description}</span>
                </div>
              )}

              {gallery.Tags && gallery.Tags.length > 0 && (
                <div className="task-detail-item full-width">
                  <span className="task-detail-label">{t("gallery.tags")}</span>
                  <span className="task-detail-value">
                    <div className="task-detail-tags">
                      {gallery.Tags.map((tag) => (
                        <span key={tag} className="pill pill-clickable">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </span>
                </div>
              )}

              {gallery.Category && (
                <div className="task-detail-item">
                  <span className="task-detail-label">{t("gallery.category")}</span>
                  <span className="task-detail-value">{gallery.Category}</span>
                </div>
              )}

              {gallery.PublishTime && (
                <div className="task-detail-item">
                  <span className="task-detail-label">{t("gallery.publishTime")}</span>
                  <span className="task-detail-value">{gallery.PublishTime}</span>
                </div>
              )}

              {gallery.SavePath && (
                <div className="task-detail-item full-width">
                  <span className="task-detail-label">{t("gallery.savePath")}</span>
                  <span className="task-detail-value task-detail-value-with-copy">
                    <span className="task-detail-value-text">{gallery.SavePath}</span>
                    <button
                      className="btn-copy-inline"
                      onClick={() => {
                        navigator.clipboard.writeText(gallery.SavePath);
                        toast.success("common.copied");
                      }}
                      title={t("common.copy")}
                    >
                      <Copy size={13} />
                    </button>
                  </span>
                </div>
              )}

              <div className="task-detail-divider" />
              <div className="task-detail-info-bar">
                <div className="info-bar-item">
                  <ImageIcon size={14} className="info-bar-icon" />
                  <span className="info-bar-text">{t("gallery.images", { count: gallery.ImageCount })}</span>
                </div>
                {gallery.VideoCount > 0 && (
                  <div className="info-bar-item">
                    <Video size={14} className="info-bar-icon" />
                    <span className="info-bar-text">{t("gallery.videos", { count: gallery.VideoCount })}</span>
                  </div>
                )}
                {gallery.PageCount > 1 && (
                  <div className="info-bar-item">
                    <Folder size={14} className="info-bar-icon" />
                    <span className="info-bar-text">{t("gallery.pageCount", { count: gallery.PageCount })}</span>
                  </div>
                )}
                {gallery.TotalSize > 0 && (
                  <div className="info-bar-item">
                    <HardDrive size={14} className="info-bar-icon" />
                    <span className="info-bar-text">
                      {formatFileSize(gallery.TotalSize)}
                    </span>
                  </div>
                )}
                {gallery.TotalSize <= 0 && gallery.DownloadedSize > 0 && (
                  <div className="info-bar-item">
                    <HardDrive size={14} className="info-bar-icon" />
                    <span className="info-bar-text">
                      {formatFileSize(gallery.DownloadedSize)}
                    </span>
                  </div>
                )}
                {progress && (
                  <div className="info-bar-item">
                    <HardDrive size={14} className="info-bar-icon" />
                    <span className="info-bar-text">
                      {progress.completed}/{progress.total}
                      {progress.failed > 0 && ` (${t("gallery.galleryFailed", { count: progress.failed })})`}
                    </span>
                  </div>
                )}
                {gallery.ScrapedDomain && (
                  <div className="info-bar-item">
                    <Globe size={14} className="info-bar-icon" />
                    <span className="info-bar-text">
                      {(() => {
                        try { return new URL(gallery.ScrapedDomain).hostname; } catch { return gallery.ScrapedDomain; }
                      })()}
                    </span>
                  </div>
                )}
                <div className="info-bar-item">
                  <Calendar size={14} className="info-bar-icon" />
                  <span className="info-bar-text">
                    {new Date(gallery.CreatedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {zipInfo && (
                <GalleryZipInfoPanel
                  zipInfo={zipInfo}
                  zipStatus={currentZipStatus}
                  zipProgress={zipProgress}
                  galleryId={gallery.ID}
                  onDownloadZip={onDownloadZip}
                />
              )}
            </div>

            {images.length > 0 && (
              <VirtualImageGrid images={images} />
            )}

            {videos.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: 8,
                  }}
                >
                  {t("gallery.videoList", { count: videos.length })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {videos.map((vid, i) => (
                    <div
                      key={vid.ID}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: "var(--bg-inset)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <Video size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: "var(--font-mono), ui-monospace, monospace",
                          color: "var(--text-secondary)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {vid.FileName || `video_${i + 1}`}
                      </span>
                      {(vid.FileSize || vid.Duration || vid.Resolution) && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            flexShrink: 0,
                            display: "flex",
                            gap: 6,
                          }}
                        >
                          {vid.FileSize ? formatFileSize(vid.FileSize) : null}
                          {vid.Duration ? `${vid.Duration.toFixed(1)} min` : null}
                          {vid.Resolution ? vid.Resolution : null}
                        </span>
                      )}
                      <span
                        className={`badge ${
                          vid.Status === "completed"
                            ? "badge-success"
                            : vid.Status === "failed"
                            ? "badge-danger"
                            : vid.Status === "downloading"
                            ? "badge-info"
                            : "badge-default"
                        }`}
                        style={{ fontSize: 11 }}
                      >
                        {vid.Status === "completed"
                          ? t("common.completed")
                          : vid.Status === "failed"
                          ? t("common.failed")
                          : vid.Status === "downloading"
                          ? t("common.downloading")
                          : t("common.pending")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
