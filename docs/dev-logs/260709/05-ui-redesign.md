# 开发日志 — 2026-07-09 — UI 重构 — 璀璨黑配色与搜索页重构

## UI 变更 — 璀璨黑配色与搜索页重构

### 移除 StatusBar

- 删除 `src/components/layout/status-bar.tsx` 组件文件
- 从 `src/app/layout.tsx` 中移除 `StatusBar` 导入和渲染
- 移除 `.status-bar`、`.status-bar-left`、`.status-bar-right`、`.status-indicator`、`.status-dot` 等相关 CSS 样式（保留在 CSS 中以备将来使用）

### Sidebar Logo 居中

修改 `.sidebar-header` CSS：
- 添加 `text-align: center`
- 使用 `display: flex; flex-direction: column; align-items: center; justify-content: center;` 实现完全居中
- Logo 字号从 28px 增大至 30px

### 璀璨黑配色系统

将全站 Accent 配色从 Indigo（`#4f46e5`）迁移至璀璨黑（Brilliant Black）：

| 变量 | 旧值 (Indigo) | 新值 (璀璨黑) |
|---|---|---|
| `--accent` | `#4f46e5` | `#0f0f1a` |
| `--accent-hover` | `#4338ca` | `#050508` |
| `--accent-light` | `#6366f1` | `#2a2a3e` |
| `--accent-soft` | `#eef2ff` | `rgba(15, 15, 26, 0.06)` |
| `--accent-glow` | `rgba(79, 70, 229, 0.16)` | `rgba(15, 15, 26, 0.12)` |
| `--accent-shimmer` | — | `linear-gradient(135deg, #0a0a12, #1a1a2e, #2a2a3e, #0a0a12)` |

影响的交互元素：
- **Logo**：使用 `--accent-shimmer` 金属黑渐变
- **导航项 active**：背景改为璀璨黑，文字反白
- **导航项 hover**：使用 `--accent-soft` 轻微黑色着色
- **按钮 primary**：璀璨黑背景 + 边框
- **按钮 outline hover**：边框和文字变为黑色调
- **快捷链接图标**：背景改为璀璨黑，图标反白
- **Pill active**：璀璨黑背景
- **下拉选项 hover/selected**：璀璨黑配色
- **进度条填充**：璀璨黑
- **嗅探结果 hover**：添加 `--accent-soft` 背景

### 搜索页面全屏重构

将搜索页面从传统的卡片+表格布局重构为**全屏视频画廊**：

**布局结构**：
```
┌─────────────────────────────────────────────────┐
│  悬浮搜索栏 (sticky, glass)                       │
│  ┌─────────────────────────────┐ ┌────────┐     │
│  │ 🔍 搜索输入框                │ │ 搜索   │     │
│  └─────────────────────────────┘ └────────┘     │
│  站点选择 Pills · 进度信息 · 进度条               │
├─────────────────────────────────────────────────┤
│  视频画廊 (auto-fill grid, 280px min)            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐           │
│  │ 缩略图 │ │ 缩略图 │ │ 缩略图 │ │ 缩略图 │           │
│  │ 标题   │ │ 标题   │ │ 标题   │ │ 标题   │           │
│  └──────┘ └──────┘ └──────┘ └──────┘           │
│  ┌──────┐ ┌──────┐ ...                          │
└─────────────────────────────────────────────────┘
```

**关键实现**：
- `.search-page` 使用 `margin: calc(-1 * var(--space-6)) calc(-1 * var(--space-8))` 突破 `content-area` 内边距，实现全屏
- `.search-floating-bar` 使用 `position: sticky; top: 0` 实现悬浮固定
- `.search-gallery-grid` 使用 `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))` 响应式网格
- 搜索栏支持 Enter 键提交
- 搜索结果使用 `flatMap` 展平所有关键词的视频项为一个列表

### 视频卡片悬浮 16x 预览

新增 `src/components/search/video-card.tsx` 组件：

**功能**：
- 默认显示封面图（`coverUrl`）
- 鼠标悬浮时，若 `m3u8Url` 可用，使用 hls.js 加载 M3U8 流并以 **16x 倍速** 播放预览
- 鼠标移开时，销毁 HLS 实例并清理视频元素
- 悬浮时显示半透明遮罩 + 播放图标 / 加载动画 / 错误图标

**技术实现**：
- hls.js 从 npm 依赖改为 **本地 vendor 文件**（`public/vendor/hls.min.js`），通过 `<script>` 标签在 `layout.tsx` 中全局加载
- 组件内通过 `window.Hls` 全局对象获取 HLS 实例，不再 `import Hls from "hls.js"`
- Safari 使用原生 HLS 支持（`video.canPlayType("application/vnd.apple.mpegurl")`）
- 其他浏览器使用 `Hls.isSupported()` + `hls.attachMedia()`
- HLS 配置优化为低延迟预览模式：`maxBufferLength: 2, liveSyncDuration: 1, lowLatencyMode: true`
- `video.playbackRate = 16` 实现 16 倍速预览
- `useRef` 管理 HLS 实例和 video 元素，`useCallback` 优化事件处理

**CSS 交互**：
- 默认显示 `<img>`，隐藏 `<video>`
- `:hover` 时切换显示：隐藏 `<img>`，显示 `<video>`
- 卡片悬浮上浮 4px + 阴影增强 + 边框高亮

---


---

## 前端变更

### 搜索页面（`/search`）

- **重构为全屏画廊布局**：移除 `page-container` 和 `card` 包裹，使用 `search-page` 全屏布局
- **悬浮搜索栏**：sticky 定位，玻璃效果背景，包含搜索输入 + 站点选择 + 进度信息
- **视频卡片网格**：响应式 `auto-fill` 布局，每张卡片显示缩略图 + 标题 + 状态
- **16x 悬浮预览**：基于 hls.js，鼠标悬浮自动播放 M3U8 流
- **搜索日志**：当无视频结果但有日志时，显示滚动日志面板
- **最近搜索**：无活跃任务时显示最近搜索记录表格

### WebSocket 修复

- `socket-store.ts`：添加完整重连配置和事件监听
- `task-store.ts`：新增 `subscribeToSocket()` 方法，页面挂载时订阅进度事件
- `status-bar.tsx`：已删除（StatusBar 组件移除）
- `server.ts`：下载管理器初始化改为 `async import` + 重试机制
- `socket.ts`：添加 `pingInterval`/`pingTimeout` 心跳配置

---
