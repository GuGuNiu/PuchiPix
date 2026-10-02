import { useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  ListVideo,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatClock } from "../video-helpers";

/**
 * Every interactive element stops event propagation so a click on a control
 * never reaches the video surface, which toggles play/pause.
 */
export interface VideoControlsProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  rate: number;
  hasPrev: boolean;
  hasNext: boolean;
  queueCount: number;
  panelOpen: boolean;
  visible: boolean;
  isFullscreen: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolume: (v: number) => void;
  onToggleMute: () => void;
  onRate: (r: number) => void;
  onTogglePanel: () => void;
  onToggleFullscreen: () => void;
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8, 16];

export function VideoControls(props: VideoControlsProps): React.JSX.Element {
  const { t } = useI18n();
  const {
    playing,
    currentTime,
    duration,
    bufferedEnd,
    volume,
    muted,
    rate,
    hasPrev,
    hasNext,
    queueCount,
    panelOpen,
    visible,
    isFullscreen,
    onTogglePlay,
    onPrev,
    onNext,
    onSeek,
    onVolume,
    onToggleMute,
    onRate,
    onTogglePanel,
    onToggleFullscreen,
  } = props;

  const trackRef = useRef<HTMLDivElement>(null);
  const [dragTime, setDragTime] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [rateMenuOpen, setRateMenuOpen] = useState(false);

  const shownTime = dragTime ?? currentTime;
  const playedRatio = duration > 0 ? Math.min(shownTime / duration, 1) : 0;
  const bufferedRatio = duration > 0 ? Math.min(bufferedEnd / duration, 1) : 0;

  const ratioFromEvent = useCallback((clientX: number): number | null => {
    const el = trackRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  }, []);

  const handleTrackDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      const ratio = ratioFromEvent(e.clientX);
      if (ratio == null) return;
      setDragTime(ratio * duration);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [ratioFromEvent, duration],
  );

  const handleTrackMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const ratio = ratioFromEvent(e.clientX);
      setHoverRatio(ratio);
      if (dragTime == null) return;
      e.stopPropagation();
      if (ratio != null) setDragTime(ratio * duration);
    },
    [ratioFromEvent, dragTime, duration],
  );

  const handleTrackUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragTime == null) return;
      e.stopPropagation();
      onSeek(dragTime);
      setDragTime(null);
    },
    [dragTime, onSeek],
  );

  const stop = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const btnStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    border: "none",
    background: "transparent",
    color: "white",
    cursor: "pointer",
    borderRadius: "var(--radius-sm)",
    padding: 0,
  };

  const disabledBtn = (disabled: boolean): React.CSSProperties => ({
    ...btnStyle,
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? "default" : "pointer",
  });

  return (
    <div
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "24px 12px 8px",
        background: "linear-gradient(transparent, rgba(0,0,0,0.75))",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 0.25s",
        userSelect: "none",
      }}
    >
      <div
        ref={trackRef}
        onPointerDown={handleTrackDown}
        onPointerMove={handleTrackMove}
        onPointerUp={handleTrackUp}
        onPointerLeave={() => setHoverRatio(null)}
        style={{
          position: "relative",
          height: 14,
          display: "flex",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: dragTime != null ? 6 : 4,
            background: "rgba(255,255,255,0.25)",
            borderRadius: 3,
            transition: "height 0.15s",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${bufferedRatio * 100}%`,
              background: "rgba(255,255,255,0.35)",
              borderRadius: 3,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${playedRatio * 100}%`,
              background: "var(--accent)",
              borderRadius: 3,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${playedRatio * 100}%`,
              top: "50%",
              width: 12,
              height: 12,
              transform: "translate(-50%, -50%)",
              background: "var(--accent)",
              borderRadius: "50%",
              boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
              opacity: dragTime != null ? 1 : 0.9,
            }}
          />
        </div>
        {hoverRatio != null && duration > 0 && (
          <div
            style={{
              position: "absolute",
              left: `${hoverRatio * 100}%`,
              bottom: 18,
              transform: "translateX(-50%)",
              padding: "2px 6px",
              background: "rgba(0,0,0,0.8)",
              borderRadius: 4,
              fontSize: 11,
              color: "white",
              whiteSpace: "nowrap",
              pointerEvents: "none",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatClock(hoverRatio * duration)}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          marginTop: 2,
        }}
      >
        <button
          style={btnStyle}
          onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
          aria-label={playing ? t("video.pause") : t("video.play")}
          title={playing ? t("video.pause") : t("video.play")}
        >
          {playing ? <Pause size={18} fill="white" /> : <Play size={18} fill="white" />}
        </button>

        <button
          style={disabledBtn(!hasPrev)}
          onClick={(e) => { e.stopPropagation(); if (hasPrev) onPrev(); }}
          aria-label={t("video.prevVideo")}
          title={t("video.prevVideo")}
        >
          <SkipBack size={16} fill="white" />
        </button>
        <button
          style={disabledBtn(!hasNext)}
          onClick={(e) => { e.stopPropagation(); if (hasNext) onNext(); }}
          aria-label={t("video.nextVideo")}
          title={t("video.nextVideo")}
        >
          <SkipForward size={16} fill="white" />
        </button>

        <div
          onMouseEnter={() => setVolumeOpen(true)}
          onMouseLeave={() => setVolumeOpen(false)}
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          <button
            style={btnStyle}
            onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
            aria-label={muted ? t("video.unmute") : t("video.mute")}
            title={muted ? t("video.unmute") : t("video.mute")}
          >
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => onVolume(parseFloat(e.target.value))}
            onClick={(e) => e.stopPropagation()}
            aria-label={t("video.volume")}
            style={{
              width: volumeOpen ? 64 : 0,
              opacity: volumeOpen ? 1 : 0,
              transition: "width 0.2s, opacity 0.2s",
              accentColor: "var(--accent)",
              cursor: "pointer",
            }}
          />
        </div>

        <span
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.85)",
            margin: "0 8px",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {formatClock(shownTime)} / {formatClock(duration)}
        </span>

        <div style={{ flex: 1 }} />

        <div style={{ position: "relative" }}>
          <button
            style={{ ...btnStyle, width: "auto", padding: "0 8px", fontSize: 12, fontWeight: 600 }}
            onClick={(e) => { e.stopPropagation(); setRateMenuOpen((v) => !v); }}
            title={t("video.playbackRate")}
          >
            {rate}x
          </button>
          {rateMenuOpen && (
            <div
              onMouseDown={stop}
              onClick={stop}
              style={{
                position: "absolute",
                bottom: 38,
                right: 0,
                minWidth: 72,
                background: "rgba(20,20,20,0.95)",
                borderRadius: "var(--radius-sm)",
                padding: "4px 0",
                boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              {RATES.map((r) => (
                <button
                  key={r}
                  onClick={(e) => { e.stopPropagation(); onRate(r); setRateMenuOpen(false); }}
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "5px 14px",
                    border: "none",
                    background: r === rate ? "var(--accent)" : "transparent",
                    color: r === rate ? "white" : "rgba(255,255,255,0.85)",
                    fontSize: 12,
                    textAlign: "right",
                    cursor: "pointer",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {r}x
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          style={{ ...btnStyle, opacity: panelOpen ? 1 : 0.6, background: panelOpen ? "rgba(255,255,255,0.15)" : "transparent" }}
          onClick={(e) => { e.stopPropagation(); onTogglePanel(); }}
          aria-label={t("video.playlist")}
          title={t("video.playlist")}
        >
          <ListVideo size={16} />
          {queueCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                fontSize: 9,
                fontWeight: 700,
                background: "var(--accent)",
                color: "white",
                borderRadius: 8,
                minWidth: 14,
                height: 14,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 3px",
              }}
            >
              {queueCount}
            </span>
          )}
        </button>

        <button
          style={btnStyle}
          onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }}
          aria-label={isFullscreen ? t("video.exitFullscreen") : t("video.fullscreen")}
          title={isFullscreen ? t("video.exitFullscreen") : t("video.fullscreen")}
        >
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
      </div>
    </div>
  );
}
