import { memo, useState, useRef, useCallback, useEffect } from "react";
import {
  Video,
  HardDrive,
  Play,
  Loader2,
  AlertCircle,
  CheckCircle,
  Circle,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatFileSize } from "@/lib/utils";
import {
  VIDEO_STATUS_LABEL,
  VIDEO_STATUS_CLASS,
  formatDuration,
  formatClock,
  videoFileUrl,
  type VideoShelfItem,
} from "../video-helpers";

export interface VideoCardProps {
  video: VideoShelfItem;
  onPlay: (video: VideoShelfItem) => void;
  /** Selection mode: clicking toggles selection instead of playing. */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (video: VideoShelfItem) => void;
}

const HOVER_DELAY = 150;

/**
 * Effective hover-preview speed (user requirement: 32X).
 * HTMLMediaElement.playbackRate is hard-capped at 16 in Chromium/Safari —
 * anything higher throws NotSupportedError (or is silently clamped). To
 * reach an effective 32x we compound the maximum supported rate with a
 * periodic time-skip: every SKIP_INTERVAL_MS the playhead jumps forward by
 * the media-seconds the capped rate cannot cover
 * (16x * 0.5s playback + 8s skip = 16 media-seconds per 0.5s wall clock).
 */
const HOVER_EFFECTIVE_RATE = 32;
const MAX_PLAYBACK_RATE = 16;
const SKIP_INTERVAL_MS = 500;
const SKIP_AHEAD_SECONDS =
  ((HOVER_EFFECTIVE_RATE - MAX_PLAYBACK_RATE) * SKIP_INTERVAL_MS) / 1000;

function setMaxHoverRate(el: HTMLVideoElement): void {
  const rates = [MAX_PLAYBACK_RATE, 8, 4, 2, 1];
  for (const rate of rates) {
    // Browser rejected this rate — fall through to the next slower one.
    try {
      el.playbackRate = rate;
      return;
    } catch {
    }
  }
}

