import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatFileSize, formatDuration } from "@/lib/utils";
import type { SearchItem } from "@/types";
import { STATUS_KEYS, type PopupData } from "./hls-utils";

export function StatusBadge({
  status,
  taskId: _taskId,
}: {
  status: string;
  taskId?: number;
}): React.JSX.Element {
  const { t } = useI18n();
  if (status === "downloaded") {
    return (
      <span className="badge badge-success" style={{ fontSize: 11 }}>
        <CheckCircle2 size={11} style={{ display: "inline", marginRight: 3 }} />
        {t("search.statusDownloaded")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="badge badge-danger" style={{ fontSize: 11 }}>
        <XCircle size={11} style={{ display: "inline", marginRight: 3 }} />
        {t("common.failed")}
      </span>
    );
  }
  if (status === "scraping") {
    return (
      <span className="badge badge-info" style={{ fontSize: 11 }}>
        <Loader2
          size={11}
          className="spinner spinner-sm"
          style={{ display: "inline", marginRight: 3 }}
        />
        {t("search.statusScraping")}
      </span>
    );
  }
  return (
    <span className="badge badge-default" style={{ fontSize: 11 }}>
      {t(STATUS_KEYS[status]) || status}
    </span>
  );
}

export function VideoInfoPopupContent({
  item,
  data,
}: {
  item: SearchItem;
  data: PopupData | null;
}): React.JSX.Element {
  const { t } = useI18n();
  const vi = data?.videoInfo;
  const segments = data?.segments;

  const hasAnyData = vi || segments;

  if (!hasAnyData) {
    return (
      <div className="video-info-popup-empty">
        {t("search.noDetailData", { scrape: t("search.scrape") })}
      </div>
    );
  }

  return (
    <>
      <div className="video-info-popup-section">
        <div className="video-info-popup-label">{t("search.videoData")}</div>
        <div className="video-info-popup-grid">
          {vi?.Title && (
            <div className="video-info-popup-field">
              <span className="field-key">{t("search.fieldTitle")}</span>
              <span className="field-val" title={vi.Title}>{vi.Title}</span>
            </div>
          )}
          {item.date && (
            <div className="video-info-popup-field">
              <span className="field-key">{t("search.fieldDate")}</span>
              <span className="field-val">{item.date}</span>
            </div>
          )}
          {vi?.Resolution && (
            <div className="video-info-popup-field">
              <span className="field-key">{t("search.fieldResolution")}</span>
              <span className="field-val">{vi.Resolution}</span>
            </div>
          )}
          {vi?.Duration && vi.Duration > 0 ? (
            <div className="video-info-popup-field">
              <span className="field-key">{t("search.fieldDuration")}</span>
              <span className="field-val">{formatDuration(vi.Duration * 60)}</span>
            </div>
          ) : segments && (
            <div className="video-info-popup-field">
              <span className="field-key">{t("search.fieldDuration")}</span>
              <span className="field-val">{formatDuration(segments.totalDuration)}</span>
            </div>
          )}
          <div className="video-info-popup-field">
            <span className="field-key">{t("search.fieldStatus")}</span>
            <span className="field-val">{t(STATUS_KEYS[item.status]) || item.status}</span>
          </div>
        </div>
      </div>

      {vi?.Categories && vi.Categories.length > 0 && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">{t("search.categories")}</div>
          <div className="video-info-popup-chips">
            {vi.Categories.map((c, i) => (
              <span key={i} className="chip chip-category">{c}</span>
            ))}
          </div>
        </div>
      )}

      {vi?.Tags && vi.Tags.length > 0 && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">{t("search.tags")}</div>
          <div className="video-info-popup-chips">
            {vi.Tags.map((t, i) => (
              <span key={i} className="chip chip-tag">{t}</span>
            ))}
          </div>
        </div>
      )}

      {vi?.Actors && vi.Actors.length > 0 && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">{t("search.actors")}</div>
          <div className="video-info-popup-chips">
            {vi.Actors.map((a, i) => (
              <span key={i} className="chip chip-actor">{a}</span>
            ))}
          </div>
        </div>
      )}

      {vi?.Director && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">{t("search.director")}</div>
          <div className="video-info-popup-field">
            <span className="field-val">{vi.Director}</span>
          </div>
        </div>
      )}

      {segments && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">{t("search.segmentData")}</div>
          <div className="video-info-popup-grid">
            <div className="video-info-popup-field">
              <span className="field-key">{t("search.segmentCount")}</span>
              <span className="field-val">{segments.count}</span>
            </div>
            <div className="video-info-popup-field">
              <span className="field-key">{t("search.totalDuration")}</span>
              <span className="field-val">{formatDuration(segments.totalDuration)}</span>
            </div>
            {segments.count > 0 && (
              <div className="video-info-popup-field">
                <span className="field-key">{t("search.avgSegmentDuration")}</span>
                <span className="field-val">{(segments.totalDuration / segments.count).toFixed(1)}s</span>
              </div>
            )}
          </div>
        </div>
      )}

      {(vi?.FileSize || (segments && vi?.Duration)) && (
        <div className="video-info-popup-section">
          <div className="video-info-popup-label">{t("search.sizeData")}</div>
          <div className="video-info-popup-grid">
            {vi?.FileSize && vi.FileSize > 0 ? (
              <div className="video-info-popup-field">
                <span className="field-key">{t("search.fieldFileSize")}</span>
                <span className="field-val">{formatFileSize(vi.FileSize)}</span>
              </div>
            ) : segments && segments.count > 0 ? (
              <div className="video-info-popup-field">
                <span className="field-key">{t("search.estimatedSize")}</span>
                <span className="field-val">{t("search.estimatedSizeValue")}</span>
              </div>
            ) : null}
            {segments && segments.totalDuration > 0 && vi?.FileSize && vi.FileSize > 0 && (
              <div className="video-info-popup-field">
                <span className="field-key">{t("search.bitrate")}</span>
                <span className="field-val">
                  {((vi.FileSize * 8) / segments.totalDuration / 1000).toFixed(0)} kbps
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
