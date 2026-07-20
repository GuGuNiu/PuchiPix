"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { toast } from "@/lib/i18n/toast";
import {
  Search,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Globe,
} from "lucide-react";
import type { BatchSearchJob, BatchTitleResult } from "@/types";
import GlassSelect from "@/components/ui/glass-select";
import { useI18n } from "@/lib/i18n";
import { getSites, getSiteOptions } from "./constants";
import { JobResults } from "./job-results";

interface Props {
  onJobCompleted: () => void;
  embedded?: boolean;
}

export default function BatchSearchPanel({
  onJobCompleted,
  embedded = false,
}: Props): React.JSX.Element {
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

  const pollJob = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/search/${id}?type=batch`);
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
                t("batchSearch.complete", { downloaded: data.totalDownloaded, notFound: data.totalNotFound, failed: data.totalFailed }),
              );
            }
          }
          return false;
        }
        return true;
      } catch {
        return true;
      }
    },
    [onJobCompleted],
  );

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
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "batch", titles: raw, siteId: selectedSiteId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data: BatchSearchJob = await res.json();
      setActiveJobId(data.id);
      setJob(data);
      toast.success(t("batchSearch.started", { count: titles.length }));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/search/${activeJobId}?type=batch`, { method: "DELETE" });
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
      toast.success(t("batchSearch.copied", { count: notFoundTitles.length }));
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

  const titleCount = titleInput
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;

  if (embedded) {
    return (
      <div>
        {showPanel && (
          <div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>{t("batchSearch.titleLabel")}</label>
              <textarea
                className="form-control"
                placeholder={t("batchSearch.placeholder")}
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
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flex: "1 1 auto",
                  justifyContent: "flex-end",
                }}
              >
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
                {t("batchSearch.inputHint", { count: titleCount })}
              </div>
            )}

            {job && (
              <JobResults
                job={job}
                isRunning={isRunning === true}
                progressPct={progressPct}
                filter={filter}
                filteredResults={filteredResults}
                showLogs={showLogs}
                copied={copied}
                onFilterChange={setFilter}
                onToggleLogs={() => setShowLogs((v) => !v)}
                onCopyNotFound={handleCopyNotFound}
                onRetry={handleRetry}
              />
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
                placeholder={t("batchSearch.placeholder")}
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
                  <Globe
                    size={12}
                    style={{ display: "inline", marginRight: 4 }}
                  />
                  {t("batchSearch.siteLabel")}
                </label>
                <select
                  className="form-control"
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  disabled={submitting}
                  style={{ height: 38 }}
                >
                  {SITES.filter((s) => s.enabled).map((site) => (
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
              {t("batchSearch.inputHint", { count: titleCount })}
            </div>
          )}

          {job && (
            <JobResults
              job={job}
              isRunning={isRunning === true}
              progressPct={progressPct}
              filter={filter}
              filteredResults={filteredResults}
              showLogs={showLogs}
              copied={copied}
              onFilterChange={setFilter}
              onToggleLogs={() => setShowLogs((v) => !v)}
              onCopyNotFound={handleCopyNotFound}
              onRetry={handleRetry}
            />
          )}
        </div>
      )}
    </div>
  );
}
