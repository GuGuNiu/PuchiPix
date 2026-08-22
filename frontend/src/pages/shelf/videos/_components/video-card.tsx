import { memo, useState, useRef, useCallback, useEffect } from "react";
import {
  ImageIcon,
  Video,
  HardDrive,
  Calendar,
  Play,
  Loader2,
} from "lucide-react";
import { useGalleryStore } from "@/store/gallery-store";
import { useI18n } from "@/lib/i18n";
import { formatFileSize } from "@/lib/utils";
import type { GalleryData } from "@/types";
import {
  VIDEO_STATUS_LABEL,
  VIDEO_STATUS_CLASS,
} from "../video-helpers";

export interface VideoCardProps {
  gallery: GalleryData;
  isExpanded: boolean;
  onExpand: (id: number) => void;
}

function VideoCardComponent({
  gallery,
  isExpanded,
  onExpand,
}: VideoCardProps): React.JSX.Element {
  const { t } = useI18n();
  const progress = useGalleryStore((s) => s.progressMap[gallery.ID]);
  const [isHovering, setIsHovering] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchDetail = useGalleryStore((s) => s.fetchGalleryDetail);

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

  const loadVideoPreview = useCallback(async () => {
    if (videoSrc || videoError) return;
    const detail = await fetchDetail(gallery.ID);
    if (detail?.Videos && detail.Videos.length > 0) {
      const firstVideo = detail.Videos[0];
      const src = firstVideo.LocalPath
        ? `/api/proxy?path=${encodeURIComponent(firstVideo.LocalPath)}`
        : firstVideo.URL;
      if (src) {
        setVideoSrc(src);
      } else {
        setVideoError(true);
      }
    } else {
      setVideoError(true);
    }
  }, [gallery.ID, fetchDetail, videoSrc, videoError]);

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    hoverTimerRef.current = setTimeout(() => {
      loadVideoPreview();
    }, 300);
  }, [loadVideoPreview]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isHovering && videoRef.current && videoSrc) {
      videoRef.current.playbackRate = 8;
      videoRef.current.play().catch(() => {});
    }
  }, [isHovering, videoSrc]);

  return (
    <div
      onClick={() => onExpand(gallery.ID)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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

        {isHovering && videoSrc && !videoError && (
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            loop
            playsInline
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}

        {isHovering && !videoSrc && !videoError && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.4)",
            }}
          >
            <Loader2 size={28} className="spin" style={{ color: "white" }} />
          </div>
        )}

        <div
          style={{
            position: "absolute",
            bottom: 6,
            left: 6,
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            background: "rgba(0,0,0,0.65)",
            borderRadius: 4,
            fontSize: 10,
            color: "white",
            fontWeight: 600,
          }}
        >
          {isHovering && videoSrc ? (
            <>
              <Play size={10} fill="white" />
              8X
            </>
          ) : (
            <>
              <Video size={10} />
              {gallery.VideoCount}V
            </>
          )}
        </div>

        <span
          className={`badge ${VIDEO_STATUS_CLASS[gallery.Status] || "badge-default"}`}
          style={{ position: "absolute", top: 8, right: 8, fontSize: 11 }}
        >
          {VIDEO_STATUS_LABEL[gallery.Status] ? t(VIDEO_STATUS_LABEL[gallery.Status]) : gallery.Status}
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
          {gallery.Title || t("video.videoTitle", { id: gallery.ID })}
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
            {t("video.model")}{gallery.Protagonist}
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
            <Video size={11} style={{ marginRight: 3 }} />
            {gallery.VideoCount}V
          </span>
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

export const VideoCard = memo(VideoCardComponent);
