"use client";

import { useRef, useCallback, useState, useEffect, memo } from "react";
import { Loader2, CheckCircle2, XCircle, Download, Zap, Film, Tag } from "lucide-react";
import type { SearchItem, VideoInfo } from "@/types";

declare global {
  interface Window {
    Hls?: {
      new (config: Record<string, unknown>): HlsInstance;
      isSupported(): boolean;
      Events: { MANIFEST_PARSED: string; ERROR: string; FRAG_BUFFERED: string };
    };
  }
}

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, callback: (...args: unknown[]) => void): void;
  destroy(): void;
}

interface VideoCardProps {
  item: SearchItem;
  index: number;
  onScrape: (item: SearchItem) => void;
  /** 图库模式：禁用 HLS 悬浮预览（图片站点） */
  gallery?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "等待爬取",
  scraping: "爬取中",
  downloaded: "已下载",
  failed: "失败",
};

const previewUrlCache = new Map<string, string>();
/** 预览失败缓存（避免同一 URL 反复请求），值为过期时间戳 */
const previewFailCache = new Map<string, number>();
/** 失败缓存 TTL（30 秒后允许重试） */
const FAIL_CACHE_TTL = 30_000;

/** 悬浮预览目标倍速（自适应会根据缓冲健康度在 1x~8x 间动态调节） */
const PREVIEW_PLAYBACK_RATE = 8;
/** 鼠标悬浮防抖延迟（毫秒） */
const HOVER_DEBOUNCE_MS = 400;
/** 预览请求超时（毫秒） */
const PREVIEW_TIMEOUT_MS = 8000;
/** 倍速自适应监控间隔（毫秒） */
const SPEED_MONITOR_INTERVAL_MS = 500;

/**
 * 等待 HLS.js 全局对象加载完成
 *
 * HLS.js 通过 <script defer> 加载，客户端路由导航时可能尚未就绪。
 * 最多等待 3 秒，每 100ms 检查一次。
 *
 */
function waitForHls(): Promise<typeof window.Hls | null> {
  return new Promise((resolve) => {
    if (window.Hls) {
      resolve(window.Hls);
      return;
    }
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 100;
      if (window.Hls) {
        clearInterval(interval);
        resolve(window.Hls);
      } else if (elapsed >= 3000) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}

/**
 * HLS 预览配置
 *
 * 倍速预览需要较大缓冲区：8x 倍速下每秒消耗 8 秒视频数据，
 * maxBufferLength=30 可支撑约 3.75 秒的 8x 播放，配合自适应降速避免卡顿。
 * 移除 lowLatencyMode / liveSyncDuration（直播专用，对 VOD 高速预览适得其反）。
 *
 */
const PREVIEW_HLS_CONFIG = {
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  enableWorker: true,
  startLevel: 0,
  startFragPrefetch: true,
};

/**
 * 将 m3u8 URL 包装为代理 URL，解决 CDN Referer 校验问题
 * @param m3u8Url - m3u8 播放列表 URL
 * @param pageUrl - 视频页面 URL（用于生成正确的 Referer）
 */
function toProxyUrl(m3u8Url: string, pageUrl: string): string {
  const referer = pageUrl || new URL(m3u8Url).origin + '/';
  return `/api/proxy?referer=${encodeURIComponent(referer)}&url=${encodeURIComponent(m3u8Url)}`;
}

/** 弹窗数据类型 */
interface PopupData {
  videoInfo?: VideoInfo;
  segments?: { count: number; totalDuration: number };
}

/**
 * 解析 m3u8 播放列表，提取分片数量和总时长
 */
function parseM3U8(content: string): { count: number; totalDuration: number } {
  const lines = content.split("\n");
  let count = 0;
  let totalDuration = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#EXTINF:")) {
      const duration = parseFloat(trimmed.substring(8).split(",")[0]);
      if (!isNaN(duration)) {
        totalDuration += duration;
        count++;
      }
    }
  }
  return { count, totalDuration };
}

