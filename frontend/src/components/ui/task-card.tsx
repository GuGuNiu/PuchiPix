"use client";

import { useRef, useState, useCallback } from "react";
import { Film, Clock, HardDrive, Play, Monitor } from "lucide-react";
import type { DownloadTask } from "@/types";
import { useI18n } from "@/lib/i18n";
import { formatFileSize } from "@/lib/utils";

interface VideoCardProps {
  task: DownloadTask;
  onClick?: () => void;
}

const PREVIEW_SPEED = 8;

export default function VideoCard({ task, onClick }: VideoCardProps): React.JSX.Element {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [posterReady, setPosterReady] = useState(false);

  const filePath = task.FilePath;
  const videoSrc = filePath ? `/api/proxy?path=${encodeURIComponent(filePath)}` : null;

  const handleMouseEnter = useCallback(() => {
    setHovered(true);
    const v = videoRef.current;
    if (v && videoSrc && !hasError) {
      v.playbackRate = PREVIEW_SPEED;
      v.currentTime = 0;
      v.play().catch(() => {
      });
    }
  }, [videoSrc, hasError]);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  }, []);

  const handleLoadedData = useCallback(() => {
    const v = videoRef.current;
    if (v && !posterReady) {
      try {
        v.currentTime = Math.min(1, v.duration || 1);
      } catch {
        setPosterReady(true);
      }
    }
  }, [posterReady]);

  const handleSeeked = useCallback(() => {
    const v = videoRef.current;
    if (v && !posterReady) {
      setPosterReady(true);
      v.pause();
    }
  }, [posterReady]);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  const statusLabel: Record<string, string> = {
    completed: t("common.completed"),
    downloading: t("common.downloading"),
    failed: t("common.failed"),
    pending: t("common.pending"),
    scrape_pending: t("common.scrapePending"),
    download_pending: t("common.downloadPending"),
    paused: t("common.paused"),
    scraping: t("common.scraping"),
    cancelled: t("common.cancelled"),
    transcoding: t("common.transcoding"),
    partial: t("common.partial"),
  };

  const statusClass: Record<string, string> = {
    completed: "badge-success",
    downloading: "badge-info",
    failed: "badge-danger",
    pending: "badge-default",
    scrape_pending: "badge-default",
    download_pending: "badge-default",
    paused: "badge-default",
    scraping: "badge-info",
    cancelled: "badge-default",
    transcoding: "badge-info",
    partial: "badge-warning",
  };

  const title = task.VideoInfo?.Title || task.URL;
  const progressPct = task.Progress.toFixed(1) + "%";
  const isCompleted = task.Status === "completed";

  return (
    <div
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
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
          aspectRatio: "16 / 9",
          background: "var(--bg-inset)",
          overflow: "hidden",
        }}
      >
        {videoSrc && !hasError ? (
          <video
            ref={videoRef}
            src={videoSrc}
            preload="metadata"
            muted
            playsInline
            onLoadedData={handleLoadedData}
            onSeeked={handleSeeked}
            onError={handleError}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: posterReady ? "block" : "none",
            }}
          />
        ) : null}

        {(!videoSrc || hasError) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-muted)",
            }}
          >
            <Film size={40} strokeWidth={1.5} />
          </div>
        )}

        {hovered && videoSrc && !hasError && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Play size={10} fill="currentColor" strokeWidth={0} />
            {PREVIEW_SPEED}X {t("common.preview")}
          </div>
        )}

        <span
          className={`badge ${statusClass[task.Status] || "badge-default"}`}
          style={{ position: "absolute", top: 8, right: 8, fontSize: 11 }}
        >
          {statusLabel[task.Status] ?? task.Status}
        </span>

        {task.VideoInfo?.Duration && (
          <span
            style={{
              position: "absolute",
              bottom: 8,
              right: 8,
              background: "rgba(0,0,0,0.75)",
              color: "#fff",
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Clock size={10} />
            {task.VideoInfo.Duration}{t("common.minutes")}
          </span>
        )}
      </div>

      <div style={{ padding: "12px 14px" }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 4,
          }}
          title={title}
        >
          {title}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
            <Film size={11} style={{ marginRight: 3 }} />
            {t("common.video")}
          </span>
          {task.VideoInfo?.Resolution && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              <Monitor size={11} style={{ marginRight: 3 }} />
              {task.VideoInfo.Resolution}
            </span>
          )}
          {task.VideoInfo?.FileSize && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              <HardDrive size={11} style={{ marginRight: 3 }} />
              {formatFileSize(task.VideoInfo.FileSize)}
            </span>
          )}
        </div>

        {!isCompleted && task.Status !== "failed" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="progress-bar" style={{ minWidth: 60, flex: 1 }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${task.Progress}%` }}
              />
            </div>
            <span className="progress-text" style={{ fontSize: 11 }}>
              {progressPct}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
