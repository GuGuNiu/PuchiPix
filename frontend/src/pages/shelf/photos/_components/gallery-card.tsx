import { memo } from "react";
import {
  ImageIcon,
  Video,
  HardDrive,
  Calendar,
} from "lucide-react";
import { useGalleryStore } from "@/store/gallery-store";
import { useI18n } from "@/lib/i18n";
import { formatFileSize } from "@/lib/utils";
import {
  GALLERY_STATUS_LABEL,
  GALLERY_STATUS_CLASS,
} from "../gallery-helpers";
import type { GalleryData } from "@/types";

export interface GalleryCardProps {
  gallery: GalleryData;
  isExpanded: boolean;
  onExpand: (id: number) => void;
}

function GalleryCardComponent({
  gallery,
  isExpanded,
  onExpand,
}: GalleryCardProps): React.JSX.Element {
  const { t } = useI18n();
  const progress = useGalleryStore((s) => s.progressMap[gallery.ID]);

  const progressPct =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : gallery.Status === "completed"
      ? 100
      : 0;
  const fillClass =
    gallery.Status === "completed"
      ? "completed"
      : gallery.Status === "failed"
      ? "failed"
      : "";

  return (
    <div
      onClick={() => onExpand(gallery.ID)}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--bg-card)",
        border: `1px solid ${isExpanded ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 220,
          flexShrink: 0,
          background: "var(--bg-inset)",
          overflow: "hidden",
        }}
      >
        {gallery.CoverURL || gallery.CoverLocalPath || gallery.ImageCount > 0 ? (
          <img
            src={`/api/shelf/${gallery.ID}?type=cover&width=400`}
            alt={gallery.Title}
            loading="lazy"
            decoding="async"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              if (!img.dataset.fallback) {
                img.dataset.fallback = '1';
                if (gallery.CoverURL) {
                  img.src = gallery.CoverURL;
                } else {
                  img.style.display = "none";
                  const parent = img.parentElement;
                  if (parent) {
                    parent.style.display = "flex";
                    parent.style.alignItems = "center";
                    parent.style.justifyContent = "center";
                    parent.style.color = "var(--text-muted)";
                  }
                }
              } else {
                img.style.display = "none";
              }
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-muted)",
            }}
          >
            <ImageIcon size={40} strokeWidth={1.5} />
          </div>
        )}
        <span
          className={`badge ${GALLERY_STATUS_CLASS[gallery.Status] || "badge-default"}`}
          style={{ position: "absolute", top: 8, right: 8, fontSize: 11 }}
        >
          {GALLERY_STATUS_LABEL[gallery.Status] ? t(GALLERY_STATUS_LABEL[gallery.Status]) : gallery.Status}
        </span>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          padding: "8px 12px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 2,
            flexShrink: 0,
          }}
          title={gallery.Title}
        >
          {gallery.Title || t("gallery.galleryTitle", { id: gallery.ID })}
        </div>
        {gallery.Protagonist && (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              marginBottom: 8,
              flexShrink: 0,
            }}
          >
            {t("gallery.model")}{gallery.Protagonist}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 4,
            flexWrap: "wrap",
            overflow: "hidden",
          }}
        >
          <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
            <ImageIcon size={11} style={{ marginRight: 3 }} />
            {gallery.ImageCount}P
          </span>
          {gallery.VideoCount > 0 && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              <Video size={11} style={{ marginRight: 3 }} />
              {gallery.VideoCount}V
            </span>
          )}
          {gallery.PageCount > 1 && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              {gallery.PageCount}{t("common.pages")}
            </span>
          )}
          {gallery.PublishTime && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              <Calendar size={11} style={{ marginRight: 3 }} />
              {gallery.PublishTime}
            </span>
          )}
          {gallery.TotalSize > 0 && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              <HardDrive size={11} style={{ marginRight: 3 }} />
              {formatFileSize(gallery.TotalSize)}
            </span>
          )}
          {gallery.TotalSize <= 0 && gallery.DownloadedSize > 0 && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              <HardDrive size={11} style={{ marginRight: 3 }} />
              {formatFileSize(gallery.DownloadedSize)}
            </span>
          )}
        </div>
        {(gallery.Status === "downloading" || gallery.Status === "scraping") && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: "auto",
              flexShrink: 0,
            }}
          >
            <div className="progress-bar" style={{ minWidth: 60, flex: 1 }}>
              <div
                className={`progress-bar-fill ${fillClass}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="progress-text" style={{ fontSize: 11 }}>
              {progress ? `${progress.completed}/${progress.total}` : `${progressPct}%`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export const GalleryCard = memo(GalleryCardComponent);
