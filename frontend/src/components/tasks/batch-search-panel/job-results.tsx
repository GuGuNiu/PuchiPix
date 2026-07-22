import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Copy,
  RefreshCw,
} from "lucide-react";
import type { BatchSearchJob, BatchTitleResult } from "@/types";
import { useI18n } from "@/lib/i18n";
import { StatCard, FilterPill } from "./components";
import { RESULT_STATUS_KEYS, RESULT_STATUS_CLASS } from "./constants";

interface JobResultsProps {
  job: BatchSearchJob;
  isRunning: boolean;
  progressPct: number;
  filter: "all" | "not_found" | "failed";
  filteredResults: BatchTitleResult[];
  showLogs: boolean;
  copied: boolean;
  onFilterChange: (filter: "all" | "not_found" | "failed") => void;
  onToggleLogs: () => void;
  onCopyNotFound: () => void;
  onRetry: () => void;
}

export function JobResults({
  job,
  isRunning,
  progressPct,
  filter,
  filteredResults,
  showLogs,
  copied,
  onFilterChange,
  onToggleLogs,
  onCopyNotFound,
  onRetry,
}: JobResultsProps): React.JSX.Element {
  const { t } = useI18n();

  return (
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
              {t("batchSearch.progress")}{job.totalProcessed} / {job.titles.length}
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
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
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
          <button className="btn btn-outline btn-sm" onClick={onCopyNotFound}>
            {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
            {copied ? t("common.copied") : t("batchSearch.copyNotFound")}
          </button>
          <button className="btn btn-outline btn-sm" onClick={onRetry}>
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
          onClick={() => onFilterChange("all")}
          label={`${t("batchSearch.all")} (${job.results.length})`}
        />
        <FilterPill
          active={filter === "not_found"}
          onClick={() => onFilterChange("not_found")}
          label={`${t("batchSearch.notFound")} (${job.totalNotFound})`}
        />
        <FilterPill
          active={filter === "failed"}
          onClick={() => onFilterChange("failed")}
          label={`${t("batchSearch.failed")} (${job.totalFailed})`}
        />
        <button
          className="btn btn-outline btn-sm"
          onClick={onToggleLogs}
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
                        ? t("batchSearch.candidates", { count: r.searchResults.length })
                        : "—")}
                  </td>
                  <td
                    style={{
                      fontFamily: "monospace",
                      fontSize: 12,
                      color:
                        r.matchScore !== undefined && r.matchScore >= 0.6
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
  );
}