/** 格式化文件体积 */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 格式化时长（秒 → 分:秒） */
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "未知";
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
  }
  return `${mins}m ${secs}s`;
}

function VideoCardImpl({ item, index, onScrape, gallery = false }: VideoCardProps): React.JSX.Element {
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

  /**
   * 清理所有预览资源（HLS 实例、请求控制器、定时器）
   */
  const cleanupPreview = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    if (speedMonitorRef.current) {
      clearInterval(speedMonitorRef.current);
      speedMonitorRef.current = null;
    }
    if (eventAbortRef.current) {
      eventAbortRef.current.abort();
      eventAbortRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    setLoading(false);
    setHasError(false);
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      cleanupPreview();
      if (popupCloseTimerRef.current) clearTimeout(popupCloseTimerRef.current);
      if (popupAbortRef.current) popupAbortRef.current.abort();
    };
  }, [cleanupPreview]);

  /**
   * 通过轻量级 /api/preview 端点快速获取 m3u8 URL
   * 使用 AbortController 支持取消，结果缓存到模块级 Map
   */
  const fetchPreviewUrl = useCallback(async (pageUrl: string): Promise<string | null> => {
    const cached = previewUrlCache.get(pageUrl);
    if (cached) return cached;

    // 失败缓存：30 秒内不重复请求同一 URL
    const failExpiry = previewFailCache.get(pageUrl);
    if (failExpiry && Date.now() < failExpiry) return null;

    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Playwright 回退可能较慢，给 25 秒超时
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
    } catch (err) {
      clearTimeout(timeout);
      previewFailCache.set(pageUrl, Date.now() + FAIL_CACHE_TTL);
      return null;
    }
  }, []);

  /**
   * 使用 HLS.js 或原生播放器加载并播放 m3u8 视频
   *
   * 倍速策略：1x 起播 → 缓冲积累后自适应提速至目标倍速 → 缓冲不足时自动降速
   * 避免在零缓冲时直接 8x 播放导致立即卡死的问题。
   *
   * @returns 是否成功开始加载
   */
  const playM3U8 = useCallback(async (m3u8Url: string, pageUrl: string): Promise<boolean> => {
    const video = videoRef.current;
    if (!video) return false;

    setLoading(true);
    setHasError(false);

    let playbackStarted = false;

    const clearLoadingTimeout = (): void => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };

    // 超时保护：8 秒内未开始播放则标记错误
    loadingTimeoutRef.current = setTimeout(() => {
      if (playbackStarted) return;
      setHasError(true);
      setLoading(false);
    }, PREVIEW_TIMEOUT_MS);

    // 清理旧的事件监听器，创建新的 AbortController
    if (eventAbortRef.current) {
      eventAbortRef.current.abort();
    }
    const eventController = new AbortController();
    eventAbortRef.current = eventController;
    const { signal } = eventController;

    /**
     * 根据缓冲区健康度自适应调节播放倍速
     * 缓冲充足时加速到目标倍速，缓冲不足时降速避免卡顿
     */
    const adjustPlaybackRate = (): void => {
      if (!video.buffered.length) return;
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      const bufferAhead = bufferedEnd - video.currentTime;

      let targetRate = 1;
      if (bufferAhead >= 10) targetRate = PREVIEW_PLAYBACK_RATE;
      else if (bufferAhead >= 6) targetRate = 6;
      else if (bufferAhead >= 4) targetRate = 4;
      else if (bufferAhead >= 2) targetRate = 2;

      if (Math.abs(video.playbackRate - targetRate) > 0.1) {
        video.playbackRate = targetRate;
      }
    };

    // 启动倍速自适应监控定时器
    if (speedMonitorRef.current) {
      clearInterval(speedMonitorRef.current);
    }
    speedMonitorRef.current = setInterval(
      adjustPlaybackRate,
      SPEED_MONITOR_INTERVAL_MS
    );

    // 缓冲耗尽时降速到 1x，恢复后由定时器自适应提速
    video.addEventListener(
      "waiting",
      () => {
        video.playbackRate = 1;
      },
      { signal }
    );
    video.addEventListener(
      "playing",
      () => {
        adjustPlaybackRate();
      },
      { signal }
    );

    const startPlayback = (): void => {
      // 以 1x 起播，让缓冲先积累，之后由定时器自适应提速
      video.playbackRate = 1;
      video.play()
        .then(() => {
          playbackStarted = true;
          clearLoadingTimeout();
          setIsPlaying(true);
          setLoading(false);
          // 首次立即尝试提速，后续由定时器持续调节
          setTimeout(adjustPlaybackRate, 300);
        })
        .catch(() => {
          clearLoadingTimeout();
          setHasError(true);
          setLoading(false);
        });
    };

    // 原生 HLS 支持（Safari）— 通过代理加载避免 CDN Referer 拒绝
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = toProxyUrl(m3u8Url, pageUrl);
      startPlayback();
      return true;
    }

    // HLS.js 支持（Chrome/Firefox 等）— 等待 HLS.js 加载完成
    const HlsModule = await waitForHls();
    if (HlsModule && HlsModule.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const hls = new HlsModule(PREVIEW_HLS_CONFIG);
      hlsRef.current = hls;

      // 通过代理加载 m3u8，服务端会添加正确的 Referer 头并改写 TS 分片路径
      hls.loadSource(toProxyUrl(m3u8Url, pageUrl));
      hls.attachMedia(video);

      // manifest 解析完成后以 1x 起播，等待分片缓冲后再提速
      hls.on(HlsModule.Events.MANIFEST_PARSED, () => {
        startPlayback();
      });

      // 分片缓冲完成后尝试提速
      hls.on(HlsModule.Events.FRAG_BUFFERED, () => {
        adjustPlaybackRate();
      });

      hls.on(HlsModule.Events.ERROR, (_event: unknown, data: unknown) => {
        const d = data as { fatal?: boolean };
        if (d.fatal) {
          clearLoadingTimeout();
          setHasError(true);
          setLoading(false);
          setIsPlaying(false);
        }
      });
      return true;
    }

    setHasError(true);
    setLoading(false);
    return false;
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (gallery) return;
    // 防抖：避免鼠标快速滑过时触发预览
    hoverTimerRef.current = setTimeout(async () => {
      const video = videoRef.current;
      if (!video) return;

      let urlToPlay: string | undefined = resolvedUrl || item.m3u8Url;

      if (!urlToPlay && item.pageUrl) {
        setLoading(true);
        urlToPlay = (await fetchPreviewUrl(item.pageUrl)) ?? undefined;
        if (!urlToPlay) {
          // 预览不可用时不显示错误图标，静默保持封面图
          setLoading(false);
          return;
        }
      }

      if (urlToPlay) {
        await playM3U8(urlToPlay, item.pageUrl);
      }
    }, HOVER_DEBOUNCE_MS);
  }, [item.pageUrl, item.m3u8Url, resolvedUrl, fetchPreviewUrl, playM3U8, gallery]);

  const handleMouseLeave = useCallback(() => {
    cleanupPreview();
  }, [cleanupPreview]);

  /**
   * 获取视频详情数据（任务详情 + m3u8 分片信息）
   */
  const fetchPopupData = useCallback(async (): Promise<PopupData> => {
    const data: PopupData = {};

    const fetches: Promise<void>[] = [];

    if (item.taskId) {
      fetches.push(
        fetch(`/api/tasks/${item.taskId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((task) => {
            if (task?.VideoInfo) data.videoInfo = task.VideoInfo;
          })
          .catch(() => {})
      );
    }

    const m3u8Url = resolvedUrl || item.m3u8Url;
    if (m3u8Url) {
      fetches.push(
        fetch(toProxyUrl(m3u8Url, item.pageUrl))
          .then((res) => (res.ok ? res.text() : null))
          .then((text) => {
            if (text) data.segments = parseM3U8(text);
          })
          .catch(() => {})
      );
    }

    await Promise.all(fetches);
    return data;
  }, [item.taskId, item.m3u8Url, item.pageUrl, resolvedUrl]);

  const handleTagButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (popupCloseTimerRef.current) {
      clearTimeout(popupCloseTimerRef.current);
      popupCloseTimerRef.current = null;
    }
    if (showInfoPopup) return;
    setShowInfoPopup(true);
    setPopupLoading(true);
    setPopupData(null);

    if (popupAbortRef.current) popupAbortRef.current.abort();
    const controller = new AbortController();
    popupAbortRef.current = controller;

    fetchPopupData()
      .then((data) => {
        if (!controller.signal.aborted) {
          setPopupData(data);
          setPopupLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPopupLoading(false);
      });
  }, [showInfoPopup, fetchPopupData]);

  const handlePopupMouseEnter = useCallback(() => {
    if (popupCloseTimerRef.current) {
      clearTimeout(popupCloseTimerRef.current);
      popupCloseTimerRef.current = null;
    }
  }, []);

  const handlePopupMouseLeave = useCallback(() => {
    popupCloseTimerRef.current = setTimeout(() => {
      setShowInfoPopup(false);
    }, 200);
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
      style={{ contain: 'content' }}
    >
      <div className="video-card-thumb">
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={`video-card-cover ${isPlaying ? "hidden" : ""}`}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className={`video-card-placeholder ${isPlaying ? "hidden" : ""}`}
          >
            <Film size={32} strokeWidth={1.5} />
          </div>
        )}

        <video
          ref={videoRef}
          muted
          playsInline
          preload="none"
          className={isPlaying ? "visible" : ""}
        />

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
          <button
            className="video-card-scrape-btn"
            onClick={handleScrapeClick}
            title="爬取此视频"
          >
            <Zap size={14} />
            爬取
          </button>
        )}
      </div>

      <div className="video-card-info">
        <div className="video-card-title" title={title}>
          {title}
        </div>
        <div className="video-card-meta">
          <span>#{index + 1}</span>
          {item.date && (
            <>
              <span>·</span>
              <span>{item.date}</span>
            </>
          )}
          {item.status === "downloaded" && item.taskId && (
            <>
              <span>·</span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <Download size={10} />
                任务 #{item.taskId}
              </span>
            </>
          )}
          <span
            className={`video-card-tag-btn ${showInfoPopup ? "active" : ""}`}
            onClick={handleTagButtonClick}
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
          >
            <Tag size={11} />
            标签
          </span>
        </div>

        {showInfoPopup && (
          <div
            className="video-info-popup"
            onMouseEnter={handlePopupMouseEnter}
            onMouseLeave={handlePopupMouseLeave}
          >
            {popupLoading ? (
              <div className="video-info-popup-loading">
                <Loader2 size={16} className="spinner" />
                <span>加载中...</span>
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

/**
 * 视频信息悬浮弹窗内容组件
 *
 */
function VideoInfoPopupContent({
  item,
  data,
}: {
  item: SearchItem;
  data: PopupData | null;
}): React.JSX.Element {
  const vi = data?.videoInfo;
  const segments = data?.segments;

  const hasAnyData = vi || segments;

  if (!hasAnyData) {
    return (
      <div className="video-info-popup-empty">暂无详细数据，请先爬取或下载</div>
    );
  }

  return (
    <>
      <div className="video-info-popup-section">
        <div className="video-info-popup-label">视频数据</div>
        <div className="video-info-popup-grid">
          {vi?.Title && (
            <div className="video-info-popup-field">
              <span className="field-key">标题</span>
              <span className="field-val" title={vi.Title}>{vi.Title}</span>
            </div>
          )}
          {item.date && (
            <div className="video-info-popup-field">
              <span className="field-key">日期</span>
              <span className="field-val">{item.date}</span>
            </div>
          )}
          {vi?.Resolution && (
            <div className="video-info-popup-field">
              <span className="field-key">分辨率</span>
              <span className="field-val">{vi.Resolution}</span>
            </div>
          )}
          {vi?.Duration && vi.Duration > 0 ? (
            <div className="video-info-popup-field">
              <span className="field-key">时长</span>
              <span className="field-val">{formatDuration(vi.Duration * 60)}</span>
            </div>
          ) : segments && (
            <div className="video-info-popup-field">
              <span className="field-key">时长</span>
              <span className="field-val">{formatDuration(segments.totalDuration)}</span>
            </div>
          )}
          <div className="video-info-popup-field">
            <span className="field-key">状态</span>
            <span className="field-val">{STATUS_LABELS[item.status] || item.status}</span>
          </div>
        </div>
      </div>

      {vi?.Categories && vi.Categories.length > 0 && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">分类</div>
          <div className="video-info-popup-chips">
            {vi.Categories.map((c, i) => (
              <span key={i} className="chip chip-category">{c}</span>
            ))}
          </div>
        </div>
      )}

      {vi?.Tags && vi.Tags.length > 0 && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">标签</div>
          <div className="video-info-popup-chips">
            {vi.Tags.map((t, i) => (
              <span key={i} className="chip chip-tag">{t}</span>
            ))}
          </div>
        </div>
      )}

      {vi?.Actors && vi.Actors.length > 0 && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">演员</div>
          <div className="video-info-popup-chips">
            {vi.Actors.map((a, i) => (
              <span key={i} className="chip chip-actor">{a}</span>
            ))}
          </div>
        </div>
      )}

      {vi?.Director && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">导演/系列</div>
          <div className="video-info-popup-field">
            <span className="field-val">{vi.Director}</span>
          </div>
        </div>
      )}

      {segments && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">分片数据</div>
          <div className="video-info-popup-grid">
            <div className="video-info-popup-field">
              <span className="field-key">分片数</span>
              <span className="field-val">{segments.count}</span>
            </div>
            <div className="video-info-popup-field">
              <span className="field-key">总时长</span>
              <span className="field-val">{formatDuration(segments.totalDuration)}</span>
            </div>
            {segments.count > 0 && (
              <div className="video-info-popup-field">
                <span className="field-key">均片长</span>
                <span className="field-val">{(segments.totalDuration / segments.count).toFixed(1)}s</span>
              </div>
            )}
          </div>
        </div>
      )}

      {(vi?.FileSize || (segments && vi?.Duration)) && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">体积数据</div>
          <div className="video-info-popup-grid">
            {vi?.FileSize && vi.FileSize > 0 ? (
              <div className="video-info-popup-field">
                <span className="field-key">文件大小</span>
                <span className="field-val">{formatSize(vi.FileSize)}</span>
              </div>
            ) : segments && segments.count > 0 ? (
              <div className="video-info-popup-field">
                <span className="field-key">预估大小</span>
                <span className="field-val">需下载后计算</span>
              </div>
            ) : null}
            {segments && segments.totalDuration > 0 && vi?.FileSize && vi.FileSize > 0 && (
              <div className="video-info-popup-field">
                <span className="field-key">码率</span>
                <span className="field-val">
                  {((vi.FileSize * 8) / segments.totalDuration / 1000).toFixed(0)} kbps
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
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

function StatusBadge({
  status,
  taskId,
}: {
  status: string;
  taskId?: number;
}): React.JSX.Element {
  if (status === "downloaded") {
    return (
      <span className="badge badge-success" style={{ fontSize: 11 }}>
        <CheckCircle2 size={11} style={{ display: "inline", marginRight: 3 }} />
        已下载
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="badge badge-danger" style={{ fontSize: 11 }}>
        <XCircle size={11} style={{ display: "inline", marginRight: 3 }} />
        失败
      </span>
    );
  }
  if (status === "scraping") {
    return (
      <span className="badge badge-info" style={{ fontSize: 11 }}>
        <Loader2
          size={11}
          className="spinner spinner-sm"
          style={{ display: "inline", marginRight: 3 }}
        />
        爬取中
      </span>
    );
  }
  return (
    <span className="badge badge-default" style={{ fontSize: 11 }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}
