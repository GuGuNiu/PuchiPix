import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "@/lib/i18n/toast";
import { formatFileSize } from "@/lib/utils";
import {
  RefreshCw,
  Inbox,
  Search as SearchIcon,
  ImageIcon,
  Video,
  HardDrive,
  Calendar,
} from "lucide-react";
import { useGalleryStore } from "@/store/gallery-store";
import { useI18n } from "@/lib/i18n";
import { useRouteState } from "@/lib/core/infra/route-state";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import GlassSelect from "@/components/ui/glass-select";
import {
  GALLERY_STATUS_LABEL,
  GALLERY_STATUS_CLASS,
  FILTER_PILLS,
  SORT_OPTIONS,
  type StatusFilter,
  type SortBy,
  type ZipStatus,
} from "./gallery-helpers";
import { GalleryDetailPanel } from "./_components/gallery-detail-panel";

export default function PhotosPage(): React.JSX.Element {
  const { t } = useI18n();
  const { galleries, loading, progressMap, zipProgressMap, zipStatusMap, fetchGalleries, deleteGallery, retryDownload, downloadZip, fetchGalleryDetail, subscribeToSocket } =
    useGalleryStore();
  const { pathname } = useLocation();
  useRouteState(pathname, {
    ttl: 5 * 60 * 1000,
    saveScroll: true,
  });

  const { values: urlValues, update: updateUrl } = useUrlState({
    status: "all",
    sort: "date_desc",
    id: "",
  });
  const [searchQuery, setSearchQuery] = useDebouncedUrlParam("q", "");

  const statusFilter = urlValues.status as StatusFilter;
  const sortBy = urlValues.sort as SortBy;
  const expandedId = (() => {
    const id = parseInt(urlValues.id, 10);
    return isNaN(id) ? null : id;
  })();

  const setStatusFilter = useCallback(
    (v: StatusFilter) => updateUrl({ status: v === "all" ? null : v }),
    [updateUrl]
  );
  const setSortBy = useCallback(
    (v: SortBy) => updateUrl({ sort: v === "date_desc" ? null : v }),
    [updateUrl]
  );
  const setExpandedId = useCallback(
    (id: number | null) => updateUrl({ id: id != null ? String(id) : null }),
    [updateUrl]
  );

  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchGalleries();
    const unsub = subscribeToSocket();
    return () => unsub();
  }, [fetchGalleries, subscribeToSocket]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: galleries.length };
    for (const g of galleries) {
      const s = g.Status;
      counts[s] = (counts[s] || 0) + 1;
      if (s === "partial") {
        counts["completed"] = (counts["completed"] || 0) + 1;
      }
      // download_pending is a sub-state of the downloading phase;
      // count it under "downloading" so the filter pill reflects the
      // true number of galleries still in progress.
      if (s === "download_pending") {
        counts["downloading"] = (counts["downloading"] || 0) + 1;
      }
    }
    return counts;
  }, [galleries]);

  const filteredGalleries = useMemo(() => {
    let result = galleries;

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
          g.SourceURL.toLowerCase().includes(q)
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
      case "images_desc":
        sorted.sort((a, b) => b.ImageCount - a.ImageCount);
        break;
    }

    return sorted;
  }, [galleries, statusFilter, searchQuery, sortBy]);

  const handleExpand = useCallback(
    (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(id);
    },
    [expandedId, setExpandedId]
  );

  useEffect(() => {
    if (expandedId === null) return;
    let cancelled = false;
    setDetailLoading(true);
    fetchGalleryDetail(expandedId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          /*
           * The id in the URL is invalid (stale link or already deleted):
           * clear the lingering param so future visits do not fire a
           * request that is bound to fail.
           */
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
      if (!confirm(t("gallery.confirmDelete", { id }))) return;
      const ok = await deleteGallery(id);
      if (ok) {
        toast.success("gallery.deleted", { id });
        if (expandedId === id) setExpandedId(null);
      } else {
        toast.error("gallery.deleteFailed");
      }
    },
    [deleteGallery, expandedId, setExpandedId]
  );

  const handleRetry = useCallback(
    async (id: number) => {
      const ok = await retryDownload(id);
      if (ok) toast.success("gallery.retryStarted", { id });
      else toast.error("gallery.retryFailed");
    },
    [retryDownload]
  );

  return (
    <div className="tasks-layout">
      <div className="card tasks-list-card">
        <div className="tasks-toolbar">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTER_PILLS.map((pill) => (
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
              placeholder={t("gallery.searchPlaceholder")}
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
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              value={sortBy}
              onChange={(v) => setSortBy(v as SortBy)}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button className="btn btn-outline btn-sm" onClick={() => fetchGalleries()}>
              <RefreshCw size={14} />
              {t("common.refresh")}
            </button>
          </div>
        </div>

        {loading && galleries.length === 0 ? (
          <div className="loading-container">
            <div className="spinner" />
          </div>
        ) : filteredGalleries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Inbox size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">
              {galleries.length === 0 ? t("gallery.noGalleries") : t("gallery.noMatchingGalleries")}
            </div>
            <div className="empty-state-subtext">
              {galleries.length === 0
                ? t("gallery.emptyHintNew")
                : t("gallery.emptyHintFilter")}
            </div>
          </div>
        ) : (
          <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(288px, 1fr))",
                gap: 16,
                padding: 20,
              }}
            >
              {filteredGalleries.map((gallery) => {
                const prog = progressMap[gallery.ID];
                const progressPct =
                  prog && prog.total > 0
                    ? Math.round((prog.completed / prog.total) * 100)
                    : gallery.Status === "completed"
                    ? 100
                    : 0;
                const isExpanded = expandedId === gallery.ID;
                const fillClass =
                  gallery.Status === "completed"
                    ? "completed"
                    : gallery.Status === "failed"
                    ? "failed"
                    : "";

                return (
                  <Fragment key={gallery.ID}>
                    <div
                      onClick={() => handleExpand(gallery.ID)}
                      style={{
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
                          background: "var(--bg-inset)",
                          overflow: "hidden",
                        }}
                      >
                        {gallery.CoverURL ? (
                          <img
                            src={`/api/shelf/${gallery.ID}?type=cover`}
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
                                img.src = gallery.CoverURL;
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

                      <div style={{ padding: "8px 12px" }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            marginBottom: 2,
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
                            }}
                          >
                            {t("gallery.model")}{gallery.Protagonist}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 4, marginBottom: 4, flexWrap: "wrap" }}>
                          <span
                            className="pill"
                            style={{ fontSize: 11, padding: "2px 8px" }}
                          >
                            <ImageIcon size={11} style={{ marginRight: 3 }} />
                            {gallery.ImageCount}P
                          </span>
                          {gallery.VideoCount > 0 && (
                            <span
                              className="pill"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                            >
                              <Video size={11} style={{ marginRight: 3 }} />
                              {gallery.VideoCount}V
                            </span>
                          )}
                          {gallery.PageCount > 1 && (
                            <span
                              className="pill"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                            >
                              {gallery.PageCount}{t("common.pages")}
                            </span>
                          )}
                          {gallery.PublishTime && (
                            <span
                              className="pill"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                            >
                              <Calendar size={11} style={{ marginRight: 3 }} />
                              {gallery.PublishTime}
                            </span>
                          )}
                          {gallery.TotalSize > 0 && (
                            <span
                              className="pill"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                            >
                              <HardDrive size={11} style={{ marginRight: 3 }} />
                              {formatFileSize(gallery.TotalSize)}
                            </span>
                          )}
                          {gallery.TotalSize <= 0 && gallery.DownloadedSize > 0 && (
                            <span
                              className="pill"
                              style={{ fontSize: 11, padding: "2px 8px" }}
                            >
                              <HardDrive size={11} style={{ marginRight: 3 }} />
                              {formatFileSize(gallery.DownloadedSize)}
                            </span>
                          )}
                        </div>
                        {(gallery.Status === "downloading" || gallery.Status === "scraping") && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="progress-bar" style={{ minWidth: 60, flex: 1 }}>
                              <div
                                className={`progress-bar-fill ${fillClass}`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <span className="progress-text" style={{ fontSize: 11 }}>
                              {prog ? `${prog.completed}/${prog.total}` : `${progressPct}%`}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <GalleryDetailPanel
                        gallery={galleries.find((g) => g.ID === gallery.ID) ?? gallery}
                        progress={prog}
                        loading={detailLoading}
                        zipProgress={zipProgressMap[gallery.ID]}
                        zipStatus={zipStatusMap[gallery.ID] as ZipStatus | undefined}
                        onClose={() => setExpandedId(null)}
                        onDelete={handleDelete}
                        onRetry={handleRetry}
                        onDownloadZip={downloadZip}
                      />
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
