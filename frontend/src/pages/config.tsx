import { useState, useEffect, useCallback } from "react";
import { toast } from "@/lib/i18n/toast";
import { useI18n } from "@/lib/i18n";
import { Save, RefreshCw, Cpu, Settings } from "lucide-react";

/*
 * Snake_case keys mirror the GET /api/gpu-info response; gpu_enabled is only
 * present when a DownloadManager is wired.
 */
interface GpuInfo {
  gpu_enabled: boolean;
  gpu_name?: string;
  driver_version?: string;
  description?: string;
}

/*
 * Human labels for the known /api/config keys; unknown keys fall back to
 * their raw snake_case name.
 */
const FIELD_LABEL_KEYS: Record<string, "config.field.gpu_force_type" | "config.field.gpu_transcode"> = {
  gpu_force_type: "config.field.gpu_force_type",
  gpu_transcode: "config.field.gpu_transcode",
};

export default function ConfigPage(): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);

  // GET /api/config returns a flat {key: value} map
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      const data = (await res.json()) as Record<string, unknown>;
      const flat: Record<string, string> = {};
      if (data && typeof data === "object" && !Array.isArray(data)) {
        for (const [key, value] of Object.entries(data)) {
          flat[key] = String(value ?? "");
        }
      }
      setConfig(flat);
    } catch {
      toast.error("config.loadFailed");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGPUInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/gpu-info");
      if (res.ok) {
        const data = (await res.json()) as GpuInfo;
        if (data && typeof data.gpu_enabled === "boolean") {
          setGpuInfo(data);
        }
      }
    }
    // GPU card stays hidden when there is no hardware transcoding backend.
    catch {
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    fetchGPUInfo();
  }, [fetchConfig, fetchGPUInfo]);

  /*
   * PUT /api/config takes the flat {key: value} object; a {config: [...]}
   * wrapper is stored as one literal "config" key and saves nothing
   */
  const handleSaveConfig = async (): Promise<void> => {
    setSaving(true);
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || t("config.saveConfigFailed"));
      }
      toast.success("config.saved");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  /*
   * PUT /api/gpu-setting expects {enabled, force_gpu_type}; a {gpu_enabled}
   * field decodes to the Go zero value and leaves the toggle disabled
   */
  const handleSaveGpu = async (): Promise<void> => {
    if (!gpuInfo) return;
    try {
      const res = await fetch("/api/gpu-setting", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: gpuInfo.gpu_enabled }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("config.gpuSaved");
    } catch {
      toast.error("config.gpuSaveFailed");
    }
  };

  const updateConfigValue = (key: string, value: string): void => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1>{t("config.title")}</h1>
        </div>
        <div className="loading-container">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>{t("config.title")}</h1>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-header">
          <div className="card-title">{t("config.basicSettings")}</div>
        </div>
        <div className="card-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {Object.entries(config).map(([key, value]) => (
              <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor={`config-field-${key}`}>
                  {FIELD_LABEL_KEYS[key] ? t(FIELD_LABEL_KEYS[key]) : key}
                </label>
                <input
                  id={`config-field-${key}`}
                  className="form-control"
                  type="text"
                  value={value}
                  onChange={(e) => updateConfigValue(key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleSaveConfig}
              disabled={saving}
            >
              <Save size={16} />
              {saving ? t("common.saving") : t("common.save")}
            </button>
            <button className="btn btn-outline btn-sm" onClick={fetchConfig}>
              <RefreshCw size={14} />
              {t("common.refresh")}
            </button>
          </div>
        </div>
      </div>

      {gpuInfo && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">
              <Cpu size={16} style={{ marginRight: 8 }} />
              {t("config.gpuTranscoding")}
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={gpuInfo.gpu_enabled}
                  onChange={(e) =>
                    setGpuInfo((prev) =>
                      prev ? { ...prev, gpu_enabled: e.target.checked } : prev,
                    )
                  }
                />
                <span className="toggle-slider" />
              </label>
              <span>{t("config.enableGpuTranscoding")}</span>
              {gpuInfo.gpu_name && (
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  ({gpuInfo.gpu_name})
                </span>
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveGpu}>
                <Settings size={14} />
                {t("config.applyGpuSetting")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
