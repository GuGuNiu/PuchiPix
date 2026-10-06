import { useEffect, useState, useMemo, useRef } from "react";
import { Grid, useGridRef } from "react-window";
import type { GalleryData } from "@/types";
import { GalleryCard } from "./gallery-card";

const COL_MIN_WIDTH = 288;
const GAP = 16;
const ROW_HEIGHT = 356;

interface GalleryGridProps {
  items: GalleryData[];
  expandedId: number | null;
  onExpand: (id: number) => void;
}

interface GalleryGridCellData {
  items: GalleryData[];
  columnCount: number;
  expandedId: number | null;
  onExpand: (id: number) => void;
}

export function GalleryGrid({ items, expandedId, onExpand }: GalleryGridProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useGridRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      }
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const columnCount = Math.max(
    1,
    Math.floor((size.width + GAP) / (COL_MIN_WIDTH + GAP)),
  );
  const columnWidth = (size.width + GAP) / columnCount;
  const rowCount = Math.ceil(items.length / columnCount);

  const cellProps = useMemo<GalleryGridCellData>(
    () => ({ items, columnCount, expandedId, onExpand }),
    [items, columnCount, expandedId, onExpand],
  );

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {size.width > 0 && size.height > 0 && (
        <Grid<GalleryGridCellData>
          gridRef={gridRef}
          cellComponent={GalleryGridCell}
          cellProps={cellProps}
          columnCount={columnCount}
          columnWidth={columnWidth}
          rowCount={rowCount}
          rowHeight={ROW_HEIGHT}
          overscanCount={2}
          className="gallery-grid"
          style={{
            width: size.width,
            height: size.height,
            overflowX: "hidden",
          }}
        />
      )}
    </div>
  );
}

function GalleryGridCell({
  columnIndex,
  rowIndex,
  style,
  items,
  columnCount,
  expandedId,
  onExpand,
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  items: GalleryData[];
  columnCount: number;
  expandedId: number | null;
  onExpand: (id: number) => void;
} & { ariaAttributes: { "aria-colindex": number; role: "gridcell" } }): React.JSX.Element | null {
  const index = rowIndex * columnCount + columnIndex;
  const gallery = items[index];
  if (!gallery) return null;

  return (
    <div
      style={{
        ...style,
        padding: `${GAP / 2}px ${GAP}px ${GAP / 2}px 0`,
        boxSizing: "border-box",
      }}
    >
      <GalleryCard
        gallery={gallery}
        isExpanded={expandedId === gallery.ID}
        onExpand={onExpand}
      />
    </div>
  );
}
