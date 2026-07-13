"use client";

/**
 * 图包管理页面
 *
 * 功能：
 * - 卡片式展示所有图包（封面、标题、模特、图片/视频数量）
 * - 状态筛选（全部/爬取中/下载中/已完成/失败）
 * - 关键词搜索（标题/模特）
 * - 点击展开详情（图片缩略图网格、视频列表、保存路径）
 * - 重新下载、删除操作
 * - SSE 实时进度更新
 *
 * @date 2026-07-11
 * @lastModified 2026-07-13
 */

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  RefreshCw,
  Trash2,
  RotateCw,
  Inbox,
  Search as SearchIcon,
  X,
  Copy,
  ImageIcon,
  Video,
  Clock,
  HardDrive,
  Calendar,
  Folder,
  Globe,
  Archive,
  Download,
  FileArchive,
  CheckCircle,
  AlertCircle,
  Loader2,
  Link as LinkIcon,
  ArrowLeft,
} from "lucide-react";
import type { GalleryData } from "@/types";
import { useGalleryStore } from "@/store/gallery-store";
import { useRouteState } from "@/lib/core/route-state";
import { useUrlState, useDebouncedUrlParam } from "@/hooks/use-url-state";
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed";
import GlassSelect from "@/components/ui/glass-select";

const GALLERY_STATUS_LABEL: Record<string, string> = {
  scraping: "爬取中",
  completed: "已完成",
  downloading: "下载中",
  partial: "部分完成",
  failed: "失败",
  pending: "等待中",
};

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const GALLERY_STATUS_CLASS: Record<string, string> = {
  scraping: "badge-info",
  completed: "badge-success",
  downloading: "badge-info",
  partial: "badge-warning",
  failed: "badge-danger",
  pending: "badge-default",
};

type StatusFilter = "all" | "scraping" | "downloading" | "completed" | "failed";
type SortBy = "date_desc" | "date_asc" | "images_desc";

const FILTER_PILLS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "scraping", label: "爬取中" },
  { value: "downloading", label: "下载中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
];

const SORT_OPTIONS = [
  { value: "date_desc", label: "最新优先" },
  { value: "date_asc", label: "最早优先" },
  { value: "images_desc", label: "图片最多" },
];

