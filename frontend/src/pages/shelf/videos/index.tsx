import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "@/lib/i18n/toast";
import {
  RefreshCw,
  Inbox,
  Search as SearchIcon,
  Video,
} from "lucide-react";
import { useGalleryStore } from "@/store/gallery-store";
import { useI18n } from "@/lib/i18n";
import { useRouteState } from "@/lib/core/infra/route-state";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import GlassSelect from "@/components/ui/glass-select";
import {
  VIDEO_FILTER_PILLS,
  VIDEO_SORT_OPTIONS,
  type VideoStatusFilter,
  type VideoSortBy,
} from "./video-helpers";
import { VideoGrid } from "./_components/video-grid";
import { GalleryDetailPanel } from "../photos/_components/gallery-detail-panel";

export default function VideosPage(): React.JSX.Element {
  const { t } = useI18n();
  const galleries = useGalleryStore((s) => s.galleries);
  const listLoading = useGalleryStore((s) => s.loading);
  const fetchGalleries = useGalleryStore((s) => s.fetchGalleries);
  const deleteGallery = useGalleryStore((s) => s.deleteGallery);
  const retryDownload = useGalleryStore((s) => s.retryDownload);
  const downloadZip = useGalleryStore((s) => s.downloadZip);
  const fetchGalleryDetail = useGalleryStore((s) => s.fetchGalleryDetail);
  const subscribeToSocket = useGalleryStore((s) => s.subscribeToSocket);
  const { pathname } = useLocation();
  useRouteState(pathname, {
    ttl: 5 * 60 * 1000,
    saveScroll: true,
    scrollSelector: ".gallery-grid",
  });

  const { values: urlValues, update: updateUrl } = useUrlState({
    status: "all",
    sort: "date_desc",
    id: "",
  });
  const [searchQuery, setSearchQuery] = useDebouncedUrlParam("q", "");

  const statusFilter = urlValues.status as VideoStatusFilter;
  const sortBy = urlValues.sort as VideoSortBy;
  const expandedId = (() => {
    const id = parseInt(urlValues.id, 10);
    return isNaN(id) ? null : id;
  })();

  const setStatusFilter = useCallback(
    (v: VideoStatusFilter) => updateUrl({ status: v === "all" ? null : v }),
    [updateUrl],
  );
  const setSortBy = useCallback(
    (v: VideoSortBy) => updateUrl({ sort: v === "date_desc" ? null : v }),
    [updateUrl],
  );
  const setExpandedId = useCallback(
    (id: number | null) => updateUrl({ id: id != null ? String(id) : null }),
    [updateUrl],
  );

  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchGalleries();
    const unsub = subscribeToSocket();
    return () => unsub();
  }, [fetchGalleries, subscribeToSocket]);

  const videoOnlyGalleries = useMemo(() => {
    return galleries.filter((g) => g.VideoCount > 0 && g.ImageCount === 0);
  }, [galleries]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: videoOnlyGalleries.length };
    for (const g of videoOnlyGalleries) {
      const s = g.Status;
      counts[s] = (counts[s] || 0) + 1;
      if (s === "partial") {
        counts["completed"] = (counts["completed"] || 0) + 1;
      }
      if (s === "download_pending") {
        counts["downloading"] = (counts["downloading"] || 0) + 1;
      }
    }
    return counts;
  }, [videoOnlyGalleries]);

  const filteredGalleries = useMemo(() => {
    let result = videoOnlyGalleries;

    if (statusFilter !== "all") {
      if (statusFilter === "completed") {
        result = result.filter((g) => g.Status === "completed" || g.Status === "partial");
      } else if (statusFilter === "failed") {
        result = result.filter((g) => g.Status === "failed");
      } else if (statusFilter === "downloading") {
        result = result.filter((g) => g.Status === "downloading" || g.Status === "scraping" || g.Status === "download_pending");
      } else {
        result = result.filter((g) => g.Status === statusFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (g) =>
          (g.Title || "").toLowerCase().includes(q) ||
          (g.Protagonist || "").toLowerCase().includes(q) ||
          (g.Description || "").toLowerCase().includes(q) ||
          g.SourceURL.toLowerCase().includes(q),
      );
    }

    const sorted = [...result];
    switch (sortBy) {
      case "date_desc":
        sorted.sort((a, b) => new Date(b.CreatedAt).getTime() - new Date(a.CreatedAt).getTime());
        break;
      case "date_asc":
        sorted.sort((a, b) => new Date(a.CreatedAt).getTime() - new Date(b.CreatedAt).getTime());
        break;
      case "videos_desc":
        sorted.sort((a, b) => b.VideoCount - a.VideoCount);
        break;
      case "size_desc":
        sorted.sort((a, b) => b.TotalSize - a.TotalSize);
        break;
    }

    return sorted;
  }, [videoOnlyGalleries, statusFilter, searchQuery, sortBy]);

  const handleExpand = useCallback(
    (id: number) => {
      setExpandedId(expandedId === id ? null : id);
    },
    [expandedId, setExpandedId],
  );

  useEffect(() => {
    if (expandedId === null) return;
    let cancelled = false;
    setDetailLoading(true);
    fetchGalleryDetail(expandedId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          setExpandedId(null);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId, fetchGalleryDetail, setExpandedId]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm(t("video.confirmDelete", { id }))) return;
      const ok = await deleteGallery(id);
      if (ok) {
        toast.success("video.deleted", { id });
        if (expandedId === id) setExpandedId(null);
      } else {
        toast.error("video.deleteFailed");
      }
    },
    [deleteGallery, expandedId, setExpandedId, t],
  );

  const handleRetry = useCallback(
    async (id: number) => {
      const ok = await retryDownload(id);
      if (ok) toast.success("video.retryStarted", { id });
      else toast.error("video.retryFailed");
    },
    [retryDownload],
  );

  const expandedGallery = useMemo(
    () => (expandedId === null ? null : galleries.find((g) => g.ID === expandedId) ?? null),
    [galleries, expandedId],
  );

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
            <button className="btn btn-outline btn-sm" onClick={() => fetchGalleries()}>
              <RefreshCw size={14} />
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {listLoading && galleries.length === 0 ? (
          <div className="loading-container">
            <div className="spinner" />
          </div>
        ) : filteredGalleries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Inbox size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">
              {videoOnlyGalleries.length === 0 ? t("video.noVideos") : t("video.noMatchingVideos")}
            </div>
            <div className="empty-state-subtext">
              {videoOnlyGalleries.length === 0
                ? t("video.emptyHintNew")
                : t("video.emptyHintFilter")}
            </div>
          </div>
        ) : (
          <VideoGrid
            items={filteredGalleries}
            expandedId={expandedId}
            onExpand={handleExpand}
          />
        )}
      </div>

      {expandedGallery && (
        <GalleryDetailPanel
          gallery={expandedGallery}
          loading={detailLoading}
          onClose={() => setExpandedId(null)}
          onDelete={handleDelete}
          onRetry={handleRetry}
          onDownloadZip={downloadZip}
        />
      )}
    </div>
  );
}
