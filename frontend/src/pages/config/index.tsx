import { useEffect, useState } from "react";
import { toast } from "@/lib/i18n/toast";
import { Save, RotateCcw, Cpu, Zap } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { LogConsole } from "@/components/ops/log-console";

interface ConfigState {
  chromedriver_path: string;
  ffmpeg_path: string;
  download_path: string;
  concurrency: number;
  default_transcode: boolean;
  download_multi_thread: boolean;
  download_concurrency: number;
  download_max_speed: number;
  download_min_file_size: number;
  gpu_transcode: boolean;
}

interface GPUInfo {
  available: boolean;
  type: string;
  encoder_name: string;
  gpu_name: string;
  driver_version: string;
  cuda_support: boolean;
  description: string;
  detection_error?: string;
}

const BYTES_PER_MB = 1024 * 1024;

export default function ConfigPage(): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<ConfigState>({
    chromedriver_path: "",
    ffmpeg_path: "",
    download_path: "",
    concurrency: 3,
    default_transcode: false,
    download_multi_thread: false,
    download_concurrency: 4,
    download_max_speed: 0,
    download_min_file_size: 1,
    gpu_transcode: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gpuInfo, setGpuInfo] = useState<GPUInfo | null>(null);
  const [gpuLoading, setGpuLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/config");
        const data = await res.json();
        setConfig({
          chromedriver_path: data?.chromedriver_path ?? "",
          ffmpeg_path: data?.ffmpeg_path ?? "",
          download_path: data?.download_path ?? "",
          concurrency: data?.concurrency ?? data?.max_concurrent ?? 3,
          default_transcode: data?.default_transcode ?? data?.transcode_to_mp4 ?? false,
          download_multi_thread: data?.download_multi_thread === "true" || data?.download_multi_thread === true,
          download_concurrency: parseInt(data?.download_concurrency, 10) || 4,
          download_max_speed: Math.round((parseInt(data?.download_max_speed, 10) || 0) / BYTES_PER_MB),
          download_min_file_size: Math.round((parseInt(data?.download_min_file_size, 10) || BYTES_PER_MB) / BYTES_PER_MB),
          gpu_transcode: data?.gpu_transcode === "true" || data?.gpu_transcode === true,
        });
      } catch {
        toast.error("config.loadConfigFailed");
      } finally {
        setLoading(false);
      }
    })();

    // Fetch GPU info in parallel
    fetchGPUInfo();
  }, [t]);

  const fetchGPUInfo = async (): Promise<void> => {
    setGpuLoading(true);
    try {
      const res = await fetch("/api/gpu-info");
      if (res.ok) {
        const data = await res.json();
        setGpuInfo(data);
        // Sync GPU enabled state from server
        if (data?.gpu_enabled !== undefined) {
          setConfig((prev) => ({
            ...prev,
            gpu_transcode: data.gpu_enabled === true,
          }));
        }
      }
    } catch {
      // GPU info fetch failure is non-critical
    } finally {
      setGpuLoading(false);
    }
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      // Save GPU transcoding setting to dedicated endpoint
      if (gpuInfo && config.gpu_transcode !== gpuInfo.gpu_enabled) {
        try {
          await fetch("/api/gpu-setting", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: config.gpu_transcode }),
          });
        } catch {
          // GPU setting save failure is non-critical; continue with config save
        }
      }

      const payload = {
        chromedriver_path: config.chromedriver_path || undefined,
        ffmpeg_path: config.ffmpeg_path || undefined,
        download_path: config.download_path || undefined,
        concurrency: config.concurrency,
        default_transcode: config.default_transcode,
        download_multi_thread: config.download_multi_thread ? "true" : "false",
        download_concurrency: String(config.download_concurrency),
        download_max_speed: String(config.download_max_speed * BYTES_PER_MB),
        download_min_file_size: String(config.download_min_file_size * BYTES_PER_MB),
        gpu_transcode: config.gpu_transcode ? "true" : "false",
      };
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || t("config.saveConfigFailed"));
      }
      toast.success("config.configSaved");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig({
        chromedriver_path: data?.chromedriver_path ?? "",
        ffmpeg_path: data?.ffmpeg_path ?? "",
        download_path: data?.download_path ?? "",
        concurrency: data?.concurrency ?? data?.max_concurrent ?? 3,
        default_transcode: data?.default_transcode ?? data?.transcode_to_mp4 ?? false,
        download_multi_thread: data?.download_multi_thread === "true" || data?.download_multi_thread === true,
        download_concurrency: parseInt(data?.download_concurrency, 10) || 4,
        download_max_speed: Math.round((parseInt(data?.download_max_speed, 10) || 0) / BYTES_PER_MB),
        download_min_file_size: Math.round((parseInt(data?.download_min_file_size, 10) || BYTES_PER_MB) / BYTES_PER_MB),
      });
      toast.success("config.restoredDefault");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div>
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

      <div className="card">
        <div className="config-section">
          <div className="config-section-title">{t("config.pathSettings")}</div>
          <div className="form-group">
            <label>{t("config.chromeDriverPath")}</label>
            <input
              type="text"
              placeholder="/usr/local/bin/chromedriver"
              value={config.chromedriver_path}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  chromedriver_path: e.target.value,
                }))
              }
            />
          </div>
          <div className="form-group">
            <label>{t("config.ffmpegPath")}</label>
            <input
              type="text"
              placeholder="/usr/local/bin/ffmpeg"
              value={config.ffmpeg_path}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  ffmpeg_path: e.target.value,
                }))
              }
            />
          </div>
          <div className="form-group">
            <label>{t("config.downloadPath")}</label>
            <input
              type="text"
              placeholder="/downloads"
              value={config.download_path}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  download_path: e.target.value,
                }))
              }
            />
          </div>
        </div>

        <div className="config-section">
          <div className="config-section-title">{t("config.downloadSettings")}</div>
          <div className="form-row">
            <div className="form-group">
              <label>{t("config.concurrency")}</label>
              <input
                type="number"
                min={1}
                max={10}
                value={config.concurrency}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setConfig((prev) => ({
                    ...prev,
                    concurrency: isNaN(v) ? 1 : v,
                  }));
                }}
              />
            </div>
            <div
              className="form-group"
              style={{ flex: 0, minWidth: 200 }}
            >
              <div className="checkbox-group" style={{ paddingTop: 24 }}>
                <input
                  type="checkbox"
                  id="default-transcode"
                  checked={config.default_transcode}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      default_transcode: e.target.checked,
                    }))
                  }
                />
                <label htmlFor="default-transcode">{t("config.defaultTranscode")}</label>
              </div>
            </div>
          </div>
        </div>

        <div className="config-section">
          <div className="config-section-title">{t("config.multiThreadSettings")}</div>
          <div className="form-group">
            <div className="checkbox-group">
              <input
                type="checkbox"
                id="download-multi-thread"
                checked={config.download_multi_thread}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    download_multi_thread: e.target.checked,
                  }))
                }
              />
              <label htmlFor="download-multi-thread">{t("config.multiThreadDownload")}</label>
            </div>
          </div>
          <div className="form-group">
            <label>{t("config.downloadConcurrency")}</label>
            <input
              type="range"
              min={2}
              max={8}
              step={1}
              value={config.download_concurrency}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  download_concurrency: parseInt(e.target.value, 10),
                }))
              }
            />
            <span className="value-display">{config.download_concurrency}</span>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{t("config.downloadMaxSpeed")}</label>
              <input
                type="number"
                min={0}
                step={1}
                value={config.download_max_speed}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setConfig((prev) => ({
                    ...prev,
                    download_max_speed: isNaN(v) ? 0 : Math.max(0, v),
                  }));
                }}
              />
            </div>
            <div className="form-group">
              <label>{t("config.downloadMinFileSize")}</label>
              <input
                type="number"
                min={0}
                step={1}
                value={config.download_min_file_size}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setConfig((prev) => ({
                    ...prev,
                    download_min_file_size: isNaN(v) ? 1 : Math.max(0, v),
                  }));
                }}
              />
            </div>
          </div>
        </div>

        <div className="config-section">
          <div className="config-section-title">
            <Cpu size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            {t("config.gpuTranscodeSettings")}
          </div>
          <div className="form-group">
            <div className="checkbox-group">
              <input
                type="checkbox"
                id="gpu-transcode"
                checked={config.gpu_transcode}
                onChange={(e) =>
                  setConfig((prev) => ({
                    ...prev,
                    gpu_transcode: e.target.checked,
                  }))
                }
                disabled={!gpuInfo?.available && !config.gpu_transcode}
              />
              <label htmlFor="gpu-transcode">
                <Zap size={12} style={{ marginRight: 4, verticalAlign: "middle" }} />
                {t("config.enableGPUTranscode")}
              </label>
            </div>
            {/* GPU Info Display */}
            {gpuLoading ? (
              <div className="gpu-info-loading">
                <span className="spinner spinner-sm" />
                {t("config.gpuDetecting")}
              </div>
            ) : gpuInfo ? (
              <div className={`gpu-info-box ${gpuInfo.available ? "gpu-available" : "gpu-unavailable"}`}>
                {gpuInfo.available ? (
                  <>
                    <div className="gpu-info-row">
                      <span className="gpu-label">{t("config.gpuDetected")}:</span>
                      <span className="gpu-value">{gpuInfo.gpu_name || gpuInfo.type}</span>
                    </div>
                    {gpuInfo.driver_version && (
                      <div className="gpu-info-row">
                        <span className="gpu-label">{t("config.gpuDriver")}:</span>
                        <span className="gpu-value">{gpuInfo.driver_version}</span>
                      </div>
                    )}
                    <div className="gpu-info-row">
                      <span className="gpu-label">{t("config.gpuEncoder")}:</span>
                      <span className="gpu-value">{gpuInfo.encoder_name || gpuInfo.type}</span>
                    </div>
                  </>
                ) : (
                  <div className="gpu-info-row gpu-no-gpu">
                    <span className="gpu-value">
                      {gpuInfo.detection_error || t("config.gpuNotAvailable")}
                    </span>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div className="config-actions">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <span className="spinner spinner-sm" />
            ) : (
              <>
                <Save size={16} />
                {t("config.saveConfig")}
              </>
            )}
          </button>
          <button className="btn btn-ghost" onClick={handleReset}>
            <RotateCcw size={16} />
            {t("config.restoreDefault")}
          </button>
        </div>
      </div>

      {/* 系统控制台 — 从首页迁入，作为配置页子功能 */}
      <div className="config-section">
        <div className="config-section-title">{t("ops.systemConsole")}</div>
        <LogConsole />
      </div>
    </div>
  );
}
