import { useEffect, useState } from "react";
import { toast } from "@/lib/i18n/toast";
import { Save, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface ConfigState {
  chromedriver_path: string;
  ffmpeg_path: string;
  download_path: string;
  concurrency: number;
  default_transcode: boolean;
}

export default function ConfigPage(): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<ConfigState>({
    chromedriver_path: "",
    ffmpeg_path: "",
    download_path: "",
    concurrency: 3,
    default_transcode: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        });
      } catch {
        toast.error("config.loadConfigFailed");
      } finally {
        setLoading(false);
      }
    })();
  }, [t]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const payload = {
        chromedriver_path: config.chromedriver_path || undefined,
        ffmpeg_path: config.ffmpeg_path || undefined,
        download_path: config.download_path || undefined,
        concurrency: config.concurrency,
        default_transcode: config.default_transcode,
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
    </div>
  );
}
