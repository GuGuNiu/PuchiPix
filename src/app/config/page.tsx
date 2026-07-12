"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save, RotateCcw } from "lucide-react";

interface ConfigState {
  chromedriver_path: string;
  ffmpeg_path: string;
  download_path: string;
  concurrency: number;
  default_transcode: boolean;
}

export default function ConfigPage() {
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
        toast.error("加载配置失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
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
        throw new Error(text || "保存配置失败");
      }
      toast.success("配置已保存");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
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
      toast.success("已恢复默认值");
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
          <h1>系统配置</h1>
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
        <h1>系统配置</h1>
      </div>

      <div className="card">
        <div className="config-section">
          <div className="config-section-title">路径设置</div>
          <div className="form-group">
            <label>ChromeDriver 路径</label>
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
            <label>FFmpeg 路径</label>
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
            <label>默认下载目录</label>
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
          <div className="config-section-title">下载设置</div>
          <div className="form-row">
            <div className="form-group">
              <label>并发数</label>
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
                <label htmlFor="default-transcode">默认转码为 MP4</label>
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
                保存配置
              </>
            )}
          </button>
          <button className="btn btn-ghost" onClick={handleReset}>
            <RotateCcw size={16} />
            恢复默认
          </button>
        </div>
      </div>
    </div>
  );
}
