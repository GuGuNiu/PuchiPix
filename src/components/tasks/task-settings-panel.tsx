"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "@/lib/i18n/toast";
import { useI18n } from "@/lib/i18n";
import {
  X,
  Settings,
  Save,
  Layers,
  Radar,
  RefreshCw,
  Film,
  Image,
  ScanSearch,
} from "lucide-react";

interface TaskSettings {
  maxConcurrentTasks: number;
  maxConcurrentSniffTasks: number;
  maxScrapingTasks: number;
  tsSegmentConcurrent: number;
  galleryImageConcurrent: number;
}

interface TaskSettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function TaskSettingsPanel({
  open,
  onClose,
}: TaskSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [settings, setSettings] = useState<TaskSettings>({
    maxConcurrentTasks: 5,
    maxConcurrentSniffTasks: 1,
    maxScrapingTasks: 5,
    tsSegmentConcurrent: 50,
    galleryImageConcurrent: 5,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/task-settings");
      if (!res.ok) throw new Error(t("taskSettings.loadFailed"));
      const data = await res.json();
      setSettings({
        maxConcurrentTasks: data.maxConcurrentTasks ?? 5,
        maxConcurrentSniffTasks: data.maxConcurrentSniffTasks ?? 1,
        maxScrapingTasks: data.maxScrapingTasks ?? 5,
        tsSegmentConcurrent: data.tsSegmentConcurrent ?? 50,
        galleryImageConcurrent: data.galleryImageConcurrent ?? 5,
      });
      setDirty(false);
    } catch {
      toast.error("taskSettings.loadFailed");
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetchSettings();
    }
  }, [open, fetchSettings]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const res = await fetch("/api/task-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || t("taskSettings.saveFailed"));
      }
      const data = await res.json();
      setSettings({
        maxConcurrentTasks: data.maxConcurrentTasks,
        maxConcurrentSniffTasks: data.maxConcurrentSniffTasks,
        maxScrapingTasks: data.maxScrapingTasks,
        tsSegmentConcurrent: data.tsSegmentConcurrent,
        galleryImageConcurrent: data.galleryImageConcurrent,
      });
      setDirty(false);
      toast.success("taskSettings.saved");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleMaxTasksChange = (value: number): void => {
    const v = Math.max(1, Math.min(50, value));
    setSettings((prev) => ({ ...prev, maxConcurrentTasks: v }));
    setDirty(true);
  };

  const handleMaxSniffChange = (value: number): void => {
    const v = Math.max(1, Math.min(10, value));
    setSettings((prev) => ({ ...prev, maxConcurrentSniffTasks: v }));
    setDirty(true);
  };

  const handleMaxScrapingChange = (value: number): void => {
    const v = Math.max(1, Math.min(50, value));
    setSettings((prev) => ({ ...prev, maxScrapingTasks: v }));
    setDirty(true);
  };

  const handleTsSegmentChange = (value: number): void => {
    const v = Math.max(1, Math.min(200, value));
    setSettings((prev) => ({ ...prev, tsSegmentConcurrent: v }));
    setDirty(true);
  };

  const handleGalleryImageChange = (value: number): void => {
    const v = Math.max(1, Math.min(50, value));
    setSettings((prev) => ({ ...prev, galleryImageConcurrent: v }));
    setDirty(true);
  };

  if (!open) return <></>;

  return (
    <>
      <div
        className="task-settings-overlay"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.35)",
          zIndex: 999,
          animation: "modalFadeIn 0.15s ease",
        }}
      />

      <div
        className="task-settings-panel"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 400,
          maxWidth: "90vw",
          background: "var(--bg-overlay)",
          backdropFilter: "var(--glass-blur-lg)",
          WebkitBackdropFilter: "var(--glass-blur-lg)",
          borderLeft: "1px solid var(--glass-border)",
          boxShadow: "var(--shadow-xl)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          animation: "slideInRight 0.2s ease",
          overflow: "hidden",
        }}
      >
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0.5; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border-light)",
            flexShrink: 0,
          }}
        >
          <h2
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text-primary)",
              margin: 0,
            }}
          >
            <Settings size={18} style={{ color: "var(--accent)" }} />
            任务设置
          </h2>
          <button
            className="btn-close"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          {loading ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: 200,
              }}
            >
              <div className="spinner" />
            </div>
          ) : (
            <>
              <div>
                <div
                  style={{
                    marginBottom: 20,
                    padding: "16px",
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Layers size={15} style={{ color: "var(--accent)"}} />
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {t("taskSettings.maxConcurrentTasks")}
                    </label>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      margin: "0 0 12px 0",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("taskSettings.maxConcurrentTasksDesc")}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleMaxTasksChange(settings.maxConcurrentTasks - 1)}
                      disabled={settings.maxConcurrentTasks <= 1}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={settings.maxConcurrentTasks}
                      onChange={(e) =>
                        handleMaxTasksChange(parseInt(e.target.value, 10) || 1)
                      }
                      style={{
                        width: 60,
                        textAlign: "center",
                        padding: "6px 8px",
                        fontSize: 16,
                        fontWeight: 600,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        outline: "none",
                        flexShrink: 0,
                      }}
                    />
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleMaxTasksChange(settings.maxConcurrentTasks + 1)}
                      disabled={settings.maxConcurrentTasks >= 50}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("taskSettings.unitTasks")}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    marginBottom: 20,
                    padding: "16px",
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <ScanSearch size={15} style={{ color: "#10b981" }} />
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {t("taskSettings.maxScrapingTasks")}
                    </label>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      margin: "0 0 12px 0",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("taskSettings.maxScrapingTasksDesc")}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleMaxScrapingChange(settings.maxScrapingTasks - 1)}
                      disabled={settings.maxScrapingTasks <= 1}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={settings.maxScrapingTasks}
                      onChange={(e) =>
                        handleMaxScrapingChange(parseInt(e.target.value, 10) || 1)
                      }
                      style={{
                        width: 60,
                        textAlign: "center",
                        padding: "6px 8px",
                        fontSize: 16,
                        fontWeight: 600,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        outline: "none",
                        flexShrink: 0,
                      }}
                    />
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleMaxScrapingChange(settings.maxScrapingTasks + 1)}
                      disabled={settings.maxScrapingTasks >= 50}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("taskSettings.unitTasks")}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "16px",
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Radar size={15} style={{ color: "#6366f1" }} />
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      嗅探最大{t("taskSettings.maxConcurrentTasks")}
                    </label>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      margin: "0 0 12px 0",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("taskSettings.maxSniffTasksDesc")}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() =>
                        handleMaxSniffChange(settings.maxConcurrentSniffTasks - 1)
                      }
                      disabled={settings.maxConcurrentSniffTasks <= 1}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.maxConcurrentSniffTasks}
                      onChange={(e) =>
                        handleMaxSniffChange(parseInt(e.target.value, 10) || 1)
                      }
                      style={{
                        width: 60,
                        textAlign: "center",
                        padding: "6px 8px",
                        fontSize: 16,
                        fontWeight: 600,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        outline: "none",
                        flexShrink: 0,
                      }}
                    />
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() =>
                        handleMaxSniffChange(settings.maxConcurrentSniffTasks + 1)
                      }
                      disabled={settings.maxConcurrentSniffTasks >= 10}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("taskSettings.unitTasks")}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    marginBottom: 20,
                    padding: "16px",
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Film size={15} style={{ color: "var(--accent)" }} />
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {t("taskSettings.tsSegmentConcurrent")}
                    </label>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      margin: "0 0 12px 0",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("taskSettings.tsSegmentConcurrentDesc")}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleTsSegmentChange(settings.tsSegmentConcurrent - 1)}
                      disabled={settings.tsSegmentConcurrent <= 1}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={settings.tsSegmentConcurrent}
                      onChange={(e) =>
                        handleTsSegmentChange(parseInt(e.target.value, 10) || 1)
                      }
                      style={{
                        width: 60,
                        textAlign: "center",
                        padding: "6px 8px",
                        fontSize: 16,
                        fontWeight: 600,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        outline: "none",
                        flexShrink: 0,
                      }}
                    />
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleTsSegmentChange(settings.tsSegmentConcurrent + 1)}
                      disabled={settings.tsSegmentConcurrent >= 200}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("taskSettings.unitSegments")}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: "16px",
                    background: "var(--bg-inset)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <Image size={15} style={{ color: "#6366f1" }} />
                    <label
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--text-primary)",
                      }}
                    >
                      {t("taskSettings.galleryImageConcurrent")}
                    </label>
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      margin: "0 0 12px 0",
                      lineHeight: 1.5,
                    }}
                  >
                    {t("taskSettings.galleryImageConcurrentDesc")}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleGalleryImageChange(settings.galleryImageConcurrent - 1)}
                      disabled={settings.galleryImageConcurrent <= 1}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={settings.galleryImageConcurrent}
                      onChange={(e) =>
                        handleGalleryImageChange(parseInt(e.target.value, 10) || 1)
                      }
                      style={{
                        width: 60,
                        textAlign: "center",
                        padding: "6px 8px",
                        fontSize: 16,
                        fontWeight: 600,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--text-primary)",
                        outline: "none",
                        flexShrink: 0,
                      }}
                    />
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => handleGalleryImageChange(settings.galleryImageConcurrent + 1)}
                      disabled={settings.galleryImageConcurrent >= 50}
                      style={{
                        width: 32,
                        height: 32,
                        padding: 0,
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      +
                    </button>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                      }}
                    >
                      {t("taskSettings.unitFiles")}
                    </span>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "12px 16px",
                  background: "rgba(99, 102, 241, 0.06)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(99, 102, 241, 0.15)",
                }}
              >
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  {t("taskSettings.note")}
                </p>
              </div>
            </>
          )}
        </div>

        <div
          style={{
            padding: "16px 20px",
            borderTop: "1px solid var(--border-light)",
            display: "flex",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <button
            className="btn btn-ghost btn-sm"
            onClick={fetchSettings}
            disabled={loading}
            title={t("taskSettings.refresh")}
            style={{ flexShrink: 0 }}
          >
            <RefreshCw size={14} />
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{ flex: 1 }}
          >
            {saving ? (
              <span className="spinner spinner-sm" />
            ) : (
              <>
                <Save size={16} />
                {t("taskSettings.save")}
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
