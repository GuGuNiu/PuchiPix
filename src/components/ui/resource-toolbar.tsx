"use client";

/**
 * 资源/任务管理 共用顶部工具栏（复合组件）
 *
 * 由以下可组合的子部件构成：
 * - FilterCapsule：分段胶囊筛选器（可选两组：primary + secondary）
 * - SearchBox：搜索输入框
 * - SortSelect：排序下拉选择
 * - ToolbarActions：右侧操作按钮区（自定义 children）
 *
 * 两个页面共享同一套视觉语言（seg-capsule 风格），
 * 通过 props 控制各子部件的显隐和内容。
 *
 */

import { Search as SearchIcon, RefreshCw } from "lucide-react";
import GlassSelect from "./glass-select";

export interface FilterPill {
  value: string;
  label: string;
  /** 可选的计数徽标 */
  count?: number;
}

export interface SortOption {
  value: string;
  label: string;
}

interface ResourceToolbarProps {
  /** 主筛选胶囊（如 Tasks 的类型筛选，Gallery 的状态筛选） */
  primaryFilters?: FilterPill[];
  primaryFilterValue?: string;
  onPrimaryFilterChange?: (value: string) => void;

  /** 次筛选胶囊（如 Tasks 的状态筛选），如不需要则省略 */
  secondaryFilters?: FilterPill[];
  secondaryFilterValue?: string;
  onSecondaryFilterChange?: (value: string) => void;

  /** 搜索框 */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  /** 排序下拉 */
  sortOptions?: SortOption[];
  sortValue?: string;
  onSortChange?: (value: string) => void;

  /** 右侧操作区（按钮等自定义内容） */
  children?: React.ReactNode;

  /** 刷新回调（提供时显示刷新按钮） */
  onRefresh?: () => void;

  /** 刷新按钮文本 */
  refreshLabel?: string;
}

/** 分段胶囊筛选器 */
function FilterCapsule({
  pills,
  value,
  onChange,
  wrap = false,
}: {
  pills: FilterPill[];
  value: string;
  onChange: (v: string) => void;
  wrap?: boolean;
}): React.JSX.Element {
  return (
    <div className="seg-capsule" style={wrap ? { flexWrap: "wrap" } : { flexShrink: 0 }}>
      {pills.map((pill) => (
        <button
          key={pill.value}
          className={`seg-capsule-item ${value === pill.value ? "active" : ""}`}
          onClick={() => onChange(pill.value)}
        >
          {pill.label}
          {pill.count !== undefined && (
            <span style={{ marginLeft: 4, opacity: 0.7, fontSize: 11 }}>
              {pill.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** 搜索输入框 */
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}): React.JSX.Element {
  return (
    <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
      <SearchIcon
        size={14}
        style={{
          position: "absolute",
          left: 10,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--text-muted)",
          pointerEvents: "none",
        }}
      />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "6px 12px 6px 32px",
          fontSize: 13,
          height: 32,
          boxSizing: "border-box",
          background: "var(--bg-inset)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          color: "var(--text-primary)",
          outline: "none",
        }}
      />
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
  searchPlaceholder = "搜索...",
  sortOptions,
  sortValue,
  onSortChange,
  children,
  onRefresh,
  refreshLabel = "刷新",
}: ResourceToolbarProps): React.JSX.Element {
  return (
    <div className="tasks-toolbar">
      {primaryFilters && onPrimaryFilterChange && (
        <FilterCapsule
          pills={primaryFilters}
          value={primaryFilterValue || ""}
          onChange={onPrimaryFilterChange}
        />
      )}

      {secondaryFilters && onSecondaryFilterChange && (
        <FilterCapsule
          pills={secondaryFilters}
          value={secondaryFilterValue || ""}
          onChange={onSecondaryFilterChange}
          wrap
        />
      )}

      {onSearchChange && (
        <SearchBox
          value={searchValue || ""}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
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
