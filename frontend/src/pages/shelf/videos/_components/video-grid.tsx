import { useEffect, useState, useMemo, useRef } from "react";
import { Grid, useGridRef } from "react-window";
import { VideoCard } from "./video-card";
import type { VideoShelfItem } from "../video-helpers";

const COL_WIDTH = 288;
const GAP = 16;
const ROW_HEIGHT = 356;

interface VideoGridProps {
  items: VideoShelfItem[];
  onPlay: (video: VideoShelfItem) => void;
  selectMode?: boolean;
  selectedIds?: Set<number>;
  onToggleSelect?: (video: VideoShelfItem) => void;
}

interface VideoGridCellData {
  items: VideoShelfItem[];
  columnCount: number;
  onPlay: (video: VideoShelfItem) => void;
  selectMode: boolean;
  selectedIds: Set<number>;
  onToggleSelect?: (video: VideoShelfItem) => void;
}

export function VideoGrid({ items, onPlay, selectMode = false, selectedIds, onToggleSelect }: VideoGridProps): React.JSX.Element {
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

  const cellProps = useMemo<VideoGridCellData>(
    () => ({ items, columnCount, onPlay, selectMode, selectedIds: selectedIds ?? new Set<number>(), onToggleSelect }),
    [items, columnCount, onPlay, selectMode, selectedIds, onToggleSelect],
  );

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {size.width > 0 && size.height > 0 && (
        <Grid<VideoGridCellData>
          gridRef={gridRef}
          cellComponent={VideoGridCell}
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

function VideoGridCell({
  columnIndex,
  rowIndex,
  style,
  items,
  columnCount,
  onPlay,
  selectMode,
  selectedIds,
  onToggleSelect,
}: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  items: VideoShelfItem[];
  columnCount: number;
  onPlay: (video: VideoShelfItem) => void;
  selectMode: boolean;
  selectedIds: Set<number>;
  onToggleSelect?: (video: VideoShelfItem) => void;
} & { ariaAttributes: { "aria-colindex": number; role: "gridcell" } }): React.JSX.Element | null {
  const index = rowIndex * columnCount + columnIndex;
  const video = items[index];
  if (!video) return null;

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
      <VideoCard
        video={video}
        onPlay={onPlay}
        selectMode={selectMode}
        selected={selectedIds.has(video.ID)}
        onToggleSelect={onToggleSelect}
      />
    </div>
  );
}
