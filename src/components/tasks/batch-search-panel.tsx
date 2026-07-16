"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { toast } from "@/lib/i18n/toast";
import {
  Search,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Globe,
} from "lucide-react";
import type { BatchSearchJob, BatchTitleResult } from "@/types";
import { ENABLED_SITE_MODULES, getSiteModuleName } from "@/lib/sites/site-modules";
import type { SiteModuleConfig } from "@/lib/sites/site-modules";
import GlassSelect from "@/components/ui/glass-select";
import { useI18n } from "@/lib/i18n";

type SiteOption = SiteModuleConfig & { name: string; gallery: boolean };

const getSites = (locale: string): SiteOption[] => ENABLED_SITE_MODULES.map((m) => ({
  ...m,
  name: getSiteModuleName(m, locale),
  gallery: m.type === 'photo',
}));

const getSiteOptions = (locale: string): { value: string; label: string }[] => getSites(locale)
  .filter((s) => s.enabled && s.id !== 'universal')
  .map((site) => ({ value: site.id, label: site.name }));

interface Props {
  onJobCompleted: () => void;
  embedded?: boolean;
}

const RESULT_STATUS_KEYS = {
  pending: "batchSearch.statusPending",
  searching: "batchSearch.statusSearching",
  found: "batchSearch.statusFound",
  scraping: "batchSearch.statusScraping",
  completed: "batchSearch.statusCompleted",
  not_found: "batchSearch.statusNotFound",
  failed: "batchSearch.statusFailed",
};

const RESULT_STATUS_CLASS: Record<BatchTitleResult["status"], string> = {
  pending: "badge-default",
  searching: "badge-info",
  found: "badge-info",
  scraping: "badge-info",
  completed: "badge-success",
  not_found: "badge-warning",
  failed: "badge-danger",
};

