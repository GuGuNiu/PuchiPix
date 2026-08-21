import { useEffect, useState, useMemo, useRef } from "react";
import { Grid, useGridRef } from "react-window";
import type { GalleryData } from "@/types";
import { GalleryCard } from "./gallery-card";

/** 网格列宽（与卡片内容尺寸匹配） */
const COL_WIDTH = 288;
/** 卡片间距 */
const GAP = 16;
/** 虚拟化行高：封面 220px + 文本区（固定高度，超出的 pill 行裁剪） */
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

/**
 * 图包主网格（虚拟化）。
 *
 * 只渲染视口内的卡片，配合 GalleryCard 的 React.memo 与 store
 * 引用稳定性，数百张图包也能流畅滚动/更新。
 */
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
    Math.floor((size.width + GAP) / (COL_WIDTH + GAP)),
  );
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
          columnWidth={COL_WIDTH + GAP}
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
        padding: `${GAP / 2}px ${columnIndex === columnCount - 1 ? 0 : GAP / 2}px ${GAP / 2}px ${
          columnIndex === 0 ? 0 : GAP / 2
        }px`,
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
