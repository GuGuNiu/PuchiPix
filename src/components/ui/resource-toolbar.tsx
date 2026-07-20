"use client";



import { Search as SearchIcon, RefreshCw, Layers, Film, Image, Wifi } from "lucide-react";
import GlassSelect from "./glass-select";

export interface FilterPill {
  value: string;
  label: string;
  count?: number;
}

export interface SortOption {
  value: string;
  label: string;
}

export interface PrimaryFilterPill extends FilterPill {
  icon?: "layers" | "film" | "image" | "wifi";
}

interface ResourceToolbarProps {
  primaryFilters?: PrimaryFilterPill[];
  primaryFilterValue?: string;
  onPrimaryFilterChange?: (value: string) => void;

  secondaryFilters?: FilterPill[];
  secondaryFilterValue?: string;
  onSecondaryFilterChange?: (value: string) => void;

  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  sortOptions?: SortOption[];
  sortValue?: string;
  onSortChange?: (value: string) => void;

  children?: React.ReactNode;

  onRefresh?: () => void;

  refreshLabel?: string;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  layers: <Layers size={14} />,
  film: <Film size={14} />,
  image: <Image size={14} />,
  wifi: <Wifi size={14} />,
};

function UnifiedFilterBar({
  primaryPills,
  primaryValue,
  onPrimaryChange,
  secondaryPills,
  secondaryValue,
  onSecondaryChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
}: {
  primaryPills: PrimaryFilterPill[];
  primaryValue: string;
  onPrimaryChange: (v: string) => void;
  secondaryPills: FilterPill[];
  secondaryValue: string;
  onSecondaryChange: (v: string) => void;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
}): React.JSX.Element {
  return (
    <div className="unified-filter-bar">
      <div className="unified-filter-group">
        {primaryPills.map((pill) => (
          <button
            key={pill.value}
            className={`unified-filter-item ${primaryValue === pill.value ? "active" : ""}`}
            onClick={() => onPrimaryChange(pill.value)}
            title={pill.label}
          >
            {pill.icon && <span className="unified-filter-icon">{ICON_MAP[pill.icon]}</span>}
            <span className="unified-filter-label">{pill.label}</span>
            {pill.count !== undefined && (
              <span className="unified-filter-count">{pill.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="unified-filter-divider" />

      {onSearchChange && (
        <div className="unified-filter-search">
          <SearchIcon size={12} className="unified-filter-search-icon" />
          <input
            type="text"
            placeholder={searchPlaceholder || ""}
            value={searchValue || ""}
            onChange={(e) => onSearchChange(e.target.value)}
            className="unified-filter-search-input"
          />
        </div>
      )}

      <div className="unified-filter-divider" />

      <div className="unified-filter-group">
        {secondaryPills.map((pill) => (
          <button
            key={pill.value}
            className={`unified-filter-item ${secondaryValue === pill.value ? "active" : ""}`}
            onClick={() => onSecondaryChange(pill.value)}
          >
            <span className="unified-filter-label">{pill.label}</span>
            {pill.count !== undefined && (
              <span className="unified-filter-count">{pill.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ResourceToolbar({
  primaryFilters,
  primaryFilterValue,
  onPrimaryFilterChange,
  secondaryFilters,
  secondaryFilterValue,
  onSecondaryFilterChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = "",
  sortOptions,
  sortValue,
  onSortChange,
  children,
  onRefresh,
  refreshLabel = "",
}: ResourceToolbarProps): React.JSX.Element {
  return (
    <div className="tasks-toolbar">
      {primaryFilters && onPrimaryFilterChange && secondaryFilters && onSecondaryFilterChange && (
        <UnifiedFilterBar
          primaryPills={primaryFilters}
          primaryValue={primaryFilterValue || ""}
          onPrimaryChange={onPrimaryFilterChange}
          secondaryPills={secondaryFilters}
          secondaryValue={secondaryFilterValue || ""}
          onSecondaryChange={onSecondaryFilterChange}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          searchPlaceholder={searchPlaceholder}
        />
      )}

      {sortOptions && onSortChange && (
        <div style={{ minWidth: 130 }}>
          <GlassSelect
            options={sortOptions}
            value={sortValue || ""}
            onChange={onSortChange}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
        {onRefresh && (
          <button className="btn btn-outline btn-sm" onClick={onRefresh}>
            <RefreshCw size={14} />
            {refreshLabel}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