export default function BatchSearchPanel({ onJobCompleted, embedded = false }: Props): React.JSX.Element {
  const { t, locale } = useI18n();
  const SITES = useMemo(() => getSites(locale), [locale]);
  const SITE_OPTIONS = useMemo(() => getSiteOptions(locale), [locale]);
  const [showPanel, setShowPanel] = useState(true);
  const [titleInput, setTitleInput] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("kanav");
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<BatchSearchJob | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "not_found" | "failed">("all");
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const completedRef = useRef(false);

  const pollJob = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/search/batch/${id}`);
      if (!res.ok) return false;
      const data: BatchSearchJob = await res.json();
      setJob(data);
      if (
        data.status === "completed" ||
        data.status === "failed" ||
        data.status === "cancelled"
      ) {
        if (!completedRef.current) {
          completedRef.current = true;
          setSubmitting(false);
          onJobCompleted();
          if (data.status === "completed") {
            toast.success(
              `批量搜索完成：下载 ${data.totalDownloaded}，未找到 ${data.totalNotFound}，{t("batchSearch.failed")} ${data.totalFailed}`
            );
          }
        }
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }, [onJobCompleted]);

  useEffect(() => {
    if (!activeJobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    completedRef.current = false;
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

  const handleSubmit = async (): Promise<void> => {
    const raw = titleInput.trim();
    if (!raw) {
      toast.error("batchSearch.pleaseInputTitle");
      return;
    }
    const titles = raw
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (titles.length === 0) {
      toast.error("batchSearch.noValidTitle");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/search/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titles: raw, siteId: selectedSiteId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: BatchSearchJob = await res.json();
      setActiveJobId(data.id);
      setJob(data);
      toast.success(`批量搜索已启动，共 ${titles.length} 个标题`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/search/batch/${activeJobId}`, { method: "DELETE" });
      toast.success("batchSearch.cancelled");
    } catch {
      toast.error("batchSearch.cancelFailed");
    }
  };

  const handleCopyNotFound = (): void => {
    if (!job) return;
    const notFoundTitles = job.results
      .filter((r) => r.status === "not_found" || r.status === "failed")
      .map((r) => r.title);
    if (notFoundTitles.length === 0) {
      toast.info("batchSearch.noNotFound");
      return;
    }
    navigator.clipboard.writeText(notFoundTitles.join("\n")).then(() => {
      setCopied(true);
      toast.success(`已复制 ${notFoundTitles.length} 个标题到剪贴板`);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRetry = (): void => {
    if (!job) return;
    const failedTitles = job.results
      .filter((r) => r.status === "not_found" || r.status === "failed")
      .map((r) => r.title)
      .join("\n");
    if (!failedTitles) {
      toast.info("batchSearch.noRetry");
      return;
    }
    setTitleInput(failedTitles);
    setJob(null);
    setActiveJobId(null);
    setSubmitting(false);
    toast.info("batchSearch.refilled");
  };

  const isRunning = job && (job.status === "running" || job.status === "pending");

  const progressPct =
    job && job.titles.length > 0
      ? (job.totalProcessed / job.titles.length) * 100
      : 0;

  const filteredResults: BatchTitleResult[] = job
    ? filter === "all"
      ? job.results
      : job.results.filter((r) => r.status === filter)
    : [];

  if (embedded) {
    return (
      <div>
        {showPanel && (
          <div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>{t("batchSearch.titleLabel")}</label>
            <textarea
              className="form-control"
              placeholder={
                "粘贴视频标题，每行一个，例如：\n美丽女仆的秘密生活\n天使的诱惑\n调教日记"
              }
              rows={6}
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              disabled={submitting}
              style={{
                fontFamily: "var(--font-mono), ui-monospace, monospace",
                fontSize: 13,
                resize: "vertical",
                width: "100%",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
                flex: "0 0 auto",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Globe size={14} />
                {t("batchSearch.siteLabel")}
              </span>
              <GlassSelect
                options={SITE_OPTIONS}
                value={selectedSiteId}
                onChange={(val) => setSelectedSiteId(val)}
                disabled={submitting}
                style={{ width: 160 }}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flex: "1 1 auto", justifyContent: "flex-end" }}>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={submitting || isRunning === true}
                style={{ height: 40, fontSize: 14, padding: "0 28px" }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spinner spinner-sm" />
                    {t("batchSearch.searching")}
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    {t("batchSearch.startSearch")}
                  </>
                )}
              </button>
              {isRunning && (
                <button
                  className="btn btn-danger"
                  onClick={handleCancel}
                  style={{ height: 40, fontSize: 14, padding: "0 20px" }}
                >
                  <X size={16} />
                  {t("common.cancel")}
                </button>
              )}
            </div>
          </div>

          {titleInput.trim() && !submitting && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              检测到{" "}
              {titleInput
                .split(/\n/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0).length}{" "}
              个标题 · 将自动模糊搜索并下载匹配的视频 · 每个标题间隔 3~5 秒防爬虫
            </div>
          )}

          {job && (
            <div style={{ marginTop: 16 }}>
              {isRunning && (
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}>
                      进度：{job.totalProcessed} / {job.titles.length}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {progressPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="progress-bar" style={{ height: 6 }}>
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.max(progressPct, 2)}%` }}
                    />
                  </div>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <StatCard
                  icon={<CheckCircle2 size={16} />}
                  label={t("batchSearch.downloaded")}
                  value={job.totalDownloaded}
                  color="var(--success)"
                />
                <StatCard
                  icon={<AlertTriangle size={16} />}
                  label={t("batchSearch.notFound")}
                  value={job.totalNotFound}
                  color="var(--warning)"
                />
                <StatCard
                  icon={<XCircle size={16} />}
                  label={t("batchSearch.failed")}
                  value={job.totalFailed}
                  color="var(--danger)"
                />
                <StatCard
                  icon={<Search size={16} />}
                  label={t("batchSearch.total")}
                  value={job.titles.length}
                  color="var(--text-secondary)"
                />
              </div>

              {!isRunning && (job.totalNotFound > 0 || job.totalFailed > 0) && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleCopyNotFound}
                  >
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    {copied ? t("common.copied") : t("batchSearch.copyNotFound")}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleRetry}
                  >
                    <RefreshCw size={14} />
                    {t("batchSearch.retryFailed")}
                  </button>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <FilterPill
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  label={`全部 (${job.results.length})`}
                />
                <FilterPill
                  active={filter === "not_found"}
                  onClick={() => setFilter("not_found")}
                  label={`未找到 (${job.totalNotFound})`}
                />
                <FilterPill
                  active={filter === "failed"}
                  onClick={() => setFilter("failed")}
                  label={`{t("batchSearch.failed")} (${job.totalFailed})`}
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowLogs((v) => !v)}
                  style={{ marginLeft: "auto" }}
                >
                  {showLogs ? t("batchSearch.hideLogs") : t("batchSearch.showLogs")}
                </button>
              </div>

              {showLogs && job.logs.length > 0 && (
                <div
                  style={{
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    padding: 12,
                    marginBottom: 12,
                    maxHeight: 200,
                    overflowY: "auto",
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                    fontSize: 12,
                    lineHeight: "18px",
                  }}
                >
                  {job.logs.slice(-50).map((log, i) => (
                    <div
                      key={i}
                      style={{
                        color:
                          log.level === "error"
                            ? "var(--danger)"
                            : log.level === "warn"
                            ? "var(--warning)"
                            : "var(--text-secondary)",
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ opacity: 0.5 }}>
                        {new Date(log.time).toLocaleTimeString()}
                      </span>{" "}
                      {log.message}
                    </div>
                  ))}
                </div>
              )}

              {filteredResults.length > 0 && (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>{t("batchSearch.colInputTitle")}</th>
                        <th>{t("batchSearch.colMatchResult")}</th>
                        <th style={{ width: 80 }}>{t("batchSearch.colScore")}</th>
                        <th style={{ width: 90 }}>{t("batchSearch.colStatus")}</th>
                        <th style={{ width: 60 }}>{t("batchSearch.colTask")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((r, i) => (
                        <tr key={i}>
                          <td
                            style={{
                              fontFamily: "monospace",
                              color: "var(--text-muted)",
                              fontSize: 12,
                            }}
                          >
                            {i + 1}
                          </td>
                          <td
                            style={{
                              maxWidth: 200,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={r.title}
                          >
                            {r.title}
                          </td>
                          <td
                            style={{
                              maxWidth: 200,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                            title={r.selectedItem?.title || r.error || ""}
                          >
                            {r.selectedItem?.title ||
                              r.error ||
                              (r.searchResults.length > 0
                                ? `${r.searchResults.length} 个候选`
                                : "—")}
                          </td>
                          <td
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              color:
                                r.matchScore !== undefined &&
                                r.matchScore >= 0.6
                                  ? "var(--success)"
                                  : "var(--text-muted)",
                            }}
                          >
                            {r.matchScore !== undefined
                              ? r.matchScore.toFixed(2)
                              : "—"}
                          </td>
                          <td>
                            <span
                              className={`badge ${RESULT_STATUS_CLASS[r.status]}`}
                              style={{ fontSize: 11 }}
                            >
                              {t(RESULT_STATUS_KEYS[r.status])}
                            </span>
                          </td>
                          <td
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {r.taskId ? `#${r.taskId}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-header">
        <div className="card-title">{t("batchSearch.title")}</div>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => setShowPanel((v) => !v)}
        >
          {showPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showPanel ? t("batchSearch.collapse") : t("batchSearch.expand")}
        </button>
      </div>

      {showPanel && (
        <div style={{ padding: "0 20px 20px" }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              marginBottom: 12,
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div className="form-group" style={{ flex: 1, minWidth: 300 }}>
              <label>{t("batchSearch.titleLabel")}</label>
              <textarea
                className="form-control"
                placeholder={
                  "粘贴视频标题，每行一个，例如：\n美丽女仆的秘密生活\n天使的诱惑\n调教日记"
                }
                rows={6}
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                disabled={submitting}
                style={{
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  fontSize: 13,
                  resize: "vertical",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="form-group" style={{ minWidth: 160, margin: 0 }}>
                <label>
                  <Globe size={12} style={{ display: "inline", marginRight: 4 }} />
                  {t("batchSearch.siteLabel")}
                </label>
                <select
                  className="form-control"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  disabled={submitting}
                  style={{ height: 38 }}
                >
                  {SITES
                    .filter((s) => s.enabled)
                    .map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.nameCn}
                      </option>
                    ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={submitting || isRunning === true}
                  style={{ height: 38, fontSize: 13 }}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="spinner spinner-sm" />
                      {t("batchSearch.searching")}
                    </>
                  ) : (
                    <>
                      <Search size={14} />
                      {t("batchSearch.startSearch")}
                    </>
                  )}
                </button>
                {isRunning && (
                  <button
                    className="btn btn-danger"
                    onClick={handleCancel}
                    style={{ height: 38, fontSize: 13 }}
                  >
                    <X size={14} />
                    {t("common.cancel")}
                  </button>
                )}
              </div>
            </div>
          </div>

          {titleInput.trim() && !submitting && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              检测到{" "}
              {titleInput
                .split(/\n/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0).length}{" "}
              个标题 · 将自动模糊搜索并下载匹配的视频 · 每个标题间隔 3~5 秒防爬虫
            </div>
          )}

          {job && (
            <div style={{ marginTop: 16 }}>
              {isRunning && (
                <div style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 6,
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}>
                      进度：{job.totalProcessed} / {job.titles.length}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {progressPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="progress-bar" style={{ height: 6 }}>
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.max(progressPct, 2)}%` }}
                    />
                  </div>
                </div>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <StatCard
                  icon={<CheckCircle2 size={16} />}
                  label={t("batchSearch.downloaded")}
                  value={job.totalDownloaded}
                  color="var(--success)"
                />
                <StatCard
                  icon={<AlertTriangle size={16} />}
                  label={t("batchSearch.notFound")}
                  value={job.totalNotFound}
                  color="var(--warning)"
                />
                <StatCard
                  icon={<XCircle size={16} />}
                  label={t("batchSearch.failed")}
                  value={job.totalFailed}
                  color="var(--danger)"
                />
                <StatCard
                  icon={<Search size={16} />}
                  label={t("batchSearch.total")}
                  value={job.titles.length}
                  color="var(--text-secondary)"
                />
              </div>

              {!isRunning && (job.totalNotFound > 0 || job.totalFailed > 0) && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleCopyNotFound}
                  >
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    {copied ? t("common.copied") : t("batchSearch.copyNotFound")}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleRetry}
                  >
                    <RefreshCw size={14} />
                    {t("batchSearch.retryFailed")}
                  </button>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <FilterPill
                  active={filter === "all"}
                  onClick={() => setFilter("all")}
                  label={`全部 (${job.results.length})`}
                />
                <FilterPill
                  active={filter === "not_found"}
                  onClick={() => setFilter("not_found")}
                  label={`未找到 (${job.totalNotFound})`}
                />
                <FilterPill
                  active={filter === "failed"}
                  onClick={() => setFilter("failed")}
                  label={`{t("batchSearch.failed")} (${job.totalFailed})`}
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowLogs((v) => !v)}
                  style={{ marginLeft: "auto" }}
                >
                  {showLogs ? t("batchSearch.hideLogs") : t("batchSearch.showLogs")}
                </button>
              </div>

              {showLogs && job.logs.length > 0 && (
                <div
                  style={{
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    padding: 12,
                    marginBottom: 12,
                    maxHeight: 200,
                    overflowY: "auto",
                    fontFamily: "var(--font-mono), ui-monospace, monospace",
                    fontSize: 12,
                    lineHeight: "18px",
                  }}
                >
                  {job.logs.slice(-50).map((log, i) => (
                    <div
                      key={i}
                      style={{
                        color:
                          log.level === "error"
                            ? "var(--danger)"
                            : log.level === "warn"
                            ? "var(--warning)"
                            : "var(--text-secondary)",
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ opacity: 0.5 }}>
                        {new Date(log.time).toLocaleTimeString()}
                      </span>{" "}
                      {log.message}
                    </div>
                  ))}
                </div>
              )}

              {filteredResults.length > 0 && (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>{t("batchSearch.colInputTitle")}</th>
                        <th>{t("batchSearch.colMatchResult")}</th>
                        <th style={{ width: 80 }}>{t("batchSearch.colScore")}</th>
                        <th style={{ width: 90 }}>{t("batchSearch.colStatus")}</th>
                        <th style={{ width: 60 }}>{t("batchSearch.colTask")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((r, i) => (
                        <tr key={i}>
                          <td
                            style={{
                              fontFamily: "monospace",
                              color: "var(--text-muted)",
                              fontSize: 12,
                            }}
                          >
                            {i + 1}
                          </td>
                          <td
                            style={{
                              maxWidth: 200,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={r.title}
                          >
                            {r.title}
                          </td>
                          <td
                            style={{
                              maxWidth: 200,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                            title={r.selectedItem?.title || r.error || ""}
                          >
                            {r.selectedItem?.title ||
                              r.error ||
                              (r.searchResults.length > 0
                                ? `${r.searchResults.length} 个候选`
                                : "—")}
                          </td>
                          <td
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              color:
                                r.matchScore !== undefined &&
                                r.matchScore >= 0.6
                                  ? "var(--success)"
                                  : "var(--text-muted)",
                            }}
                          >
                            {r.matchScore !== undefined
                              ? r.matchScore.toFixed(2)
                              : "—"}
                          </td>
                          <td>
                            <span
                              className={`badge ${RESULT_STATUS_CLASS[r.status]}`}
                              style={{ fontSize: 11 }}
                            >
                              {t(RESULT_STATUS_KEYS[r.status])}
                            </span>
                          </td>
                          <td
                            style={{
                              fontFamily: "monospace",
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                          >
                            {r.taskId ? `#${r.taskId}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        background: "var(--bg-inset)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ color, flexShrink: 0 }}>{icon}</div>
      <div>
        <div
          style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: "16px" }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--text-primary)",
            lineHeight: "22px",
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`pill ${active ? "active" : ""}`}
      onClick={onClick}
      style={{ fontSize: 12, padding: "4px 12px" }}
    >
      {label}
    </button>
  );
}
