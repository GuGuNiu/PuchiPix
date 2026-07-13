# 任务管理页面 UI 优化

## 概述

对任务管理页面（`/tasks`）进行了系统性 UI 优化，涵盖进度条结构重构、分片/数量展示升级为双拼色胶囊、来源/状态列圆角与宽度微调，以及文件大小列数据错误修复。

## 修改清单

### 1. 进度条纵向重构

**文件**: `src/app/tasks/page.tsx`

**变更**: 进度条从横排（数字在右、条在左）改为上下纵向结构——百分比数字在上方，进度条在下方。

```tsx
<td>
  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 70 }}>
    <span style={{
      fontSize: 11, fontWeight: 600,
      color: "var(--text-secondary)",
      whiteSpace: "nowrap", lineHeight: "16px",
      fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, monospace",
    }}>
      {isIdentifying ? stage : progressPct}
    </span>
    <div className="progress-bar" style={{ width: "100%" }}>
      <div
        className={`progress-bar-fill ${fillClass} ${isIdentifying ? "progress-bar-indeterminate" : ""}`}
        style={isIdentifying ? {} : { width: `${progress}%` }}
      />
    </div>
  </div>
</td>
```

**效果**: 进度百分比与进度条在垂直方向对齐，信息密度更高，视觉层次更清晰。

---

### 2. 双拼色胶囊组件

**文件**: `src/app/styles/components.css`、`src/app/tasks/page.tsx`

**变更**: 分片/数量列从纯文本改为双拼色胶囊（Dual Capsule）。

**CSS 新增**:
```css
.dual-capsule {
  display: inline-flex;
  align-items: center;
  border-radius: 5px;
  overflow: hidden;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  line-height: 20px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.dual-capsule-left  { background: linear-gradient(135deg, #3b82f6, #2563eb); color: #fff; padding: 1px 7px; }
.dual-capsule-right { background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #fff; padding: 1px 7px; }
.dual-capsule-left.accent-green  { background: linear-gradient(135deg, #22c55e, #16a34a); }
.dual-capsule-right.accent-orange { background: linear-gradient(135deg, #f59e0b, #d97706); }
```

**JSX 渲染逻辑**:
- 图库任务：左侧绿色 `{ImageCount}P`，右侧橙色 `{VideoCount}V`
- 视频任务：左侧蓝色 `{Segment}`，右侧紫色 `{TotalSegments}`

---

### 3. 来源/状态列圆角与宽度压缩

**文件**: `src/app/styles/components.css`

**变更**:
- `.badge` 的 `border-radius` 降低为 `5px`
- `.status-pill` 的 `border-radius` 降低为 `5px`

**文件**: `src/app/tasks/page.tsx`

**变更**: 压缩来源列和状态列的 `th` 宽度，增大标题列宽度。

---

### 4. 文件大小列修复

**文件**: `src/app/tasks/page.tsx`、`src/app/api/tasks/route.ts`、`src/types/index.ts`

**问题**: 图库任务的"文件大小"列显示的是 `FilePath` 路径末尾的文件夹名，而非实际文件大小。

**根因**: 
1. 渲染逻辑优先取 `FilePath.split(/[/\\]/).pop()`，未使用 `DownloadInfo` 中的 `ActualSize`
2. API 层 `mapGalleryToTask` 中 `actualSize` 字段为 Prisma 返回的 `BigInt` 类型，直接赋值给 `number` 导致 JSON 序列化失败，API 返回 500

**修复**:

*API 层*（`src/app/api/tasks/route.ts`）:
```typescript
ActualSize: Number(g.downloadInfo.actualSize), // BigInt → number
```

*类型定义*（`src/types/index.ts`）:
```typescript
export interface DownloadTask {
  // ...
  DownloadInfo?: GalleryDownloadInfoData;
}
```

*前端渲染*（`src/app/tasks/page.tsx`）:
```tsx
{isGallery ? (
  task.DownloadInfo?.ActualSize && task.DownloadInfo.ActualSize > 0
    ? formatFileSize(task.DownloadInfo.ActualSize)
    : task.DownloadInfo?.FileSizeText
      ? task.DownloadInfo.FileSizeText
      : task.FilePath
        ? task.FilePath.split(/[/\\]/).pop() || "—"
        : "—"
) : task.VideoInfo?.FileSize ? (
  `${(task.VideoInfo.FileSize / 1024 / 1024).toFixed(1)} MB`
) : "—"}
```

新增 `formatFileSize` 辅助函数：
```typescript
function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
```

**优先级链**: `ActualSize`（数值）→ `FileSizeText`（文本）→ `FilePath` 末尾名称 → `—`

---

### 5. 任务详情展开区优化

**文件**: `src/app/tasks/page.tsx`

**变更**:
- 图库任务的图片数量、视频数量、下载方式合并为单行展示
- 移除"分类"字段显示
- 标签从 `GalleryTitle` 解析（按空格/逗号/连字符分割，过滤 `NP` 格式）
- 视频任务标签区保持原有 `VideoInfo.Tags` 逻辑

---

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/app/tasks/page.tsx` | 进度条纵向重构；双拼色胶囊渲染；文件大小列修复；详情展开区优化 |
| `src/app/styles/components.css` | badge/status-pill 圆角降低；新增 dual-capsule 样式 |
| `src/types/index.ts` | DownloadTask 新增 DownloadInfo 字段 |
| `src/app/api/tasks/route.ts` | mapGalleryToTask 中 BigInt → Number 转换 |

---

## 验证结果

| 验证项 | 状态 |
|--------|------|
| Lint 检查 | ✅ 无错误 |
| API /api/tasks | ✅ 500 错误已修复 |
| 进度条渲染 | ✅ 纵向结构正常 |
| 双拼色胶囊 | ✅ 图库/视频两种配色正确 |
| 文件大小显示 | ✅ 优先显示数值大小 |

---

## 时间戳

- 开发与测试: 2026-07-13
- 作者: PuchiPix Team
