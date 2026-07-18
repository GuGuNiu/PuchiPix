"use client";

import { useRef, useCallback, useState, useEffect, memo } from "react";
import { Loader2, XCircle, Zap, Film, Tag, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { SearchItem } from "@/types";
import {
  type HlsInstance,
  type PopupData,
  previewUrlCache,
  previewFailCache,
  FAIL_CACHE_TTL,
  PREVIEW_PLAYBACK_RATE,
  HOVER_DEBOUNCE_MS,
  PREVIEW_TIMEOUT_MS,
  SPEED_MONITOR_INTERVAL_MS,
  PREVIEW_HLS_CONFIG,
  waitForHls,
  toProxyUrl,
  parseM3U8,
} from "./video-card/hls-utils";
import { StatusBadge, VideoInfoPopupContent } from "./video-card/components";

interface VideoCardProps {
  item: SearchItem;
  index: number;
  onScrape: (item: SearchItem) => void;
  gallery?: boolean;
}

function VideoCardImpl({ item, index, onScrape, gallery = false }: VideoCardProps): React.JSX.Element {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventAbortRef = useRef<AbortController | null>(null);
  const popupCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupAbortRef = useRef<AbortController | null>(null);

  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(item.m3u8Url);
  const [showInfoPopup, setShowInfoPopup] = useState(false);
  const [popupLoading, setPopupLoading] = useState(false);
  const [popupData, setPopupData] = useState<PopupData | null>(null);

  useEffect(() => {
    if (item.m3u8Url && !resolvedUrl) {
      setResolvedUrl(item.m3u8Url);
      previewUrlCache.set(item.pageUrl, item.m3u8Url);
    }
  }, [item.m3u8Url]);

  const cleanupPreview = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    if (loadingTimeoutRef.current) { clearTimeout(loadingTimeoutRef.current); loadingTimeoutRef.current = null; }
    if (speedMonitorRef.current) { clearInterval(speedMonitorRef.current); speedMonitorRef.current = null; }
    if (eventAbortRef.current) { eventAbortRef.current.abort(); eventAbortRef.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.removeAttribute("src"); videoRef.current.load(); }
    setLoading(false); setHasError(false); setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      cleanupPreview();
      if (popupCloseTimerRef.current) clearTimeout(popupCloseTimerRef.current);
      if (popupAbortRef.current) popupAbortRef.current.abort();
    };
  }, [cleanupPreview]);

  const fetchPreviewUrl = useCallback(async (pageUrl: string): Promise<string | null> => {
    const cached = previewUrlCache.get(pageUrl);
    if (cached) return cached;

    const failExpiry = previewFailCache.get(pageUrl);
    if (failExpiry && Date.now() < failExpiry) return null;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: pageUrl }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        previewFailCache.set(pageUrl, Date.now() + FAIL_CACHE_TTL);
        return null;
      }

      const data = await res.json();
      const m3u8Url = data?.m3u8_url;
      if (m3u8Url) {
        previewUrlCache.set(pageUrl, m3u8Url);
        setResolvedUrl(m3u8Url);
      } else {
        previewFailCache.set(pageUrl, Date.now() + FAIL_CACHE_TTL);
      }
      return m3u8Url || null;
    } catch {
      clearTimeout(timeout);
      previewFailCache.set(pageUrl, Date.now() + FAIL_CACHE_TTL);
      return null;
    }
  }, []);

  const playM3U8 = useCallback(async (m3u8Url: string, pageUrl: string): Promise<boolean> => {
    const video = videoRef.current;
    if (!video) return false;

    setLoading(true); setHasError(false);
    let playbackStarted = false;

    const clearLoadingTimeout = (): void => {
      if (loadingTimeoutRef.current) { clearTimeout(loadingTimeoutRef.current); loadingTimeoutRef.current = null; }
    };

    loadingTimeoutRef.current = setTimeout(() => {
      if (playbackStarted) return;
      setHasError(true); setLoading(false);
    }, PREVIEW_TIMEOUT_MS);

    if (eventAbortRef.current) eventAbortRef.current.abort();
    const eventController = new AbortController();
    eventAbortRef.current = eventController;
    const { signal } = eventController;

    const adjustPlaybackRate = (): void => {
      if (!video.buffered.length) return;
      const bufferAhead = video.buffered.end(video.buffered.length - 1) - video.currentTime;
      let targetRate = 1;
      if (bufferAhead >= 10) targetRate = PREVIEW_PLAYBACK_RATE;
      else if (bufferAhead >= 6) targetRate = 6;
      else if (bufferAhead >= 4) targetRate = 4;
      else if (bufferAhead >= 2) targetRate = 2;
      if (Math.abs(video.playbackRate - targetRate) > 0.1) video.playbackRate = targetRate;
    };

    if (speedMonitorRef.current) clearInterval(speedMonitorRef.current);
    speedMonitorRef.current = setInterval(adjustPlaybackRate, SPEED_MONITOR_INTERVAL_MS);

    video.addEventListener("waiting", () => { video.playbackRate = 1; }, { signal });
    video.addEventListener("playing", () => { adjustPlaybackRate(); }, { signal });

    const startPlayback = (): void => {
      video.playbackRate = 1;
      video.play()
        .then(() => {
          playbackStarted = true; clearLoadingTimeout();
          setIsPlaying(true); setLoading(false);
          setTimeout(adjustPlaybackRate, 300);
        })
        .catch(() => { clearLoadingTimeout(); setHasError(true); setLoading(false); });
    };

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = toProxyUrl(m3u8Url, pageUrl);
      startPlayback();
      return true;
    }

    const HlsModule = await waitForHls();
    if (HlsModule && HlsModule.isSupported()) {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      const hls = new HlsModule(PREVIEW_HLS_CONFIG);
      hlsRef.current = hls;
      hls.loadSource(toProxyUrl(m3u8Url, pageUrl));
      hls.attachMedia(video);
      hls.on(HlsModule.Events.MANIFEST_PARSED, () => { startPlayback(); });
      hls.on(HlsModule.Events.FRAG_BUFFERED, () => { adjustPlaybackRate(); });
      hls.on(HlsModule.Events.ERROR, (_e: unknown, data: unknown) => {
        const d = data as { fatal?: boolean };
        if (d.fatal) { clearLoadingTimeout(); setHasError(true); setLoading(false); setIsPlaying(false); }
      });
      return true;
    }

    setHasError(true); setLoading(false);
    return false;
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (gallery) return;
    hoverTimerRef.current = setTimeout(async () => {
      const video = videoRef.current;
      if (!video) return;
      let urlToPlay: string | undefined = resolvedUrl || item.m3u8Url;
      if (!urlToPlay && item.pageUrl) {
        setLoading(true);
        urlToPlay = (await fetchPreviewUrl(item.pageUrl)) ?? undefined;
        if (!urlToPlay) { setLoading(false); return; }
      }
      if (urlToPlay) await playM3U8(urlToPlay, item.pageUrl);
    }, HOVER_DEBOUNCE_MS);
  }, [item.pageUrl, item.m3u8Url, resolvedUrl, fetchPreviewUrl, playM3U8, gallery]);

  const handleMouseLeave = useCallback(() => { cleanupPreview(); }, [cleanupPreview]);

  const fetchPopupData = useCallback(async (): Promise<PopupData> => {
    const data: PopupData = {};
    const fetches: Promise<void>[] = [];

    if (item.taskId) {
      fetches.push(
        fetch(`/api/tasks/${item.taskId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((task) => { if (task?.VideoInfo) data.videoInfo = task.VideoInfo; })
          .catch(() => {}),
      );
    }

    const m3u8Url = resolvedUrl || item.m3u8Url;
    if (m3u8Url) {
      fetches.push(
        fetch(toProxyUrl(m3u8Url, item.pageUrl))
          .then((res) => (res.ok ? res.text() : null))
          .then((text) => { if (text) data.segments = parseM3U8(text); })
          .catch(() => {}),
      );
    }

    await Promise.all(fetches);
    return data;
  }, [item.taskId, item.m3u8Url, item.pageUrl, resolvedUrl]);

  const handleTagButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (popupCloseTimerRef.current) { clearTimeout(popupCloseTimerRef.current); popupCloseTimerRef.current = null; }
    if (showInfoPopup) return;
    setShowInfoPopup(true); setPopupLoading(true); setPopupData(null);
    if (popupAbortRef.current) popupAbortRef.current.abort();
    const controller = new AbortController();
    popupAbortRef.current = controller;
    fetchPopupData()
      .then((data) => { if (!controller.signal.aborted) { setPopupData(data); setPopupLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) setPopupLoading(false); });
  }, [showInfoPopup, fetchPopupData]);

  const handlePopupMouseEnter = useCallback(() => {
    if (popupCloseTimerRef.current) { clearTimeout(popupCloseTimerRef.current); popupCloseTimerRef.current = null; }
  }, []);

  const handlePopupMouseLeave = useCallback(() => {
    popupCloseTimerRef.current = setTimeout(() => { setShowInfoPopup(false); }, 200);
  }, []);

  const title = item.title || item.pageUrl;
  const cover = item.coverUrl || "";
  const canScrape = item.status === "pending" || item.status === "failed";

  const handleScrapeClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    onScrape(item);
  };

  return (
    <div
      className="video-card"
      onMouseEnter={gallery ? undefined : handleMouseEnter}
      onMouseLeave={gallery ? undefined : handleMouseLeave}
      style={{ contain: "content" }}
    >
      <div className="video-card-thumb">
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`video-card-cover ${isPlaying ? "hidden" : ""}`}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className={`video-card-placeholder ${isPlaying ? "hidden" : ""}`}>
            <Film size={32} strokeWidth={1.5} />
          </div>
        )}

        <video ref={videoRef} muted playsInline preload="none" className={isPlaying ? "visible" : ""} />

        {(loading || hasError) && !isPlaying && (
          <div className="video-card-play-overlay">
            {loading ? (
              <Loader2 size={28} className="spinner" style={{ color: "#fff" }} />
            ) : (
              <XCircle size={28} style={{ color: "#fff" }} />
            )}
          </div>
        )}

        <div className="video-card-badge">
          <StatusBadge status={item.status} taskId={item.taskId} />
        </div>

        {canScrape && (
          <button className="video-card-scrape-btn" onClick={handleScrapeClick} title={t("search.scrapeThisVideo")}>
            <Zap size={14} />
            {t("search.scrape")}
          </button>
        )}
      </div>

      <div className="video-card-info">
        <div className="video-card-title" title={title}>{title}</div>
        <div className="video-card-meta">
          <span>#{index + 1}</span>
          {item.date && (<><span>·</span><span>{item.date}</span></>)}
          {item.status === "downloaded" && item.taskId && (
            <><span>·</span><span style={{ display: "flex", alignItems: "center", gap: 3 }}><Download size={10} />{t("search.taskId", { id: item.taskId })}</span></>
          )}
          <span
            className={`video-card-tag-btn ${showInfoPopup ? "active" : ""}`}
            onClick={handleTagButtonClick}
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
          >
            <Tag size={11} />{t("search.tags")}
          </span>
        </div>

        {showInfoPopup && (
          <div className="video-info-popup" onMouseEnter={handlePopupMouseEnter} onMouseLeave={handlePopupMouseLeave}>
            {popupLoading ? (
              <div className="video-info-popup-loading">
                <Loader2 size={16} className="spinner" />
                <span>{t("search.loadingData")}</span>
              </div>
            ) : (
              <VideoInfoPopupContent item={item} data={popupData} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const VideoCard = memo(VideoCardImpl, (prev, next) => {
  return (
    prev.item.pageUrl === next.item.pageUrl &&
    prev.item.status === next.item.status &&
    prev.item.title === next.item.title &&
    prev.item.m3u8Url === next.item.m3u8Url &&
    prev.item.taskId === next.item.taskId &&
    prev.item.coverUrl === next.item.coverUrl &&
    prev.item.date === next.item.date &&
    prev.index === next.index &&
    prev.gallery === next.gallery
  );
});

export default VideoCard;