export default function GalleryPage() {
  const { galleries, loading, progressMap, zipProgressMap, zipStatusMap, fetchGalleries, deleteGallery, retryDownload, downloadZip, fetchGalleryDetail, subscribeToSocket } =
    useGalleryStore();
  const pathname = usePathname();
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
        result = result.filter((g) => g.Status === "downloading" || g.Status === "scraping");
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

  // expandedId 变化时自动加载详情（覆盖用户点击和 URL 直接加载两种场景）
  useEffect(() => {
    if (expandedId === null) return;
    setDetailLoading(true);
    fetchGalleryDetail(expandedId).finally(() => setDetailLoading(false));
  }, [expandedId, fetchGalleryDetail]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!confirm(`确认删除图包 #${id}？`)) return;
      const ok = await deleteGallery(id);
      if (ok) {
        toast.success(`已删除图包 #${id}`);
        if (expandedId === id) setExpandedId(null);
      } else {
        toast.error("删除失败");
      }
    },
    [deleteGallery, expandedId, setExpandedId]
  );

  const handleRetry = useCallback(
    async (id: number) => {
      const ok = await retryDownload(id);
      if (ok) toast.success(`图包 #${id} 下载已重新启动`);
      else toast.error("启动下载失败");
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
                {pill.label}
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
              placeholder="搜索标题、模特或链接..."
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
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(v) => setSortBy(v as SortBy)}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button className="btn btn-outline btn-sm" onClick={() => fetchGalleries()}>
              <RefreshCw size={14} />
              刷新
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
              {galleries.length === 0 ? "暂无图包" : "没有匹配的图包"}
            </div>
            <div className="empty-state-subtext">
              {galleries.length === 0
                ? "在任务页面输入写真站地址即可开始爬取"
                : "尝试调整筛选条件或搜索关键词"}
            </div>
          </div>
        ) : (
          <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
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
                      {/* 封面图 */}
                      <div
                        style={{
                          position: "relative",
                          width: "100%",
                          aspectRatio: "4 / 3",
                          background: "var(--bg-inset)",
                          overflow: "hidden",
                        }}
                      >
                        {gallery.CoverURL ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/gallery/${gallery.ID}/cover`}
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
                        {/* 状态角标 */}
                        <span
                          className={`badge ${GALLERY_STATUS_CLASS[gallery.Status] || "badge-default"}`}
                          style={{ position: "absolute", top: 8, right: 8, fontSize: 11 }}
                        >
                          {GALLERY_STATUS_LABEL[gallery.Status] ?? gallery.Status}
                        </span>
                      </div>

                      {/* 信息区 */}
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
                          title={gallery.Title}
                        >
                          {gallery.Title || `图包 #${gallery.ID}`}
                        </div>
                        {gallery.Protagonist && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-secondary)",
                              marginBottom: 8,
                            }}
                          >
                            模特：{gallery.Protagonist}
                          </div>
                        )}
                        {/* 数量徽章 */}
                        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
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
                              {gallery.PageCount}页
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
                        </div>
                        {/* 进度条 */}
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

                    {/* 详情展开面板 */}
                    {isExpanded && (
                      <GalleryDetailPanel
                        gallery={galleries.find((g) => g.ID === gallery.ID) ?? gallery}
                        progress={prog}
                        loading={detailLoading}
                        zipProgress={zipProgressMap[gallery.ID]}
                        zipStatus={zipStatusMap[gallery.ID]}
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

// ============================================================
// 图包详情面板
// ============================================================

interface GalleryDetailPanelProps {
  gallery: GalleryData;
  progress?: { galleryId: number; completed: number; total: number; failed: number };
  loading: boolean;
  zipProgress?: { galleryId: number; downloaded: number; total: number; percent: number };
  zipStatus?: 'idle' | 'downloading' | 'completed' | 'failed' | 'extracting';
  onClose: () => void;
  onDelete: (id: number) => void;
  onRetry: (id: number) => void;
  onDownloadZip: (id: number, manualUrl?: string) => Promise<boolean>;
}

function GalleryDetailPanel({
  gallery,
  progress,
  loading,
  zipProgress,
  zipStatus,
  onClose,
  onDelete,
  onRetry,
  onDownloadZip,
}: GalleryDetailPanelProps) {
  const sidebarCollapsed = useSidebarCollapsed();
  const canRetry = gallery.Status === "failed" || gallery.Status === "partial";
  const images = gallery.Images ?? [];
  const videos = gallery.Videos ?? [];
  const [showManualUrl, setShowManualUrl] = useState(false);
  const [manualUrl, setManualUrl] = useState("");

  const zipInfo = gallery.DownloadInfo;
  const currentZipStatus = zipStatus ?? (zipInfo?.Status === 'completed' ? 'completed' : zipInfo?.Status === 'downloading' ? 'downloading' : zipInfo?.Status === 'failed' ? 'failed' : 'idle');
  const isZipBusy = currentZipStatus === 'downloading' || currentZipStatus === 'extracting';
  const canDownloadZip = zipInfo && zipInfo.DownloadURL && !isZipBusy && currentZipStatus !== 'completed';

  const handleDownloadZip = useCallback(async () => {
    const ok = await onDownloadZip(gallery.ID);
    if (ok) toast.success(`ZIP 下载完成`);
    else toast.error("ZIP 下载失败");
  }, [gallery.ID, onDownloadZip]);

  const handleDownloadZipManual = useCallback(async () => {
    if (!manualUrl.trim()) {
      toast.error("请输入下载链接");
      return;
    }
    const ok = await onDownloadZip(gallery.ID, manualUrl.trim());
    if (ok) toast.success(`ZIP 下载完成`);
    else toast.error("ZIP 下载失败");
    setShowManualUrl(false);
    setManualUrl("");
  }, [gallery.ID, manualUrl, onDownloadZip]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: sidebarCollapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
        right: 0,
        bottom: 0,
        zIndex: 300,
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 顶部导航栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-card)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={onClose}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <ArrowLeft size={16} />
            返回
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
            图包详情 #{gallery.ID}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canRetry && (
            <button
              className="btn btn-outline btn-sm"
              onClick={() => onRetry(gallery.ID)}
              title="重新下载"
            >
              <RotateCw size={14} />
              重新下载
            </button>
          )}
          {true && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => onDelete(gallery.ID)}
              title="删除"
            >
              <Trash2 size={14} />
              删除
            </button>
          )}
        </div>
      </div>

      {/* 可滚动内容区 */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
        {loading ? (
          <div className="loading-container" style={{ padding: 20 }}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            {/* 基本信息 */}
            <div className="task-detail-grid">
              <div className="task-detail-item full-width">
                <span className="task-detail-label">源链接</span>
                <span className="task-detail-value task-detail-value-with-copy">
                  <span className="task-detail-value-text">{gallery.SourceURL}</span>
                  <button
                    className="btn-copy-inline"
                    onClick={() => {
                      navigator.clipboard.writeText(gallery.SourceURL);
                      toast.success("已复制");
                    }}
                    title="复制"
                  >
                    <Copy size={13} />
                  </button>
                </span>
              </div>

              {gallery.Description && (
                <div className="task-detail-item full-width">
                  <span className="task-detail-label">描述</span>
                  <span className="task-detail-value">{gallery.Description}</span>
                </div>
              )}

              {gallery.Tags && gallery.Tags.length > 0 && (
                <div className="task-detail-item full-width">
                  <span className="task-detail-label">标签</span>
                  <span className="task-detail-value">
                    <div className="task-detail-tags">
                      {gallery.Tags.map((tag) => (
                        <span key={tag} className="pill pill-clickable">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </span>
                </div>
              )}

              {gallery.Category && (
                <div className="task-detail-item">
                  <span className="task-detail-label">分类</span>
                  <span className="task-detail-value">{gallery.Category}</span>
                </div>
              )}

              {gallery.PublishTime && (
                <div className="task-detail-item">
                  <span className="task-detail-label">发布时间</span>
                  <span className="task-detail-value">{gallery.PublishTime}</span>
                </div>
              )}

              {gallery.SavePath && (
                <div className="task-detail-item full-width">
                  <span className="task-detail-label">保存路径</span>
                  <span className="task-detail-value task-detail-value-with-copy">
                    <span className="task-detail-value-text">{gallery.SavePath}</span>
                    <button
                      className="btn-copy-inline"
                      onClick={() => {
                        navigator.clipboard.writeText(gallery.SavePath);
                        toast.success("已复制");
                      }}
                      title="复制"
                    >
                      <Copy size={13} />
                    </button>
                  </span>
                </div>
              )}

              {/* 信息栏 */}
              <div className="task-detail-divider" />
              <div className="task-detail-info-bar">
                <div className="info-bar-item">
                  <ImageIcon size={14} className="info-bar-icon" />
                  <span className="info-bar-text">{gallery.ImageCount} 张图片</span>
                </div>
                {gallery.VideoCount > 0 && (
                  <div className="info-bar-item">
                    <Video size={14} className="info-bar-icon" />
                    <span className="info-bar-text">{gallery.VideoCount} 个视频</span>
                  </div>
                )}
                {gallery.PageCount > 1 && (
                  <div className="info-bar-item">
                    <Folder size={14} className="info-bar-icon" />
                    <span className="info-bar-text">{gallery.PageCount} 页</span>
                  </div>
                )}
                {gallery.TotalSize > 0 && (
                  <div className="info-bar-item">
                    <HardDrive size={14} className="info-bar-icon" />
                    <span className="info-bar-text">
                      {formatFileSize(gallery.TotalSize)}
                    </span>
                  </div>
                )}
                {progress && (
                  <div className="info-bar-item">
                    <HardDrive size={14} className="info-bar-icon" />
                    <span className="info-bar-text">
                      {progress.completed}/{progress.total}
                      {progress.failed > 0 && ` (失败 ${progress.failed})`}
                    </span>
                  </div>
                )}
                {gallery.ScrapedDomain && (
                  <div className="info-bar-item">
                    <Globe size={14} className="info-bar-icon" />
                    <span className="info-bar-text">
                      {(() => {
                        try { return new URL(gallery.ScrapedDomain).hostname; } catch { return gallery.ScrapedDomain; }
                      })()}
                    </span>
                  </div>
                )}
                <div className="info-bar-item">
                  <Calendar size={14} className="info-bar-icon" />
                  <span className="info-bar-text">
                    {new Date(gallery.CreatedAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* ZIP 压缩包下载信息 */}
              {zipInfo && (
                <div
                  style={{
                    marginTop: 16,
                    padding: "12px 16px",
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Archive size={14} />
                      ZIP 压缩包
                      {/* 状态指示器 */}
                      {currentZipStatus === 'completed' && (
                        <span style={{ color: "var(--success)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
                          <CheckCircle size={12} />
                          已下载解压
                        </span>
                      )}
                      {currentZipStatus === 'downloading' && (
                        <span style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
                          <Loader2 size={12} className="spin" />
                          下载中
                        </span>
                      )}
                      {currentZipStatus === 'extracting' && (
                        <span style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
                          <Loader2 size={12} className="spin" />
                          解压中
                        </span>
                      )}
                      {currentZipStatus === 'failed' && (
                        <span style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
                          <AlertCircle size={12} />
                          失败
                        </span>
                      )}
                    </span>
                    {/* 下载按钮 */}
                    {canDownloadZip && (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={handleDownloadZip}
                        style={{ fontSize: 12 }}
                      >
                        <Download size={12} />
                        下载并解压
                      </button>
                    )}
                  </div>

                  {/* ZIP 下载进度条 */}
                  {(currentZipStatus === 'downloading' || currentZipStatus === 'extracting') && zipProgress && zipProgress.total > 0 && (
                    <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="progress-bar" style={{ minWidth: 80, flex: 1 }}>
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${zipProgress.percent}%` }}
                        />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {formatFileSize(zipProgress.downloaded)} / {formatFileSize(zipProgress.total)}
                        ({zipProgress.percent}%)
                      </span>
                    </div>
                  )}

                  {/* 元信息网格 */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                      gap: 8,
                      fontSize: 12,
                    }}
                  >
                    {zipInfo.Title && (
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>标题：</span>
                        <span style={{ color: "var(--text-primary)" }}>{zipInfo.Title}</span>
                      </div>
                    )}
                    {zipInfo.FileCount > 0 && (
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>文件数：</span>
                        <span style={{ color: "var(--text-primary)" }}>{zipInfo.FileCount}</span>
                      </div>
                    )}
                    {zipInfo.FileSizeText && (
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>体积：</span>
                        <span style={{ color: "var(--text-primary)" }}>{zipInfo.FileSizeText}</span>
                      </div>
                    )}
                    {zipInfo.ActualSize > 0 && (
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>实际：</span>
                        <span style={{ color: "var(--text-primary)" }}>{formatFileSize(zipInfo.ActualSize)}</span>
                      </div>
                    )}
                    {zipInfo.ImageDimensions && (
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>尺寸：</span>
                        <span style={{ color: "var(--text-primary)" }}>{zipInfo.ImageDimensions}</span>
                      </div>
                    )}
                    {zipInfo.Password && (
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>密码：</span>
                        <span
                          style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono), ui-monospace, monospace", cursor: "pointer" }}
                          onClick={() => {
                            navigator.clipboard.writeText(zipInfo.Password);
                            toast.success("密码已复制");
                          }}
                          title="点击复制"
                        >
                          {zipInfo.Password}
                        </span>
                      </div>
                    )}
                    {zipInfo.Provider && (
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>来源：</span>
                        <span style={{ color: "var(--text-primary)" }}>{zipInfo.Provider}</span>
                      </div>
                    )}
                    {zipInfo.RequiresLogin && (
                      <div>
                        <span style={{ color: "var(--warning)" }}>⚠ 需要登录</span>
                      </div>
                    )}
                  </div>

                  {/* 下载链接 + 复制按钮 */}
                  {zipInfo.DownloadURL && (
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <a
                        href={zipInfo.DownloadURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 12,
                          color: "var(--accent)",
                          textDecoration: "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}
                      >
                        {zipInfo.DownloadURL}
                      </a>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(zipInfo.DownloadURL);
                          toast.success("链接已复制");
                        }}
                        style={{ flexShrink: 0 }}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  )}

                  {/* 已下载文件路径 */}
                  {currentZipStatus === 'completed' && zipInfo.LocalPath && (
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <FileArchive size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
                      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>ZIP：</span>
                      <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {zipInfo.LocalPath}
                      </span>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(zipInfo.LocalPath);
                          toast.success("路径已复制");
                        }}
                        style={{ flexShrink: 0 }}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  )}
                  {currentZipStatus === 'completed' && zipInfo.ExtractedPath && (
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <Folder size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
                      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>解压：</span>
                      <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {zipInfo.ExtractedPath}
                      </span>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => {
                          navigator.clipboard.writeText(zipInfo.ExtractedPath);
                          toast.success("路径已复制");
                        }}
                        style={{ flexShrink: 0 }}
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                  )}

                  {/* 失败时显示重试 + 手动 URL 输入 */}
                  {currentZipStatus === 'failed' && !isZipBusy && (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={handleDownloadZip}
                        style={{ fontSize: 12 }}
                      >
                        <RotateCw size={12} />
                        重试下载
                      </button>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowManualUrl(!showManualUrl)}
                        style={{ fontSize: 12 }}
                      >
                        <LinkIcon size={12} />
                        手动输入链接
                      </button>
                    </div>
                  )}

                  {/* 需要登录时显示手动 URL 输入 */}
                  {zipInfo.RequiresLogin && currentZipStatus !== 'completed' && !isZipBusy && currentZipStatus !== 'failed' && (
                    <div style={{ marginTop: 8 }}>
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={() => setShowManualUrl(!showManualUrl)}
                        style={{ fontSize: 12 }}
                      >
                        <LinkIcon size={12} />
                        手动输入直链
                      </button>
                    </div>
                  )}

                  {/* 手动 URL 输入区 */}
                  {showManualUrl && (
                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <input
                        type="text"
                        placeholder="粘贴 MediaFire / 直链 URL..."
                        value={manualUrl}
                        onChange={(e) => setManualUrl(e.target.value)}
                        style={{
                          flex: 1,
                          padding: "6px 12px",
                          fontSize: 12,
                          height: 32,
                          boxSizing: "border-box",
                          background: "var(--bg-card)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--text-primary)",
                          outline: "none",
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleDownloadZipManual();
                        }}
                      />
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleDownloadZipManual}
                        style={{ flexShrink: 0 }}
                      >
                        <Download size={12} />
                        下载
                      </button>
                      <button
                        className="btn-close"
                        onClick={() => { setShowManualUrl(false); setManualUrl(""); }}
                        style={{ flexShrink: 0 }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 图片缩略图网格 — 全部显示 */}
            {images.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: 8,
                  }}
                >
                  图片列表（{images.length}）
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 10,
                    padding: 4,
                  }}
                >
                  {images.map((img) => (
                    <div
                      key={img.ID}
                      style={{
                        position: "relative",
                        aspectRatio: "3/4",
                        borderRadius: "var(--radius-sm)",
                        overflow: "hidden",
                        background: "var(--bg-inset)",
                        border: "1px solid var(--border)",
                      }}
                      title={`第${img.PageIndex + 1}页 #${img.OrderIndex + 1}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.LocalPath ? `/api/proxy?path=${encodeURIComponent(img.LocalPath)}` : img.URL}
                        alt={`img-${img.OrderIndex + 1}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.opacity = "0.2";
                        }}
                      />
                      {/* 下载状态角标 */}
                      <span
                        style={{
                          position: "absolute",
                          bottom: 2,
                          right: 2,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background:
                            img.Status === "downloaded"
                              ? "var(--success)"
                              : img.Status === "failed"
                              ? "var(--danger)"
                              : "var(--text-muted)",
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 视频列表 */}
            {videos.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: 8,
                  }}
                >
                  视频列表（{videos.length}）
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {videos.map((vid, i) => (
                    <div
                      key={vid.ID}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        background: "var(--bg-inset)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <Video size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: "var(--font-mono), ui-monospace, monospace",
                          color: "var(--text-secondary)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {vid.FileName || `video_${i + 1}`}
                      </span>
                      <span
                        className={`badge ${
                          vid.Status === "completed"
                            ? "badge-success"
                            : vid.Status === "failed"
                            ? "badge-danger"
                            : vid.Status === "downloading"
                            ? "badge-info"
                            : "badge-default"
                        }`}
                        style={{ fontSize: 11 }}
                      >
                        {vid.Status === "completed"
                          ? "已下载"
                          : vid.Status === "failed"
                          ? "失败"
                          : vid.Status === "downloading"
                          ? "下载中"
                          : "等待中"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