function VideoCardComponent({
  video,
  onPlay,
  selectMode = false,
  selected = false,
  onToggleSelect,
}: VideoCardProps): React.JSX.Element {
  const { t } = useI18n();
  const [isHovering, setIsHovering] = useState(false);
  const [hoverReady, setHoverReady] = useState(false);
  const [videoError, setVideoError] = useState(false);
  /*
   * Real duration probed from the file's own metadata — the most truthful
   * source (guards against stale/misplaced DB values). Falls back to the
   * DB minutes value when the file has no playable metadata.
   */
  const [fileDuration, setFileDuration] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      if (skipIntervalRef.current) {
        clearInterval(skipIntervalRef.current);
      }
    };
  }, []);

  const canPreview = video.HasFile;
  const durationText =
    fileDuration != null ? formatClock(fileDuration) : formatDuration(video.Duration);

  const startPreview = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setMaxHoverRate(el);
    el.play().catch(() => {});

    /*
     * Compound the capped playbackRate into an effective 32x: periodically
     * jump the playhead forward by the uncovered media-seconds. Skipped
     * frames render as keyframe hops — expected at extreme skim speeds.
     */
    if (skipIntervalRef.current) {
      clearInterval(skipIntervalRef.current);
    }
    skipIntervalRef.current = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || v.error) return;
      const dur = Number.isFinite(v.duration) ? v.duration : 0;
      let next = v.currentTime + SKIP_AHEAD_SECONDS;
      if (dur > 0 && next >= dur - 0.1) next = 0.1; // Wrap the muted loop
      // Seek can fail while the target position is not yet buffered.
      try { v.currentTime = next; } catch {}
    }, SKIP_INTERVAL_MS);
  }, []);

  const stopPreview = useCallback(() => {
    if (skipIntervalRef.current) {
      clearInterval(skipIntervalRef.current);
      skipIntervalRef.current = null;
    }
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (selectMode || !canPreview) return;
    setIsHovering(true);
    hoverTimerRef.current = setTimeout(() => {
      setHoverReady(true);
      startPreview();
    }, HOVER_DELAY);
  }, [selectMode, canPreview, startPreview]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setHoverReady(false);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    stopPreview();
  }, [stopPreview]);

  const handleClick = useCallback(() => {
    if (selectMode) {
      onToggleSelect?.(video);
      return;
    }
    if (canPreview) onPlay(video);
  }, [selectMode, onToggleSelect, video, onPlay, canPreview]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (selectMode) onToggleSelect?.(video);
      else if (canPreview) onPlay(video);
    },
    [selectMode, onToggleSelect, video, onPlay, canPreview],
  );

  return (
    <div
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={video.Title || t("video.videoTitle", { id: video.ID })}
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--bg-card)",
        border: `1px solid ${selected ? "var(--accent)" : "var(--border)"}`,
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        cursor: selectMode || canPreview ? "pointer" : "default",
        transition: "border-color 0.15s, box-shadow 0.15s",
        outline: "none",
        boxShadow: selected ? "0 0 0 1px var(--accent)" : "none",
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
        {canPreview ? (
          <video
            ref={videoRef}
            src={`${videoFileUrl(video.ID)}#t=0.1`}
            preload="metadata"
            muted
            loop
            playsInline
            onError={() => setVideoError(true)}
            onLoadedData={(e) => {
              /*
               * Seek slightly past 0 so the browser paints a real frame
               * as the poster instead of a blank player.
               */
              const el = e.target as HTMLVideoElement;
              // Seek can fail while the element is not ready — ignore.
              if (el.currentTime < 0.05) {
                try { el.currentTime = 0.1; } catch {}
              }
            }}
            onLoadedMetadata={(e) => {
              // The file's own duration beats the DB value — use it.
              const el = e.target as HTMLVideoElement;
              if (Number.isFinite(el.duration) && el.duration > 0) {
                setFileDuration(el.duration);
              }
            }}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
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
            <Video size={40} strokeWidth={1.5} />
          </div>
        )}

        {isHovering && hoverReady && canPreview && !videoError && (
          <div
            style={{
              position: "absolute",
              bottom: 6,
              right: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              background: "rgba(0,0,0,0.65)",
              borderRadius: 4,
              fontSize: 10,
              color: "white",
              fontWeight: 700,
            }}
          >
            <Play size={10} fill="white" />
            {HOVER_EFFECTIVE_RATE}X
          </div>
        )}

        {isHovering && !hoverReady && canPreview && !videoError && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.35)",
            }}
          >
            <Loader2 size={28} className="spin" style={{ color: "white" }} />
          </div>
        )}

        {canPreview && videoError && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.6)",
              color: "white",
              gap: 6,
              fontSize: 12,
            }}
          >
            <AlertCircle size={18} />
            {t("video.previewError")}
          </div>
        )}

        <div
          style={{
            position: "absolute",
            bottom: 6,
            left: 6,
            padding: "2px 6px",
            background: "rgba(0,0,0,0.65)",
            borderRadius: 4,
            fontSize: 10,
            color: "white",
            fontWeight: 600,
          }}
        >
          {durationText}
        </div>

        <span
          className={`badge ${VIDEO_STATUS_CLASS[video.Status] || "badge-default"}`}
          style={{ position: "absolute", top: 8, right: 8, fontSize: 11 }}
        >
          {VIDEO_STATUS_LABEL[video.Status] ? t(VIDEO_STATUS_LABEL[video.Status]) : video.Status}
        </span>

        {selectMode && (
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              display: "flex",
              alignItems: "center",
              color: selected ? "var(--accent)" : "white",
              filter: selected ? "none" : "drop-shadow(0 1px 2px rgba(0,0,0,0.6))",
            }}
          >
            {selected ? <CheckCircle size={22} fill="var(--accent)" stroke="white" /> : <Circle size={22} />}
          </span>
        )}
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
            marginBottom: 6,
            flexShrink: 0,
          }}
          title={video.Title}
        >
          {video.Title || t("video.videoTitle", { id: video.ID })}
        </div>
        <div
          style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            overflow: "hidden",
            marginTop: "auto",
          }}
        >
          {video.Resolution && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              {video.Resolution}
            </span>
          )}
          {video.TotalSize > 0 && (
            <span className="pill" style={{ fontSize: 11, padding: "2px 8px" }}>
              <HardDrive size={11} style={{ marginRight: 3 }} />
              {formatFileSize(video.TotalSize)}
            </span>
          )}
        </div>
        {(video.Status === "downloading" || video.Status === "scraping") && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
              flexShrink: 0,
            }}
          >
            <div className="progress-bar" style={{ minWidth: 60, flex: 1 }}>
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.round(video.Progress)}%` }}
              />
            </div>
            <span className="progress-text" style={{ fontSize: 11 }}>
              {Math.round(video.Progress)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export const VideoCard = memo(VideoCardComponent);
