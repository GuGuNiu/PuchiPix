"use client";

import { useEffect, useState, FormEvent } from "react";
import { toast } from "sonner";
import { FilePlus } from "lucide-react";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateTaskDialog({ onClose, onCreated }: Props) {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("mp4");
  const [autoStart, setAutoStart] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("请填写链接");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), format, auto_start: autoStart }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "创建任务失败");
      }
      toast.success("任务已创建");
      onCreated();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <FilePlus size={18} style={{ marginRight: 8, verticalAlign: "-2px" }} />
            创建下载任务
          </h2>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>视频链接</label>
              <input
                className="form-control"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/video.m3u8"
                required
                autoFocus
              />
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginTop: 6,
                  fontFamily: "var(--font-mono), ui-monospace, monospace",
                  lineHeight: "16px",
                }}
              >
                支持 M3U8 直链或包含视频的网页地址
              </p>
            </div>
            <div className="form-group">
              <label>输出格式</label>
              <div className="format-pills">
                <button
                  type="button"
                  className={`pill ${format === "TS" ? "active" : ""}`}
                  onClick={() => setFormat("TS")}
                >
                  TS
                </button>
                <button
                  type="button"
                  className={`pill ${format === "MP4" ? "active" : ""}`}
                  onClick={() => setFormat("MP4")}
                >
                  MP4
                </button>
              </div>
            </div>
            <div
              className="form-group"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                background: "var(--bg-inset)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                marginBottom: 0,
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    fontSize: "13px",
                    lineHeight: "20px",
                  }}
                >
                  创建后自动开始下载
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginTop: 2,
                    lineHeight: "16px",
                  }}
                >
                  关闭后会进入等待中状态，可在任务列表中手动启动
                </div>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
          <div className="form-actions" style={{ margin: 0, padding: "16px 24px 22px", borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={onClose}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "创建中..." : "创建任务"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
