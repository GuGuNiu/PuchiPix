import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { toast } from "@/lib/i18n/toast";
import {
  RefreshCw,
  Inbox,
  Search as SearchIcon,
  ListChecks,
  CheckSquare,
  Square,
  Play,
  ListVideo,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import { subscribeSseEvent } from "@/lib/sse/shared-sse";
import GlassSelect from "@/components/ui/glass-select";
import {
  VIDEO_FILTER_PILLS,
  VIDEO_SORT_OPTIONS,
  isVideoActivePhase,
  type VideoStatusFilter,
  type VideoSortBy,
  type VideoShelfItem,
} from "./video-helpers";
import { VideoGrid } from "./_components/video-grid";
import { VideoPlayerModal } from "./_components/video-player-modal";
import { useVideoPlaylistStore } from "./playlist-store";

async function fetchVideoShelf(): Promise<VideoShelfItem[]> {
  const res = await fetch("/api/videos");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("Invalid video shelf response");
  }
  return data as VideoShelfItem[];
}

export default function VideosPage(): React.JSX.Element {
  const { t } = useI18n();

  const { values: urlValues, update: updateUrl } = useUrlState({
    status: "all",
    sort: "date_desc",
  });
  const [searchQuery, setSearchQuery] = useDebouncedUrlParam("q", "");

  const statusFilter = urlValues.status as VideoStatusFilter;
  const sortBy = urlValues.sort as VideoSortBy;

  const setStatusFilter = useCallback(
    (v: VideoStatusFilter) => updateUrl({ status: v === "all" ? null : v }),
    [updateUrl],
  );
  const setSortBy = useCallback(
    (v: VideoSortBy) => updateUrl({ sort: v === "date_desc" ? null : v }),
    [updateUrl],
  );

  const [videos, setVideos] = useState<VideoShelfItem[]>([]);
  const [loading, setLoading] = useState(true);

  // The queue lives in the persistent store; the page only tracks modal visibility
  const [playerOpen, setPlayerOpen] = useState(false);
  const addToQueue = useVideoPlaylistStore((s) => s.addToQueue);
  const addManyToQueue = useVideoPlaylistStore((s) => s.addManyToQueue);
  const queueCount = useVideoPlaylistStore((s) => s.queueIds.length);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const items = await fetchVideoShelf();
      setVideos(items);
    } catch {
      toast.error("common.failed");
    } finally {
      refreshInFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    /*
     * Periodic refresh is the fallback; the SSE subscription below carries
     * live status/progress updates.
     */
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    /*
     * Live pipeline updates from the shared /api/tasks/stream: patch the
     * matching shelf item in place so merge/transcode percentages and
     * status transitions show without waiting for the 15s poll. Gallery and
     * sniff payloads carry their own taskType and are ignored. A completed
     * event triggers a full refresh to pick up the new file (duration,
     * size, playable state).
     */
    const patchStatus = (taskId: number, status: string, progress?: number): void => {
      setVideos((prev) => {
        let changed = false;
        const next = prev.map((v) => {
          if (v.ID !== taskId) return v;
          changed = true;
          return {
            ...v,
            Status: status,
            Progress: progress !== undefined ? progress : v.Progress,
          };
        });
        return changed ? next : prev;
      });
    };

    const unsubs = [
      // Malformed frames are ignored; the 15s poll self-heals.
      subscribeSseEvent("task:progress", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as {
            taskId: number;
            taskType?: string;
            progress?: number;
            status?: string;
          };
          if (payload.taskType === "gallery" || payload.taskType === "sniff") return;
          if (!payload.status) return;
          patchStatus(payload.taskId, payload.status, payload.progress);
        } catch {
        }
      }),
      subscribeSseEvent("task:completed", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as { taskId: number; taskType?: string };
          if (payload.taskType === "gallery" || payload.taskType === "sniff") return;
          refresh();
        } catch {
        }
      }),
      subscribeSseEvent("task:failed", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as { taskId: number; taskType?: string };
          if (payload.taskType === "gallery" || payload.taskType === "sniff") return;
          patchStatus(payload.taskId, "failed");
        } catch {
        }
      }),
      subscribeSseEvent("task:cancelled", (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as { taskId: number; taskType?: string };
          if (payload.taskType === "gallery" || payload.taskType === "sniff") return;
          patchStatus(payload.taskId, "cancelled");
        } catch {
        }
      }),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [refresh]);

  useEffect(() => {
    const available = new Set(videos.filter((video) => video.HasFile).map((video) => video.ID));
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((id) => available.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [videos]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: videos.length };
    for (const v of videos) {
      counts[v.Status] = (counts[v.Status] || 0) + 1;
    }
    return counts;
  }, [videos]);

  const filteredVideos = useMemo(() => {
    let result = videos;

    if (statusFilter !== "all") {
      if (statusFilter === "completed") {
        result = result.filter((v) => v.Status === "completed");
      } else if (statusFilter === "downloading") {
        /*
         * The downloading bucket covers the whole active pipeline,
         * mirroring the tasks page grouping.
         */
        result = result.filter((v) => isVideoActivePhase(v.Status));
      } else {
        result = result.filter((v) => v.Status === statusFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (v) =>
          (v.Title || "").toLowerCase().includes(q) ||
          v.DisplayID.toLowerCase().includes(q) ||
          v.SourceURL.toLowerCase().includes(q),
      );
    }

    const sorted = [...result];
    switch (sortBy) {
      case "date_asc":
        sorted.sort((a, b) => new Date(a.CreatedAt).getTime() - new Date(b.CreatedAt).getTime());
        break;
      case "size_desc":
        sorted.sort((a, b) => b.TotalSize - a.TotalSize);
        break;
      case "date_desc":
      default:
        sorted.sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());
        break;
    }

    return sorted;
  }, [videos, statusFilter, searchQuery, sortBy]);

  const handlePlay = useCallback((video: VideoShelfItem) => {
    if (!video.HasFile) return;
    addToQueue(video.ID, true);
    setPlayerOpen(true);
  }, [addToQueue]);

  const openPlayer = useCallback(() => {
    if (queueCount > 0) setPlayerOpen(true);
  }, [queueCount]);

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  }, []);

  const handleToggleSelect = useCallback((video: VideoShelfItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(video.ID)) next.delete(video.ID);
      else next.add(video.ID);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredVideos.filter((v) => v.HasFile).map((v) => v.ID)));
  }, [filteredVideos]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const playableSelectedCount = useMemo(
    () => filteredVideos.filter((video) => selectedIds.has(video.ID) && video.HasFile).length,
    [filteredVideos, selectedIds],
  );

  const playSelected = useCallback(() => {
    const playable = filteredVideos.filter(
      (v) => selectedIds.has(v.ID) && v.HasFile,
    );
    if (playable.length === 0) {
      toast.error("video.noPlayableSelected");
      return;
    }
    addManyToQueue(playable.map((v) => v.ID));
    setPlayerOpen(true);
  }, [filteredVideos, selectedIds, addManyToQueue]);

  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <div className="tasks-toolbar">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {VIDEO_FILTER_PILLS.map((pill) => (
              <button
                key={pill.value}
                className={`pill ${statusFilter === pill.value ? "active" : ""}`}
                onClick={() => setStatusFilter(pill.value)}
                style={{ fontSize: 12 }}
              >
                {t(pill.labelKey)}
                <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 11 }}>
                  {statusCounts[pill.value] || 0}
                </span>
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
            <SearchIcon
              size={14}
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
                pointerEvents: "none",
              }}
            />
            <input
              type="text"
              placeholder={t("video.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "6px 12px 6px 32px",
                fontSize: 13,
                height: 32,
                boxSizing: "border-box",
                background: "var(--bg-inset)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
          </div>

          <div style={{ minWidth: 130 }}>
            <GlassSelect
              options={VIDEO_SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={sortBy}
              onChange={(v) => setSortBy(v as VideoSortBy)}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button
              className={`btn btn-sm ${selectMode ? "btn-primary" : "btn-outline"}`}
              onClick={toggleSelectMode}
              title={t("video.selectModeHint")}
            >
              <ListChecks size={14} />
              {t(selectMode ? "video.exitSelectMode" : "video.selectMode")}
            </button>
            <button
              className="btn btn-outline btn-sm"
              onClick={openPlayer}
              disabled={queueCount === 0}
              title={t("video.openPlayer")}
            >
              <ListVideo size={14} />
              {queueCount > 0 ? `(${queueCount})` : ""}
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => refresh()}>
              <RefreshCw size={14} />
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {selectMode && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-inset)",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {t("video.selectedCount", { count: playableSelectedCount })}
            </span>
            <button className="btn btn-outline btn-sm" onClick={selectAll}>
              <CheckSquare size={14} />
              {t("video.selectAll")}
            </button>
            <button className="btn btn-outline btn-sm" onClick={clearSelection}>
              <Square size={14} />
              {t("video.clearSelection")}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={playSelected}
                disabled={playableSelectedCount === 0}
              style={{ marginLeft: "auto" }}
            >
              <Play size={14} />
               {t("video.playSelected", { count: playableSelectedCount })}
            </button>
          </div>
        )}

        {loading && videos.length === 0 ? (
          <div className="loading-container">
            <div className="spinner" />
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Inbox size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">
              {videos.length === 0 ? t("video.noVideos") : t("video.noMatchingVideos")}
            </div>
            <div className="empty-state-subtext">
              {videos.length === 0 ? t("video.emptyHintNew") : t("video.emptyHintFilter")}
            </div>
          </div>
        ) : (
          <VideoGrid
            items={filteredVideos}
            onPlay={handlePlay}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        )}
      </div>

      {playerOpen && (
        <VideoPlayerModal
          items={videos}
          onClose={() => setPlayerOpen(false)}
        />
      )}
    </div>
  );
}
