"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/i18n/toast";
import { useI18n } from "@/lib/i18n";
import { FilePlus } from "lucide-react";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateTaskDialog({ onClose, onCreated }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("mp4");
  const [autoStart, setAutoStart] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error(t("createTask.pleaseFillLink"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), format, auto_start: autoStart }),
      });

      if (res.status === 409) {
        const data = await res.json();
        const matchTypeText: Record<string, string> = {
          exact: t("createTask.exactMatch"),
          mirror: t("createTask.mirrorMatch"),
          path: t("createTask.pathMatch"),
        };
        const matchLabel = matchTypeText[data.matchType] || t("createTask.matchFallback");
        const idLabel = data.type === 'gallery'
          ? t("createTask.galleryLabel", { id: data.galleryId })
          : t("createTask.taskLabel", { id: data.taskId });

        toast.warning(
          t("createTask.duplicateRecord", {
            matchLabel,
            idLabel,
            status: data.existingStatus || t("createTask.unknownStatus"),
            urlInfo: data.existingUrl ? t("createTask.existingUrl", { url: data.existingUrl }) : '',
          }),
          { duration: 8000 },
        );
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || t("createTask.createFailed"));
      }
      toast.success(t("createTask.created"));
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
            {t("createTask.title")}
          </h2>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label={t("createTask.close")}
          >
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>{t("createTask.videoLinkLabel")}</label>
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
                {t("createTask.linkHint")}
              </p>
            </div>
            <div className="form-group">
              <label>{t("createTask.outputFormatLabel")}</label>
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
                  {t("createTask.autoStart")}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    marginTop: 2,
                    lineHeight: "16px",
                  }}
                >
                  {t("createTask.autoStartHint")}
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
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? t("createTask.creating") : t("createTask.createTask")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
