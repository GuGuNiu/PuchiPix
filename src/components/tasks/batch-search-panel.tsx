"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
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
import { ENABLED_SITE_MODULES } from "@/lib/sites/site-modules";

const SITES = ENABLED_SITE_MODULES.map((m) => ({
  ...m,
  name: m.nameCn,
  gallery: m.type === 'photo',
}));

interface Props {
  onJobCompleted: () => void;
  embedded?: boolean;
}

const RESULT_STATUS_LABEL: Record<BatchTitleResult["status"], string> = {
  pending: "等待中",
  searching: "搜索中",
  found: "已匹配",
  scraping: "爬取中",
  completed: "已完成",
  not_found: "未找到",
  failed: "失败",
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

export default function BatchSearchPanel({ onJobCompleted, embedded = false }: Props) {
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
              `批量搜索完成：下载 ${data.totalDownloaded}，未找到 ${data.totalNotFound}，失败 ${data.totalFailed}`
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

  const handleSubmit = async () => {
    const raw = titleInput.trim();
    if (!raw) {
      toast.error("请输入视频标题");
      return;
    }
    const titles = raw
      .split(/\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (titles.length === 0) {
      toast.error("未检测到有效标题");
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

  const handleCancel = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`/api/search/batch/${activeJobId}`, { method: "DELETE" });
      toast.success("批量搜索已取消");
    } catch {
      toast.error("取消失败");
    }
  };

  const handleCopyNotFound = () => {
    if (!job) return;
    const notFoundTitles = job.results
      .filter((r) => r.status === "not_found" || r.status === "failed")
      .map((r) => r.title);
    if (notFoundTitles.length === 0) {
      toast.info("没有未找到或失败的标题");
      return;
    }
    navigator.clipboard.writeText(notFoundTitles.join("\n")).then(() => {
      setCopied(true);
      toast.success(`已复制 ${notFoundTitles.length} 个标题到剪贴板`);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleRetry = () => {
    if (!job) return;
    const failedTitles = job.results
      .filter((r) => r.status === "not_found" || r.status === "failed")
      .map((r) => r.title)
      .join("\n");
    if (!failedTitles) {
      toast.info("没有需要重试的标题");
      return;
    }
    setTitleInput(failedTitles);
    setJob(null);
    setActiveJobId(null);
    setSubmitting(false);
    toast.info("已将失败标题填入输入框，可重新搜索");
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
          {/* 输入区域 */}
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
              <label>视频标题列表（每行一个）</label>
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
                  站点
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
                      搜索中...
                    </>
                  ) : (
                    <>
                      <Search size={14} />
                      开始搜索下载
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
                    取消
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 统计提示 */}
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

          {/* 进度和结果 */}
          {job && (
            <div style={{ marginTop: 16 }}>
              {/* 进度条 */}
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

              {/* 统计卡片 */}
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
                  label="已下载"
                  value={job.totalDownloaded}
                  color="var(--success)"
                />
                <StatCard
                  icon={<AlertTriangle size={16} />}
                  label="未找到"
                  value={job.totalNotFound}
                  color="var(--warning)"
                />
                <StatCard
                  icon={<XCircle size={16} />}
                  label="失败"
                  value={job.totalFailed}
                  color="var(--danger)"
                />
                <StatCard
                  icon={<Search size={16} />}
                  label="总计"
                  value={job.titles.length}
                  color="var(--text-secondary)"
                />
              </div>

              {/* 操作按钮 */}
              {!isRunning && (job.totalNotFound > 0 || job.totalFailed > 0) && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleCopyNotFound}
                  >
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    {copied ? "已复制" : "复制失败/未找到标题"}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleRetry}
                  >
                    <RefreshCw size={14} />
                    重试失败标题
                  </button>
                </div>
              )}

              {/* 筛选标签 */}
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
                  label={`失败 (${job.totalFailed})`}
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowLogs((v) => !v)}
                  style={{ marginLeft: "auto" }}
                >
                  {showLogs ? "隐藏日志" : "显示日志"}
                </button>
              </div>

              {/* 日志区域 */}
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

              {/* 结果表格 */}
              {filteredResults.length > 0 && (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>输入标题</th>
                        <th>匹配结果</th>
                        <th style={{ width: 80 }}>分数</th>
                        <th style={{ width: 90 }}>状态</th>
                        <th style={{ width: 60 }}>任务</th>
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
                              {RESULT_STATUS_LABEL[r.status]}
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
        <div className="card-title">批量搜索任务</div>
        <button
          className="btn btn-outline btn-sm"
          onClick={() => setShowPanel((v) => !v)}
        >
          {showPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {showPanel ? "收起" : "搜索任务"}
        </button>
      </div>

      {showPanel && (
        <div style={{ padding: "0 20px 20px" }}>
          {/* 输入区域 */}
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
              <label>视频标题列表（每行一个）</label>
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
                  站点
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
                      搜索中...
                    </>
                  ) : (
                    <>
                      <Search size={14} />
                      开始搜索下载
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
                    取消
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 统计提示 */}
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

          {/* 进度和结果 */}
          {job && (
            <div style={{ marginTop: 16 }}>
              {/* 进度条 */}
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

              {/* 统计卡片 */}
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
                  label="已下载"
                  value={job.totalDownloaded}
                  color="var(--success)"
                />
                <StatCard
                  icon={<AlertTriangle size={16} />}
                  label="未找到"
                  value={job.totalNotFound}
                  color="var(--warning)"
                />
                <StatCard
                  icon={<XCircle size={16} />}
                  label="失败"
                  value={job.totalFailed}
                  color="var(--danger)"
                />
                <StatCard
                  icon={<Search size={16} />}
                  label="总计"
                  value={job.titles.length}
                  color="var(--text-secondary)"
                />
              </div>

              {/* 操作按钮 */}
              {!isRunning && (job.totalNotFound > 0 || job.totalFailed > 0) && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleCopyNotFound}
                  >
                    {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    {copied ? "已复制" : "复制失败/未找到标题"}
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={handleRetry}
                  >
                    <RefreshCw size={14} />
                    重试失败标题
                  </button>
                </div>
              )}

              {/* 筛选标签 */}
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
                  label={`失败 (${job.totalFailed})`}
                />
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setShowLogs((v) => !v)}
                  style={{ marginLeft: "auto" }}
                >
                  {showLogs ? "隐藏日志" : "显示日志"}
                </button>
              </div>

              {/* 日志区域 */}
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

              {/* 结果表格 */}
              {filteredResults.length > 0 && (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>输入标题</th>
                        <th>匹配结果</th>
                        <th style={{ width: 80 }}>分数</th>
                        <th style={{ width: 90 }}>状态</th>
                        <th style={{ width: 60 }}>任务</th>
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
                              {RESULT_STATUS_LABEL[r.status]}
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
}) {
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
}) {
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
