import { useState, useCallback } from "react";
import { toast } from "@/lib/i18n/toast";
import { formatFileSize } from "@/lib/utils";
import ProgressBar from "@/components/ui/progress-bar";
import { useI18n } from "@/lib/i18n";
import {
  Archive,
  Download,
  FileArchive,
  CheckCircle,
  AlertCircle,
  Loader2,
  Link as LinkIcon,
  RotateCw,
  Copy,
  X,
  Folder,
} from "lucide-react";
import type { GalleryDownloadInfoData } from "@/types";
import type { ZipStatus } from "../gallery-helpers";

interface GalleryZipInfoPanelProps {
  zipInfo: GalleryDownloadInfoData;
  zipStatus: ZipStatus;
  zipProgress?: { galleryId: number; downloaded: number; total: number; percent: number };
  galleryId: number;
  onDownloadZip: (id: number, manualUrl?: string) => Promise<boolean>;
}

export function GalleryZipInfoPanel({
  zipInfo,
  zipStatus,
  zipProgress,
  galleryId,
  onDownloadZip,
}: GalleryZipInfoPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [showManualUrl, setShowManualUrl] = useState(false);
  const [manualUrl, setManualUrl] = useState("");

  const isZipBusy = zipStatus === 'downloading' || zipStatus === 'extracting';
  const canDownloadZip = zipInfo && zipInfo.DownloadURL && !isZipBusy && zipStatus !== 'completed';

  const handleDownloadZip = useCallback(async () => {
    const ok = await onDownloadZip(galleryId);
    if (ok) toast.success("gallery.zipDownloadComplete");
    else toast.error("gallery.zipDownloadFailed");
  }, [galleryId, onDownloadZip]);

  const handleDownloadZipManual = useCallback(async () => {
    if (!manualUrl.trim()) {
      toast.error("gallery.pleaseInputDownloadLink");
      return;
    }
    const ok = await onDownloadZip(galleryId, manualUrl.trim());
    if (ok) toast.success("gallery.zipDownloadComplete");
    else toast.error("gallery.zipDownloadFailed");
    setShowManualUrl(false);
    setManualUrl("");
  }, [galleryId, manualUrl, onDownloadZip]);

  return (
    <div
      style={{
        marginTop: 16,
        padding: "12px 16px",
        background: "var(--bg-inset)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Archive size={14} />
          {t("gallery.zipPackage")}
          {zipStatus === 'completed' && (
            <span style={{ color: "var(--success)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
              <CheckCircle size={12} />
              {t("gallery.zipDownloaded")}
            </span>
          )}
          {zipStatus === 'downloading' && (
            <span style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
              <Loader2 size={12} className="spin" />
              {t("gallery.zipDownloading")}
            </span>
          )}
          {zipStatus === 'extracting' && (
            <span style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
              <Loader2 size={12} className="spin" />
              {t("gallery.zipExtracting")}
            </span>
          )}
          {zipStatus === 'failed' && (
            <span style={{ color: "var(--danger)", display: "flex", alignItems: "center", gap: 3, fontSize: 12 }}>
              <AlertCircle size={12} />
              {t("gallery.zipFailed")}
            </span>
          )}
        </span>
        {canDownloadZip && (
          <button
            className="btn btn-outline btn-sm"
            onClick={handleDownloadZip}
            style={{ fontSize: 12 }}
          >
            <Download size={12} />
            {t("gallery.downloadAndExtract")}
          </button>
        )}
      </div>

      {(zipStatus === 'downloading' || zipStatus === 'extracting') && zipProgress && zipProgress.total > 0 && (
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
          <ProgressBar progress={zipProgress.percent} minWidth={80} style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {formatFileSize(zipProgress.downloaded)} / {formatFileSize(zipProgress.total)}
            ({zipProgress.percent}%)
          </span>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 8,
          fontSize: 12,
        }}
      >
        {zipInfo.Title && (
          <div>
            <span style={{ color: "var(--text-muted)" }}>{t("gallery.zipTitle")}</span>
            <span style={{ color: "var(--text-primary)" }}>{zipInfo.Title}</span>
          </div>
        )}
        {zipInfo.FileCount > 0 && (
          <div>
            <span style={{ color: "var(--text-muted)" }}>{t("gallery.zipFileCount")}</span>
            <span style={{ color: "var(--text-primary)" }}>{zipInfo.FileCount}</span>
          </div>
        )}
        {zipInfo.FileSizeText && (
          <div>
            <span style={{ color: "var(--text-muted)" }}>{t("gallery.zipFileSize")}</span>
            <span style={{ color: "var(--text-primary)" }}>{zipInfo.FileSizeText}</span>
          </div>
        )}
        {zipInfo.ActualSize > 0 && (
          <div>
            <span style={{ color: "var(--text-muted)" }}>{t("gallery.zipActualSize")}</span>
            <span style={{ color: "var(--text-primary)" }}>{formatFileSize(zipInfo.ActualSize)}</span>
          </div>
        )}
        {zipInfo.ImageDimensions && (
          <div>
            <span style={{ color: "var(--text-muted)" }}>{t("gallery.zipDimensions")}</span>
            <span style={{ color: "var(--text-primary)" }}>{zipInfo.ImageDimensions}</span>
          </div>
        )}
        {zipInfo.Password && (
          <div>
            <span style={{ color: "var(--text-muted)" }}>{t("gallery.zipPassword")}</span>
            <span
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono), ui-monospace, monospace", cursor: "pointer" }}
              onClick={() => {
                navigator.clipboard.writeText(zipInfo.Password);
                toast.success("gallery.zipPasswordCopied");
              }}
              title={t("gallery.clickToCopy")}
            >
              {zipInfo.Password}
            </span>
          </div>
        )}
        {zipInfo.Provider && (
          <div>
            <span style={{ color: "var(--text-muted)" }}>{t("gallery.zipSource")}</span>
            <span style={{ color: "var(--text-primary)" }}>{zipInfo.Provider}</span>
          </div>
        )}
        {zipInfo.RequiresLogin && (
          <div>
            <span style={{ color: "var(--warning)" }}>{t("gallery.zipRequiresLogin")}</span>
          </div>
        )}
      </div>

      {zipInfo.DownloadURL && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <a
            href={zipInfo.DownloadURL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: "var(--accent)",
              textDecoration: "none",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {zipInfo.DownloadURL}
          </a>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(zipInfo.DownloadURL);
              toast.success("gallery.zipLinkCopied");
            }}
            style={{ flexShrink: 0 }}
          >
            <Copy size={12} />
          </button>
        </div>
      )}

      {zipStatus === 'completed' && zipInfo.LocalPath && (
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
          }}
        >
          <FileArchive size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
          <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{t("gallery.zipPathLabel")}</span>
          <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {zipInfo.LocalPath}
          </span>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(zipInfo.LocalPath);
              toast.success("gallery.zipPathCopied");
            }}
            style={{ flexShrink: 0 }}
          >
            <Copy size={12} />
          </button>
        </div>
      )}
      {zipStatus === 'completed' && zipInfo.ExtractedPath && (
        <div
          style={{
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
          }}
        >
          <Folder size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
          <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{t("gallery.zipExtractLabel")}</span>
          <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {zipInfo.ExtractedPath}
          </span>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => {
              navigator.clipboard.writeText(zipInfo.ExtractedPath);
              toast.success("gallery.zipPathCopied");
            }}
            style={{ flexShrink: 0 }}
          >
            <Copy size={12} />
          </button>
        </div>
      )}

      {zipStatus === 'failed' && !isZipBusy && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={handleDownloadZip}
            style={{ fontSize: 12 }}
          >
            <RotateCw size={12} />
            {t("gallery.retryDownload")}
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowManualUrl(!showManualUrl)}
            style={{ fontSize: 12 }}
          >
            <LinkIcon size={12} />
            {t("gallery.manualInputLink")}
          </button>
        </div>
      )}

      {zipInfo.RequiresLogin && zipStatus !== 'completed' && !isZipBusy && zipStatus !== 'failed' && (
        <div style={{ marginTop: 8 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => setShowManualUrl(!showManualUrl)}
            style={{ fontSize: 12 }}
          >
            <LinkIcon size={12} />
            {t("gallery.manualInputDirect")}
          </button>
        </div>
      )}

      {showManualUrl && (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder={t("gallery.pasteUrlPlaceholder")}
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            style={{
              flex: 1,
              padding: "6px 12px",
              fontSize: 12,
              height: 32,
              boxSizing: "border-box",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-primary)",
              outline: "none",
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleDownloadZipManual();
            }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handleDownloadZipManual}
            style={{ flexShrink: 0 }}
          >
            <Download size={12} />
            {t("common.download")}
          </button>
          <button
            className="btn-close"
            onClick={() => { setShowManualUrl(false); setManualUrl(""); }}
            style={{ flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
