# 图包详情全屏模态框重构

## 概述

将图包详情从内联展开面板重构为全屏模态框覆盖层，新增返回导航按钮与全量预览图展示。同时解决了透明背景、侧边栏遮挡、侧边栏折叠状态适配三个问题。

## 修改清单

### 1. 全屏模态框重构

**文件**: `src/app/gallery/page.tsx`

**变更**: `GalleryDetailPanel` 组件从 `grid-column: 1 / -1` 的内联展开面板重构为 `position: fixed` 的全屏覆盖层。

**之前**（内联展开）:
```tsx
<div style={{
  gridColumn: "1 / -1",
  background: "var(--bg-card)",
  border: "1px solid var(--accent)",
  borderRadius: "var(--radius-md)",
  overflow: "hidden",
}}>
```

**之后**（全屏覆盖）:
```tsx
<div style={{
  position: "fixed",
  top: 0,
  left: sidebarCollapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
  right: 0,
  bottom: 0,
  zIndex: 300,
  background: "var(--bg-base)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
}}>
```

**结构**:
- 顶部导航栏（`flexShrink: 0`）：返回按钮 + 标题 + 操作按钮
- 可滚动内容区（`flex: 1, overflow: auto`）：图包信息 + 图片网格

---

### 2. 返回导航按钮

**文件**: `src/app/gallery/page.tsx`

**变更**: 在顶部导航栏左侧新增返回按钮，使用 `ArrowLeft` 图标。

```tsx
<button className="btn btn-outline btn-sm" onClick={onClose}
  style={{ display: "flex", alignItems: "center", gap: 6 }}>
  <ArrowLeft size={16} />
  返回
</button>
```

同时移除了原有的右上角 `X` 关闭按钮，统一使用返回按钮关闭详情。

---

### 3. 全量预览图展示

**文件**: `src/app/gallery/page.tsx`

**变更**:
- 移除 `images.slice(0, 50)` 的截断限制，显示全部图片
- 移除 `maxHeight: 300` 的固定高度限制
- 网格列宽从 `minmax(100px, 1fr)` 调整为 `minmax(120px, 1fr)`
- 移除"+N"溢出指示器

---

### 4. 透明背景修复

**文件**: `src/app/gallery/page.tsx`

**问题**: 全屏面板使用 `var(--bg-primary)` 作为背景色，但该 CSS 变量不存在，导致背景透明，能看到底层页面内容。

**修复**: 改用 `var(--bg-base)`（`#f0f4f8`，不透明）。顶部导航栏使用 `var(--bg-card)` 保持卡片质感。

---

### 5. 侧边栏折叠状态适配

**文件**: `src/hooks/use-sidebar-collapsed.ts`（新增）、`src/components/layout/sidebar.tsx`、`src/app/gallery/page.tsx`、`src/hooks/index.ts`

**问题**: 全屏面板使用 `left: var(--sidebar-width)` 固定偏移，未考虑侧边栏折叠后宽度从 240px 变为 64px 的情况。

**方案**: 新增 `useSidebarCollapsed` Hook，通过自定义事件实时监听侧边栏状态变化。

#### Hook 实现

```typescript
export function useSidebarCollapsed(): boolean {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  useEffect(() => {
    // 监听 localStorage 变化（跨标签页）
    const handleStorage = (e: StorageEvent) => { ... };
    // 监听折叠/展开切换
    const handleCustom = (e: Event) => { ... };
    // 监听 hover-expand 悬停展开
    const handleHover = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === 'boolean') {
        setCollapsed(!detail); // hover-expand 时视为非折叠
      }
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('sidebar:collapsed', handleCustom);
    window.addEventListener('sidebar:hover-expand', handleHover);
    ...
  }, []);

  return collapsed;
}
```

#### Sidebar 事件派发

在 `sidebar.tsx` 的三个状态变更点派发自定义事件：

| 触发时机 | 事件名 | detail |
|---------|--------|--------|
| `toggleCollapsed` 切换折叠 | `sidebar:collapsed` | `true/false` |
| `handleMouseEnter` 悬停展开 | `sidebar:hover-expand` | `true` |
| `handleMouseLeave` 悬停收起 | `sidebar:hover-expand` | `false` |

#### 前端消费

```tsx
const sidebarCollapsed = useSidebarCollapsed();

<div style={{
  left: sidebarCollapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
  ...
}}>
```

**三种状态适配**:
- 展开 → `left: 240px`
- 折叠 → `left: 64px`
- 折叠 + 悬停展开 → `left: 240px`（与展开一致）

---

### 6. 术语统一：图库 → 图包

**文件**: `src/app/gallery/page.tsx`、`src/components/layout/sidebar.tsx`

**变更**: 全应用范围内将"图库"更名为"图包"。

| 位置 | 之前 | 之后 |
|------|------|------|
| 侧边栏导航 | 图库 | 图包架 |
| 页面标题 | 图库管理页面 | 图包管理页面 |
| 详情标题 | 图库详情 #N | 图包详情 #N |
| 删除确认 | 确认删除图库 #N？ | 确认删除图包 #N？ |
| 空状态 | 暂无图库 | 暂无图包 |
| Toast 消息 | 图库 #N 下载已重新启动 | 图包 #N 下载已重新启动 |

---

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/app/gallery/page.tsx` | 全屏模态框重构；返回按钮；全量预览图；透明背景修复；侧边栏适配；术语更名 |
| `src/hooks/use-sidebar-collapsed.ts` | 新增：监听侧边栏折叠/展开/hover-expand 状态 |
| `src/hooks/index.ts` | 新增 useSidebarCollapsed 导出 |
| `src/components/layout/sidebar.tsx` | 派发 sidebar:collapsed 和 sidebar:hover-expand 事件；导航项更名 |

---

## 验证结果

| 验证项 | 状态 |
|--------|------|
| Lint 检查 | ✅ 无错误 |
| 全屏覆盖 | ✅ 不透明背景，无底层穿透 |
| 侧边栏展开 | ✅ left: 240px，不遮挡 |
| 侧边栏折叠 | ✅ left: 64px，宽度自适应 |
| 侧边栏 hover-expand | ✅ 悬停时 left: 240px，移出后恢复 64px |
| 返回按钮 | ✅ 正常关闭详情面板 |
| 全量预览图 | ✅ 不再截断，全部展示 |
| 术语统一 | ✅ 全应用显示"图包" |

---

## 时间戳

- 开发与测试: 2026-07-13
- 作者: PuchiPix Team
