"use client";

import { useEffect, useState } from "react";
import { toast } from "@/lib/i18n/toast";
import {
  Search,
  Square,
  RefreshCw,
  Plus,
  Link2,
} from "lucide-react";
import { useSniffStore } from "@/store/sniff-store";
import { useI18n } from "@/lib/i18n";
import type { CapturedURL } from "@/types";

export default function SniffPage(): React.JSX.Element {
  const { status, urls, loading, fetchStatus, fetchURLs, startSniff, stopSniff } =
    useSniffStore();
  const { t } = useI18n();
  const [inputUrl, setInputUrl] = useState("");
  const [debugMode] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    fetchURLs();
    if (status?.running) {
      const interval = setInterval(() => {
        fetchURLs();
        fetchStatus();
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [status?.running, fetchURLs, fetchStatus]);

  const handleStart = async (): Promise<void> => {
    if (!inputUrl.trim()) {
      toast.error("sniff.pleaseInputLink");
      return;
    }
    setStarting(true);
    try {
      await startSniff(inputUrl.trim());
      toast.success("sniff.sniffStarted");
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async (): Promise<void> => {
    try {
      await stopSniff();
      toast.success("sniff.sniffStopped");
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleAdd = async (capturedUrl: CapturedURL): Promise<void> => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: capturedUrl.url, format: "mp4" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || t("sniff.createTaskFailed"));
      }
      toast.success("sniff.addedToDownload");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const running = status?.running ?? false;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t("sniff.title")}</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">{t("sniff.control")}</div>
        </div>

        <div className="sniff-control">
          <div className="form-group">
            <label>{t("sniff.targetUrl")}</label>
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="https://example.com/video-page"
              disabled={running}
            />
          </div>
          {running ? (
            <button
              className="btn btn-danger"
              onClick={handleStop}
              disabled={loading}
            >
              {loading ? (
                <span className="spinner spinner-sm" />
              ) : (
                <>
                  <Square size={16} />
                  {t("sniff.stopSniff")}
                </>
              )}
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={starting || loading}
            >
              {starting ? (
                <span className="spinner spinner-sm" />
              ) : (
                <>
                  <Search size={16} />
                  {t("sniff.startSniff")}
                </>
              )}
            </button>
          )}
        </div>

        <div className={`sniff-status-banner ${running ? "active" : ""}`}>
          <span
            className={`status-dot ${running ? "active" : "disconnected"}`}
          />
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {running
              ? t("sniff.sniffRunning", { url: status?.target_url || "—" })
              : t("sniff.snifferIdle")}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">{t("sniff.capturedLinks")}</div>
            <div className="card-subtitle">
              {urls.length > 0
                ? t("sniff.foundStreams", { count: urls.length })
                : t("sniff.notCaptured")}
            </div>
          </div>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              fetchStatus();
              fetchURLs();
            }}
          >
            <RefreshCw size={14} />
            {t("common.refresh")}
          </button>
        </div>

        {urls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Link2 size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">{t("sniff.notCaptured")}</div>
            <div className="empty-state-subtext">
              {t("sniff.startToDiscover")}
            </div>
          </div>
        ) : (
          <div className="sniff-results-list">
            {urls.map((item, i) => (
              <div className="sniff-result-item" key={i}>
                <div className="sniff-result-info">
                  <div className="sniff-result-url" title={item.url}>
                    {item.url}
                  </div>
                  <div className="sniff-result-meta">
                    {item.filename || t("sniff.untitled")}
                    {item.type ? ` | ${item.type}` : ""}
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleAdd(item)}
                >
                  <Plus size={14} />
                  {t("common.addTask")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {debugMode && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div className="card-title">Debug</div>
          </div>
          <pre style={{ padding: 16, fontSize: 12, overflow: "auto" }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
