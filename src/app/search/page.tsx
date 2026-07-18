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
import { useI18n } from "@/lib/i18n";
import { useRouteState } from "@/lib/core/infra/route-state";
import { useUrlState } from "@/hooks/use-url-state";
import { ENABLED_SITE_MODULES, getSiteModule, getSiteModuleByUrl } from "@/lib/sites/site-modules";

const SITES = ENABLED_SITE_MODULES
  .filter((m) => m.id !== 'universal')
  .map((m) => ({
    ...m,
    name: m.nameCn,
    gallery: m.type === 'photo',
  }));

/** 检测输入是否为 URL */
function isUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim());
}

export default function SearchPage(): React.JSX.Element {
  const { t } = useI18n();
  const pathname = usePathname();
  useRouteState(pathname, {
    ttl: 10 * 60 * 1000,
    saveScroll: true,
  });

  const { values: urlValues, update: updateUrl } = useUrlState({
    q: "",
    site: "kanav",
    job: "",
  });

  const [keywords, setKeywords] = useState(urlValues.q);
  const [submitting, setSubmitting] = useState(false);
  const selectedSiteId = urlValues.site;
  const activeJobId = urlValues.job || null;
  const [job, setJob] = useState<SearchJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<SearchJob[]>([]);
  const [scrapingAll, setScrapingAll] = useState(false);

  // URL 变化时同步 keywords 到本地（处理浏览器前进/后退）
  useEffect(() => {
    setKeywords(urlValues.q);
  }, [urlValues.q]);

  const setSelectedSiteId = useCallback(
    (v: string) => updateUrl({ site: v === "kanav" ? null : v }),
    [updateUrl]
  );

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
    const run = async (): Promise<void> => {
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

  const handleSubmit = async (): Promise<void> => {
    const raw = keywords.trim();
    if (!raw) {
      toast.error(t("search.pleaseInputKeyword"));
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
      updateUrl({ q: keywords || null, job: data.id });
      setJob(data);
      toast.success(
        isUrl(raw)
          ? t("search.parsingUrl")
          : t("search.searchStarted", { count: data.keywords.length })
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/search/${activeJobId}`, { method: "DELETE" });
      toast.success(t("search.searchCancelled"));
    } catch {
      toast.error(t("search.cancelFailed"));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleScrapeAll = async (): Promise<void> => {
    if (!activeJobId) return;
    const pendingCount = allItems.filter((i) => i.status === "pending").length;
    if (pendingCount === 0) {
      toast.info(t("search.noPendingVideos"));
      return;
    }
    setScrapingAll(true);
    toast.success(t("search.startBatchScrape", { count: pendingCount }));
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
      toast.info(t("search.startScrapeOne", { title: item.title || item.pageUrl }));
      try {
        const res = await fetch("/api/search/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: activeJobId, pageUrl: item.pageUrl }),
        });
        if (!res.ok) throw new Error(await res.text());
        const updated: SearchItem = await res.json();
        if (updated.status === "failed") {
          toast.error(t("search.scrapeFailed", { error: updated.error || "" }));
        } else {
          toast.success(t("search.scrapeSuccess", { title: updated.title }));
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

  const isGalleryMode = useMemo(() => {
    if (selectedSite?.gallery) return true;

    if (job?.siteId) {
      const jobSite = SITES.find((s) => s.id === job.siteId);
      if (jobSite?.gallery) return true;
    }

    if (allItems.length > 0) {
      return allItems.some((item) => {
        const moduleInfo = getSiteModuleByUrl(item.pageUrl);
        return moduleInfo?.type === 'photo';
      });
    }

    return false;
  }, [selectedSite, job, allItems]);

  return (
    <div className="search-page">
      <div className="search-floating-bar">
        <div className="search-bar-top">
          <div className="search-input-wrap">
            <SearchIcon size={16} className="search-input-icon" />
            <input
              type="text"
              placeholder={
                isGalleryMode
                  ? t("search.placeholderGallery")
                  : t("search.placeholderVideo")
              }
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
                  {t("search.searching")}
                </>
              ) : (
                <>
                  <SearchIcon size={14} />
                  {t("search.startSearch")}
                </>
              )}
            </button>
            {isRunning && (
              <button
                className="btn btn-danger"
                onClick={handleCancel}
              >
              <X size={16} />
              {t("common.cancel")}
              </button>
            )}
          </div>
        </div>

        <div className="search-bar-bottom">
          <div className="search-site-pills">
            <span className="site-label">
              <Globe size={12} />
              {t("search.site")}
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
                {jobStatusLabel(job.status, t)} · {t("search.found", { count: job.totalFound })} · {t("search.scraped", { count: job.totalDownloaded })} · {t("search.searchFailed", { count: job.totalFailed })}
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
              {isGalleryMode ? t("search.totalResultsGallery", { count: allItems.length }) : t("search.totalResultsVideo", { count: allItems.length })}
              {!isGalleryMode && ` · ${t("search.hoverPreview")}`}
              {pendingCount > 0 && ` · ${t("search.pendingScrape", { count: pendingCount })}`}
              {scrapingCount > 0 && ` · ${t("search.scraping", { count: scrapingCount })}`}
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
                    {t("search.scrapingAll")}
                  </>
                ) : (
                  <>
                    <Zap size={14} />
                    {t("search.scrapeAll", { count: pendingCount })}
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
                gallery={isGalleryMode}
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
              {t("search.recentSearches")}
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>{t("search.colKeyword")}</th>
                    <th>{t("search.colSite")}</th>
                    <th>{t("search.colStatus")}</th>
                    <th>{t("search.colFound")}</th>
                    <th>{t("search.colDownload")}</th>
                    <th>{t("search.colTime")}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentJobs.map((j) => (
                    <tr
                      key={j.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        updateUrl({ job: j.id });
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
                          {jobStatusLabel(j.status, t)}
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
              {isGalleryMode ? t("search.emptyGallery") : t("search.emptyVideo")}
            </div>
            <div style={{ fontSize: 13 }}>
              {selectedSite
                ? isGalleryMode
                  ? t("search.currentSiteGallery", { name: selectedSite.name, url: selectedSite.baseUrl })
                  : t("search.currentSiteVideo", { name: selectedSite.name, url: selectedSite.baseUrl })
                : t("search.resultsAsCards")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function jobStatusLabel(status: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const map: Record<string, string> = {
    pending: t("search.statusPending"),
    running: t("search.statusRunning"),
    completed: t("search.statusCompleted"),
    failed: t("search.statusFailed"),
    cancelled: t("search.statusCancelled"),
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
