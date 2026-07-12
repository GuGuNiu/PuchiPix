"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Search,
  Square,
  RefreshCw,
  Plus,
  Link2,
} from "lucide-react";
import { useSniffStore } from "@/store/sniff-store";
import type { CapturedURL } from "@/types";

export default function SniffPage() {
  const { status, urls, loading, fetchStatus, fetchURLs, startSniff, stopSniff } =
    useSniffStore();
  const [inputUrl, setInputUrl] = useState("");
  const [debugMode, setDebugMode] = useState(false);
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

  const handleStart = async () => {
    if (!inputUrl.trim()) {
      toast.error("请输入链接");
      return;
    }
    setStarting(true);
    try {
      await startSniff(inputUrl.trim());
      toast.success("嗅探已启动");
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopSniff();
      toast.success("嗅探已停止");
      fetchStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const handleAdd = async (capturedUrl: CapturedURL) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: capturedUrl.url, format: "mp4" }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "创建任务失败");
      }
      toast.success("已添加到下载任务");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const running = status?.running ?? false;

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>嗅探 M3U8 链接</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">嗅探控制</div>
        </div>

        <div className="sniff-control">
          <div className="form-group">
            <label>目标链接</label>
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
                  停止嗅探
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
                  开始嗅探
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
              ? `嗅探运行中... 目标：${status?.target_url || "—"}`
              : "嗅探器空闲"}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <div className="card-title">已捕获的 M3U8 链接</div>
            <div className="card-subtitle">
              {urls.length > 0
                ? `共发现 ${urls.length} 个视频流`
                : "尚未捕获到链接"}
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
            刷新
          </button>
        </div>

        {urls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <Link2 size={48} strokeWidth={1.5} />
            </div>
            <div className="empty-state-text">尚未捕获到链接</div>
            <div className="empty-state-subtext">
              开始嗅探以发现目标页面中的 M3U8 视频流
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
                    {item.filename || "未命名"}
                    {item.type ? ` | ${item.type}` : ""}
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleAdd(item)}
                >
                  <Plus size={14} />
                  下载
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="debug-toggle">
        <div className="checkbox-group">
          <input
            type="checkbox"
            id="debug-mode"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.target.checked)}
          />
          <label htmlFor="debug-mode">浏览器调试模式</label>
        </div>
        <p>启用后，浏览器调试控制台将保持可见，便于排查复杂的网络嗅探问题。</p>
      </div>
    </div>
  );
}
