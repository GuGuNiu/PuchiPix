import { useEffect, useState, useMemo, useRef } from "react";
import { Grid, useGridRef } from "react-window";
import { useI18n } from "@/lib/i18n";
import type { ImageItem } from "../gallery-helpers";

interface VirtualImageGridProps {
  images: ImageItem[];
}

export function VirtualImageGrid({ images }: VirtualImageGridProps): React.JSX.Element {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const gridRef = useGridRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const COLUMN_WIDTH = 120;
  const COLUMN_GAP = 10;
  const ROW_HEIGHT = 166;

  const columnCount = Math.max(1, Math.floor((containerWidth + COLUMN_GAP) / (COLUMN_WIDTH + COLUMN_GAP)));
  const rowCount = Math.ceil(images.length / columnCount);

  const cellProps = useMemo(() => ({ images, columnCount }), [images, columnCount]);

  return (
    <div ref={containerRef} style={{ marginTop: 16, width: "100%" }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text-secondary)",
          marginBottom: 8,
        }}
      >
        {t("gallery.imageList", { count: images.length })}
      </div>
      <div style={{ width: "100%" }}>
        {containerWidth > 0 && (
          <Grid<ImageCellData>
            gridRef={gridRef}
            cellComponent={ImageCell}
            cellProps={cellProps}
            columnCount={columnCount}
            columnWidth={COLUMN_WIDTH + COLUMN_GAP}
            rowCount={rowCount}
            rowHeight={ROW_HEIGHT}
            overscanCount={2}
            style={{
              width: containerWidth,
              height: Math.min(600, rowCount * ROW_HEIGHT),
              overflowX: "hidden",
            }}
          />
        )}
      </div>
    </div>
  );
}

interface ImageCellData {
  images: ImageItem[];
  columnCount: number;
}

function ImageCell({
  columnIndex,
  rowIndex,
  style,
  images,
  columnCount,
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  images: ImageItem[];
  columnCount: number;
} & { ariaAttributes: { "aria-colindex": number; role: "gridcell" } }): React.JSX.Element | null {
  const { t } = useI18n();
  const index = rowIndex * columnCount + columnIndex;
  const img = images[index];
  if (!img) return null;

  return (
    <div
      style={{
        ...style,
        padding: `0 ${columnIndex === columnCount - 1 ? 0 : 5}px ${5}px ${columnIndex === 0 ? 0 : 5}px`,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: "var(--radius-sm)",
          overflow: "hidden",
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
        }}
        title={t("gallery.imagePage", { page: img.PageIndex + 1, order: img.OrderIndex + 1 })}
      >
        <img
          src={img.LocalPath ? `/api/proxy?path=${encodeURIComponent(img.LocalPath)}` : img.URL}
          alt={`img-${img.OrderIndex + 1}`}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const el = e.currentTarget;
            // If local proxy fails, fall back to external URL
            if (img.LocalPath && el.src.includes("/api/proxy?path=") && !el.dataset.fallback) {
              el.dataset.fallback = "1";
              if (img.URL) {
                el.src = img.URL;
              } else {
                el.style.opacity = "0.2";
              }
            } else {
              el.style.opacity = "0.2";
            }
          }}
        />
        <span
          style={{
            position: "absolute",
            bottom: 2,
            right: 2,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background:
              img.Status === "downloaded"
                ? "var(--success)"
                : img.Status === "failed"
                ? "var(--danger)"
                : "var(--text-muted)",
          }}
        />
      </div>
    </div>
  );
}
