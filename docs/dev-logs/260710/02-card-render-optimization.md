# 开发日志 — 2026-07-10 — 搜索页视频卡片渲染优化

## 搜索页视频卡片渲染优化

### 问题背景

搜索页面在搜索结果不超过 30 个视频卡片时仍出现严重卡顿。根本原因是父组件状态变化（如单个卡片状态更新）导致所有 `VideoCard` 组件全量重渲染，每个卡片内部的 HLS 预览逻辑、定时器、网络请求等被不必要地重新执行。

### 解决方案

**三层优化策略：**

1. **`React.memo` + 自定义比较函数**：对 `VideoCard` 组件进行 memo 包裹，并提供精确的 props 比较逻辑，仅在 `pageUrl`、`status`、`title`、`m3u8Url`、`taskId`、`coverUrl`、`index` 发生变化时才触发重渲染。

2. **CSS `contain: content`**：为卡片根 `div` 添加 `style={{ contain: 'content' }}`，告诉浏览器该元素的布局和绘制独立于文档其他部分，减少重排重绘范围。

3. **`useCallback` 稳定化**：卡片内部所有事件处理函数（`cleanupPreview`、`fetchPreviewUrl`、`playM3U8`、`handleMouseEnter`、`handleMouseLeave`）均使用 `useCallback` 稳定化引用，避免因函数引用变化触发子组件重渲染。

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/components/search/video-card.tsx` | 导入 `memo`；用 `memo(VideoCardImpl, comparator)` 包裹组件导出；添加 `contain: content` |

**自定义比较函数：**

```typescript
const VideoCard = memo(VideoCardImpl, (prev, next) => {
  return (
    prev.item.pageUrl === next.item.pageUrl &&
    prev.item.status === next.item.status &&
    prev.item.title === next.item.title &&
    prev.item.m3u8Url === next.item.m3u8Url &&
    prev.item.taskId === next.item.taskId &&
    prev.item.coverUrl === next.item.coverUrl &&
    prev.index === next.index
  );
});
```

---
