"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "@/lib/i18n/toast";
import { useI18n } from "@/lib/i18n";
import { X, Settings, Save, Layers, Radar, RefreshCw, Film, Image, ScanSearch } from "lucide-react";
import type { TaskSettings, TaskSettingsPanelProps } from "./components";
import { NumberStepper, SettingCard } from "./components";

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

  const update = (key: keyof TaskSettings, value: number, min: number, max: number): void => {
    const v = Math.max(min, Math.min(max, value));
    setSettings((prev) => ({ ...prev, [key]: v }));
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
            padding: 20,
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
                <SettingCard
                  icon={Layers}
                  iconColor="var(--accent)"
                  label={t("taskSettings.maxConcurrentTasks")}
                  description={t("taskSettings.maxConcurrentTasksDesc")}
                >
                  <NumberStepper
                    value={settings.maxConcurrentTasks}
                    min={1}
                    max={50}
                    unit={t("taskSettings.unitTasks")}
                    onChange={(v) => update("maxConcurrentTasks", v, 1, 50)}
                  />
                </SettingCard>

                <SettingCard
                  icon={ScanSearch}
                  iconColor="#10b981"
                  label={t("taskSettings.maxScrapingTasks")}
                  description={t("taskSettings.maxScrapingTasksDesc")}
                >
                  <NumberStepper
                    value={settings.maxScrapingTasks}
                    min={1}
                    max={50}
                    unit={t("taskSettings.unitTasks")}
                    onChange={(v) => update("maxScrapingTasks", v, 1, 50)}
                  />
                </SettingCard>

                <SettingCard
                  icon={Radar}
                  iconColor="#6366f1"
                  label={`嗅探最大${t("taskSettings.maxConcurrentTasks")}`}
                  description={t("taskSettings.maxSniffTasksDesc")}
                >
                  <NumberStepper
                    value={settings.maxConcurrentSniffTasks}
                    min={1}
                    max={10}
                    unit={t("taskSettings.unitTasks")}
                    onChange={(v) => update("maxConcurrentSniffTasks", v, 1, 10)}
                  />
                </SettingCard>

                <SettingCard
                  icon={Film}
                  iconColor="var(--accent)"
                  label={t("taskSettings.tsSegmentConcurrent")}
                  description={t("taskSettings.tsSegmentConcurrentDesc")}
                >
                  <NumberStepper
                    value={settings.tsSegmentConcurrent}
                    min={1}
                    max={200}
                    unit={t("taskSettings.unitSegments")}
                    onChange={(v) => update("tsSegmentConcurrent", v, 1, 200)}
                  />
                </SettingCard>

                <SettingCard
                  icon={Image}
                  iconColor="#6366f1"
                  label={t("taskSettings.galleryImageConcurrent")}
                  description={t("taskSettings.galleryImageConcurrentDesc")}
                  marginBottom={0}
                >
                  <NumberStepper
                    value={settings.galleryImageConcurrent}
                    min={1}
                    max={50}
                    unit={t("taskSettings.unitFiles")}
                    onChange={(v) => update("galleryImageConcurrent", v, 1, 50)}
                  />
                </SettingCard>
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
