import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Plus,
  Check,
  ChevronUp,
  ChevronDown,
  Search as SearchIcon,
  ListVideo,
  Play,
  Pause,
  Trash2,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import {
  formatDuration,
  videoFileUrl,
  type VideoShelfItem,
} from "../video-helpers";
import { useVideoPlaylistStore } from "../playlist-store";
import { VideoControls } from "./video-controls";

/**
 * Full-featured playlist player for the videos shelf.
 *
 * Borrowed ideas from actively maintained OSS players:
 *  - ArtPlayer: layered overlays (video surface / bottom control layer /
 *    side playlist layer), auto-hiding controls, click-surface to toggle.
 *  - XGPlayer: centralized event lifecycle — every DOM/window listener is
 *    registered inside an effect with a full cleanup, and player media
 *    state (volume/muted/rate) is applied imperatively to the element.
 *
 * The queue lives in the persistent playlist store (survives reloads);
 * this component resolves IDs against the freshest shelf items passed in
 * via props, so "what do I want to watch" is fully self-service: browse
 * all videos, add/remove/reorder entries and switch playback at will.
 */
export interface VideoPlayerModalProps {
  items: VideoShelfItem[];
  onClose: () => void;
}

const CONTROLS_HIDE_MS = 3000;

export function VideoPlayerModal({
  items,
  onClose,
}: VideoPlayerModalProps): React.JSX.Element | null {
  const { t } = useI18n();

  const queueIds = useVideoPlaylistStore((s) => s.queueIds);
  const currentId = useVideoPlaylistStore((s) => s.currentId);
  const addToQueue = useVideoPlaylistStore((s) => s.addToQueue);
  const removeFromQueue = useVideoPlaylistStore((s) => s.removeFromQueue);
  const clearQueue = useVideoPlaylistStore((s) => s.clearQueue);
  const moveInQueue = useVideoPlaylistStore((s) => s.moveInQueue);
  const setCurrent = useVideoPlaylistStore((s) => s.setCurrent);
  const next = useVideoPlaylistStore((s) => s.next);
  const prev = useVideoPlaylistStore((s) => s.prev);

  const byId = useMemo(() => {
    const map = new Map<number, VideoShelfItem>();
    for (const v of items) map.set(v.ID, v);
    return map;
  }, [items]);

  const current = currentId != null ? (byId.get(currentId) ?? null) : null;

  const queueItems = useMemo(
    () =>
      queueIds
        .map((id) => byId.get(id))
        .filter((v): v is VideoShelfItem => v != null),
    [queueIds, byId],
  );

  const queuePos = currentId != null ? queueIds.indexOf(currentId) : -1;
  const hasPrev = queuePos > 0;
  const hasNext = queuePos >= 0 && queuePos < queueIds.length - 1;

  const goPrev = useCallback(() => {
    prev();
  }, [prev]);
  const goNext = useCallback(() => {
    next();
  }, [next]);

  // ---- Player media state ----
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"queue" | "all">("all");
  const [listSearch, setListSearch] = useState("");
  const [controlsVisible, setControlsVisible] = useState(true);
  const [centerFlash, setCenterFlash] = useState<"play" | "pause" | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, []);

  const showCenterFlash = useCallback((kind: "play" | "pause") => {
    setCenterFlash(kind);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setCenterFlash(null), 450);
  }, []);

  const handleSurfaceClick = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const willPlay = el.paused;
    togglePlay();
    showCenterFlash(willPlay ? "play" : "pause");
  }, [togglePlay, showCenterFlash]);

  const handleSurfaceDoubleClick = useCallback(() => {
    toggleFullscreenRef.current?.();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const el = videoRef.current;
    if (!el) return;
    const dur = Number.isFinite(el.duration) ? el.duration : 0;
    const target = Math.min(Math.max(el.currentTime + delta, 0), dur || el.currentTime + delta);
    // Seek can fail before metadata is ready — safe to ignore.
    try { el.currentTime = target; } catch {}
  }, []);

  const changeVolume = useCallback((v: number) => {
    setVolume(v);
    if (v > 0) setMuted(false);
  }, []);

  const applyRate = useCallback((r: number) => {
    setRate(r);
  }, []);

  // Fullscreen (ref indirection keeps the double-click handler stable).
  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void shell.requestFullscreen();
    }
  }, []);
  const toggleFullscreenRef = useRef(toggleFullscreen);
  toggleFullscreenRef.current = toggleFullscreen;

  /*
   * Media element sync: apply volume/muted/rate imperatively and re-apply
   * after every source switch (key={currentId} remounts the element).
   */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // Property sets can throw on freshly mounted elements — ignore.
    try { el.volume = volume; } catch {}
    try { el.muted = muted; } catch {}
    try { el.playbackRate = rate; } catch {}
  }, [volume, muted, rate, currentId]);

  // Keyboard shortcuts (skip while typing in the panel search box).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seekBy(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seekBy(5);
          break;
        case "ArrowUp":
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.1));
          break;
        case "m":
        case "M":
          setMuted((v) => !v);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "n":
        case "N":
        case "]":
        case "PageDown":
          goNext();
          break;
        case "p":
        case "P":
        case "[":
        case "PageUp":
          goPrev();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, togglePlay, seekBy, changeVolume, volume, toggleFullscreen, goNext, goPrev]);

  // Track fullscreen changes (Esc exits fullscreen natively).
  useEffect(() => {
    const onFsChange = (): void => {
      setIsFullscreen(document.fullscreenElement === shellRef.current);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Auto-hide controls while playing; always visible when paused.
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      const el = videoRef.current;
      if (el && !el.paused) setControlsVisible(false);
    }, CONTROLS_HIDE_MS);
  }, []);

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      return;
    }
    revealControls();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [playing, revealControls]);

  // Never park on an unplayable current entry — skip forward automatically.
  useEffect(() => {
    if (currentId == null) return;
    const item = byId.get(currentId);
    if (item && !item.HasFile) {
      const idx = queueIds.indexOf(currentId);
      if (idx >= 0 && idx < queueIds.length - 1) {
        setCurrent(queueIds[idx + 1]);
      }
    }
  }, [currentId, byId, queueIds, setCurrent]);

  const filteredAll = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (v) =>
        (v.Title || "").toLowerCase().includes(q) ||
        v.DisplayID.toLowerCase().includes(q),
    );
  }, [items, listSearch]);

  if (!current) return null;

  const title = current.Title || t("video.videoTitle", { id: current.ID });
  const queueCount = queueIds.length;

  const listItemStyle = (active: boolean, playable: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    cursor: playable ? "pointer" : "default",
    opacity: playable ? 1 : 0.45,
    background: active ? "var(--bg-inset)" : "transparent",
    borderLeft: `2px solid ${active ? "var(--accent)" : "transparent"}`,
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        ref={shellRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "min(1280px, 100%)",
          height: panelOpen ? "min(90vh, 760px)" : "auto",
          maxHeight: "90vh",
          background: "var(--bg-card)",
          borderRadius: isFullscreen ? 0 : "var(--radius-md)",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header layer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <ListVideo size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={title}
          >
            {title}
          </div>
          {queueCount > 0 && (
            <span
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {Math.max(queuePos, 0) + 1} / {queueCount}
            </span>
          )}
          <button
            className="btn btn-outline btn-sm"
            onClick={onClose}
            aria-label="close"
            title="Esc"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body layer: video surface + playlist panel */}
        <div style={{ display: "flex", minHeight: 0, flex: 1 }}>
          <div
            onMouseMove={revealControls}
            onMouseLeave={() => {
              const el = videoRef.current;
              if (el && !el.paused) setControlsVisible(false);
            }}
            onClick={handleSurfaceClick}
            onDoubleClick={handleSurfaceDoubleClick}
            style={{
              position: "relative",
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "black",
              cursor: controlsVisible || !playing ? "default" : "none",
            }}
          >
            <video
              ref={videoRef}
              key={current.ID}
              src={videoFileUrl(current.ID)}
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
              onDurationChange={(e) => {
                const d = (e.target as HTMLVideoElement).duration;
                setDuration(Number.isFinite(d) ? d : 0);
              }}
              onLoadedMetadata={(e) => {
                const d = (e.target as HTMLVideoElement).duration;
                setDuration(Number.isFinite(d) ? d : 0);
              }}
              onProgress={(e) => {
                const el = e.target as HTMLVideoElement;
                if (el.buffered.length > 0) {
                  setBufferedEnd(el.buffered.end(el.buffered.length - 1));
                }
              }}
              onEnded={() => {
                if (hasNext) goNext();
              }}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />

            {centerFlash && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: "50%",
                    background: "rgba(0,0,0,0.55)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                  }}
                >
                  {centerFlash === "play" ? (
                    <Play size={34} fill="white" />
                  ) : (
                    <Pause size={34} fill="white" />
                  )}
                </div>
              </div>
            )}

            <div
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
            >
              <VideoControls
                playing={playing}
                currentTime={currentTime}
                duration={duration}
                bufferedEnd={bufferedEnd}
                volume={volume}
                muted={muted}
                rate={rate}
                hasPrev={hasPrev}
                hasNext={hasNext}
                queueCount={queueCount}
                panelOpen={panelOpen}
                visible={controlsVisible}
                isFullscreen={isFullscreen}
                onTogglePlay={() => {
                  togglePlay();
                  showCenterFlash(playing ? "pause" : "play");
                }}
                onPrev={goPrev}
                onNext={goNext}
                onSeek={(time) => {
                  const el = videoRef.current;
                  if (!el) return;
                  // Seek can fail while the source is still loading.
                  try { el.currentTime = time; } catch {}
                  setCurrentTime(time);
                }}
                onVolume={changeVolume}
                onToggleMute={() => setMuted((v) => !v)}
                onRate={applyRate}
                onTogglePanel={() => setPanelOpen((v) => !v)}
                onToggleFullscreen={toggleFullscreen}
              />
            </div>
          </div>

          {panelOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 300,
                flexShrink: 0,
                borderLeft: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                background: "var(--bg-card)",
              }}
            >
              {/* Tabs */}
              <div
                style={{
                  display: "flex",
                  flexShrink: 0,
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {(["queue", "all"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPanelTab(tab)}
                    style={{
                      flex: 1,
                      padding: "9px 0",
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      background: "transparent",
                      color: panelTab === tab ? "var(--accent)" : "var(--text-secondary)",
                      borderBottom: `2px solid ${panelTab === tab ? "var(--accent)" : "transparent"}`,
                      cursor: "pointer",
                    }}
                  >
                    {tab === "queue"
                      ? `${t("video.playlist")}${queueCount > 0 ? ` (${queueCount})` : ""}`
                      : t("video.allVideos")}
                  </button>
                ))}
              </div>

              {panelTab === "queue" ? (
                <>
                  <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                    {queueItems.length === 0 ? (
                      <div
                        style={{
                          padding: "24px 12px",
                          fontSize: 12,
                          color: "var(--text-muted)",
                          textAlign: "center",
                        }}
                      >
                        {t("video.listEmpty")}
                      </div>
                    ) : (
                      queueItems.map((item, i) => {
                        const active = item.ID === currentId;
                        return (
                          <div
                            key={item.ID}
                            onClick={() => {
                              if (item.HasFile) setCurrent(item.ID);
                            }}
                            style={listItemStyle(active, item.HasFile)}
                            title={item.Title}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                width: 16,
                                textAlign: "right",
                                flexShrink: 0,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {i + 1}
                            </span>
                            {active && playing ? (
                              <Play size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                            ) : null}
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 12,
                                color: "var(--text-primary)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.Title || t("video.videoTitle", { id: item.ID })}
                            </span>
                            <span
                              style={{
                                display: "flex",
                                gap: 2,
                                flexShrink: 0,
                              }}
                            >
                              <button
                                disabled={i === 0}
                                onClick={(e) => { e.stopPropagation(); moveInQueue(item.ID, -1); }}
                                style={panelMiniBtn(i === 0)}
                                aria-label="move up"
                              >
                                <ChevronUp size={13} />
                              </button>
                              <button
                                disabled={i === queueItems.length - 1}
                                onClick={(e) => { e.stopPropagation(); moveInQueue(item.ID, 1); }}
                                style={panelMiniBtn(i === queueItems.length - 1)}
                                aria-label="move down"
                              >
                                <ChevronDown size={13} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeFromQueue(item.ID); }}
                                style={panelMiniBtn(false)}
                                aria-label={t("video.removeFromList")}
                                title={t("video.removeFromList")}
                              >
                                <X size={13} />
                              </button>
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                flexShrink: 0,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {formatDuration(item.Duration)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {queueCount > 0 && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={clearQueue}
                      style={{
                        margin: 8,
                        flexShrink: 0,
                        justifyContent: "center",
                      }}
                    >
                      <Trash2 size={13} />
                      {t("video.clearList")}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div
                    style={{
                      padding: "8px 10px",
                      position: "relative",
                      flexShrink: 0,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <SearchIcon
                      size={13}
                      style={{
                        position: "absolute",
                        left: 18,
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: "var(--text-muted)",
                        pointerEvents: "none",
                      }}
                    />
                    <input
                      type="text"
                      value={listSearch}
                      onChange={(e) => setListSearch(e.target.value)}
                      placeholder={t("video.searchPlaceholder")}
                      style={{
                        width: "100%",
                        padding: "5px 10px 5px 28px",
                        fontSize: 12,
                        height: 28,
                        boxSizing: "border-box",
                        background: "var(--bg-inset)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                    {filteredAll.length === 0 ? (
                      <div
                        style={{
                          padding: "24px 12px",
                          fontSize: 12,
                          color: "var(--text-muted)",
                          textAlign: "center",
                        }}
                      >
                        {t("video.noMatchingVideos")}
                      </div>
                    ) : (
                      filteredAll.map((item) => {
                        const active = item.ID === currentId;
                        const inQueue = queueIds.includes(item.ID);
                        return (
                          <div
                            key={item.ID}
                            onClick={() => {
                              if (item.HasFile) addToQueue(item.ID, true);
                            }}
                            style={listItemStyle(active, item.HasFile)}
                            title={item.Title}
                          >
                            {active && playing ? (
                              <Play size={12} style={{ color: "var(--accent)", flexShrink: 0 }} />
                            ) : (
                              <span style={{ width: 12, flexShrink: 0 }} />
                            )}
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 12,
                                color: "var(--text-primary)",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.Title || t("video.videoTitle", { id: item.ID })}
                            </span>
                            <button
                              disabled={inQueue}
                              onClick={(e) => { e.stopPropagation(); addToQueue(item.ID); }}
                              style={panelMiniBtn(inQueue)}
                              aria-label={inQueue ? t("video.addedToList") : t("video.addToList")}
                              title={inQueue ? t("video.addedToList") : t("video.addToList")}
                            >
                              {inQueue ? <Check size={13} /> : <Plus size={13} />}
                            </button>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--text-muted)",
                                flexShrink: 0,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {formatDuration(item.Duration)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function panelMiniBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    border: "none",
    background: "transparent",
    color: disabled ? "var(--text-muted)" : "var(--text-secondary)",
    opacity: disabled ? 0.3 : 1,
    cursor: disabled ? "default" : "pointer",
    borderRadius: "var(--radius-sm)",
    padding: 0,
    flexShrink: 0,
  };
}
