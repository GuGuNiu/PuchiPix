"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
  Search as SearchIcon,
  Loader2,
  X,
  Globe,
  Radar,
  Zap,
} from "lucide-react";
import type { SearchJob, SearchItem } from "@/types";
import VideoCard from "@/components/search/video-card";
import { useRouteState } from "@/lib/core/route-state";
import { ENABLED_SITE_MODULES, getSiteModule } from "@/lib/sites/site-modules";

const SITES = ENABLED_SITE_MODULES.map((m) => ({
  ...m,
  name: m.nameCn,
  gallery: m.type === 'photo',
}));

export default function SearchPage() {
  const pathname = usePathname();
  const { savedData, saveState } = useRouteState(pathname, {
    ttl: 10 * 60 * 1000,
    saveScroll: true,
  });

  const [keywords, setKeywords] = useState(() => (savedData?.keywords as string) ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(
    () => (savedData?.activeJobId as string | null) ?? null
  );
  const [job, setJob] = useState<SearchJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<SearchJob[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState(
    () => (savedData?.selectedSiteId as string) ?? "kanav"
  );
  const [scrapingAll, setScrapingAll] = useState(false);

  // 保存路由状态
  useEffect(() => {
    saveState({ keywords, selectedSiteId, activeJobId });
  }, [keywords, selectedSiteId, activeJobId, saveState]);

  const pollJob = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/search/${id}`);
      if (!res.ok) return;
      const data: SearchJob = await res.json();
      setJob(data);
      if (
        data.status === "completed" ||
        data.status === "failed" ||
        data.status === "cancelled"
      ) {
        setSubmitting(false);
        if (!scrapingAll) return false;
      }
      return true;
    } catch {
      return true;
    }
  }, [scrapingAll]);

  useEffect(() => {
    if (!activeJobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      const shouldContinue = await pollJob(activeJobId);
      if (!stopped && shouldContinue) {
        timer = setTimeout(run, 2000);
      }
    };
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeJobId, pollJob]);

  useEffect(() => {
    fetch("/api/search")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRecentJobs(data.slice(0, 5));
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    const raw = keywords.trim();
    if (!raw) {
      toast.error("请输入搜索关键词");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: raw, siteId: selectedSiteId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: SearchJob = await res.json();
      setActiveJobId(data.id);
      setJob(data);
      toast.success(`搜索已启动，共 ${data.keywords.length} 个关键词`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/search/${activeJobId}`, { method: "DELETE" });
      toast.success("搜索已取消");
    } catch {
      toast.error("取消失败");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleScrapeAll = async () => {
    if (!activeJobId) return;
    const pendingCount = allItems.filter((i) => i.status === "pending").length;
    if (pendingCount === 0) {
      toast.info("没有待爬取的视频");
      return;
    }
    setScrapingAll(true);
    toast.success(`开始批量爬取 ${pendingCount} 个视频`);
    try {
      const res = await fetch("/api/search/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: activeJobId, all: true }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
      setScrapingAll(false);
    }
  };

  const handleScrapeOne = useCallback(
    async (item: SearchItem) => {
      if (!activeJobId) return;
      toast.info(`开始爬取: ${item.title || item.pageUrl}`);
      try {
        const res = await fetch("/api/search/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: activeJobId, pageUrl: item.pageUrl }),
        });
        if (!res.ok) throw new Error(await res.text());
        const updated: SearchItem = await res.json();
        if (updated.status === "failed") {
          toast.error(`爬取失败: ${updated.error || "未知错误"}`);
        } else {
          toast.success(`爬取成功: ${updated.title}`);
        }
        pollJob(activeJobId);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : String(err));
        pollJob(activeJobId);
      }
    },
    [activeJobId, pollJob]
  );

  const isRunning = job && (job.status === "running" || job.status === "pending");

  const progressPct =
    job && job.keywords.length > 0
      ? (job.currentIndex / job.keywords.length) * 100
      : 0;

  const allItems: SearchItem[] = useMemo(
    () => (job ? job.results.flatMap((kw) => kw.items) : []),
    [job]
  );

  const pendingCount = allItems.filter((i) => i.status === "pending").length;
  const scrapingCount = allItems.filter((i) => i.status === "scraping").length;

  const selectedSite = SITES.find((s) => s.id === selectedSiteId);

  return (
    <div className="search-page">
      <div className="search-floating-bar">
        <div className="search-bar-top">
          <div className="search-input-wrap">
            <SearchIcon size={16} className="search-input-icon" />
            <input
              type="text"
              placeholder="输入搜索关键词，支持逗号、空格分隔..."
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isRunning === true}
            />
          </div>
          <div className="search-bar-actions">
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={submitting || isRunning === true}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="spinner spinner-sm" />
                  搜索中...
                </>
              ) : (
                <>
                  <SearchIcon size={14} />
                  搜索
                </>
              )}
            </button>
            {isRunning && (
              <button
                className="btn btn-danger"
                onClick={handleCancel}
              >
                <X size={16} />
                取消
              </button>
            )}
          </div>
        </div>

        <div className="search-bar-bottom">
          <div className="search-site-pills">
            <span className="site-label">
              <Globe size={12} />
              站点
            </span>
            {SITES
              .filter((s) => s.enabled)
              .map((site) => (
                <button
                  key={site.id}
                  type="button"
                  className={`pill ${selectedSiteId === site.id ? "active" : ""}`}
                  onClick={() => setSelectedSiteId(site.id)}
                  disabled={isRunning === true}
                  style={{
                    cursor: isRunning ? "not-allowed" : "pointer",
                    opacity: isRunning && selectedSiteId !== site.id ? 0.5 : 1,
                    ...(selectedSiteId === site.id
                      ? {
                          background: site.badge.gradient,
                          borderColor: site.badge.solidColor,
                          color: site.badge.textColor,
                        }
                      : {}),
                  }}
                  title={site.baseUrl}
                >
                  {site.nameCn}
                </button>
              ))}
          </div>

          {job && (
            <div className="search-job-status">
              <span className="search-status-dot" data-status={job.status} />
              <span>
                {jobStatusLabel(job.status)} · 找到 {job.totalFound} · 已爬取{" "}
                {job.totalDownloaded} · 失败 {job.totalFailed}
              </span>
            </div>
          )}
        </div>

        {job && isRunning && (
          <div className="search-progress-bar">
            <div className="search-progress-bar-info">
              <span>
                {job.currentIndex + 1}/{job.keywords.length} · {Math.round(progressPct)}%
              </span>
              <span className="search-progress-bar-status">
                {job.logs.length > 0 && job.logs[job.logs.length - 1].message}
              </span>
            </div>
            <div className="search-progress-bar-track">
              <div
                className="search-progress-bar-fill"
                style={{ width: `${Math.max(progressPct, 2)}%` }}
              />
            </div>
          </div>
        )}

        {allItems.length > 0 && (
          <div className="search-results-bar">
            <span className="search-results-info">
              共 {allItems.length} 个{selectedSite?.gallery ? "图库" : "视频"}
              {!selectedSite?.gallery && " · 悬浮可 8x 倍速预览"}
              {pendingCount > 0 && ` · 待爬取 ${pendingCount}`}
              {scrapingCount > 0 && ` · 爬取中 ${scrapingCount}`}
            </span>

            {pendingCount > 0 && !isRunning && (
              <button
                className="btn btn-primary search-scrape-all-btn"
                onClick={handleScrapeAll}
                disabled={scrapingAll}
              >
                {scrapingAll ? (
                  <>
                    <Loader2 size={14} className="spinner spinner-sm" />
                    爬取中...
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    一键爬取 ({pendingCount})
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="search-gallery">
        {allItems.length > 0 ? (
          <div className="search-gallery-grid">
            {allItems.map((item, i) => (
              <VideoCard
                key={i}
                item={item}
                index={i}
                onScrape={handleScrapeOne}
                gallery={selectedSite?.gallery ?? false}
              />
            ))}
          </div>
        ) : !job && recentJobs.length > 0 ? (
          <div
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--glass-border)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px 20px",
                borderBottom: "1px solid var(--border-light)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              最近搜索
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>关键词</th>
                    <th>站点</th>
                    <th>状态</th>
                    <th>找到</th>
                    <th>下载</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((j) => (
                    <tr
                      key={j.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        setActiveJobId(j.id);
                        setJob(j);
                      }}
                    >
                      <td
                        style={{
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {j.keywords.join("、")}
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            fontSize: 11,
                            background:
                              getSiteModule(j.siteId)?.badge.gradient ||
                              undefined,
                            color:
                              getSiteModule(j.siteId)?.badge.textColor ||
                              undefined,
                          }}
                        >
                          {getSiteModule(j.siteId)?.nameCn || j.siteId || "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${jobStatusClass(j.status)}`}>
                          {jobStatusLabel(j.status)}
                        </span>
                      </td>
                      <td>{j.totalFound}</td>
                      <td>{j.totalDownloaded}</td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {new Date(j.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="search-gallery-empty">
            <Radar size={48} strokeWidth={1.5} style={{ opacity: 0.3, marginBottom: 16 }} />
            <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
              输入关键词开始搜索
            </div>
            <div style={{ fontSize: 13 }}>
              {selectedSite
                ? `当前站点：${selectedSite.name} · ${selectedSite.baseUrl}`
                : "搜索结果将显示为卡片"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function jobStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "等待中",
    running: "搜索中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return map[status] ?? status;
}

function jobStatusClass(status: string): string {
  const map: Record<string, string> = {
    pending: "badge-default",
    running: "badge-info",
    completed: "badge-success",
    failed: "badge-danger",
    cancelled: "badge-default",
  };
  return map[status] ?? "badge-default";
}
