# 开发日志 — 2026-07-11 — 功能四：爱妹子搜索缩略图修复 + 图库站点禁用悬浮预览

## 功能四：爱妹子搜索缩略图修复 + 图库站点禁用悬浮预览

### 问题背景

爱妹子站点搜索后无法显示卡片缩略图，且作为以图片为主的写真站点，鼠标悬浮触发的 HLS 倍速预览功能无意义且浪费资源。

### 根因分析

#### 缩略图不显示

`AimeiziziProvider.extractSearchResults` 中提取封面图 URL 时存在两个问题：

1. **相对路径未解析**：`data-src`、`data-original`、`src` 属性值可能是相对路径（如 `/wp-content/uploads/...`），前端 `<img>` 标签会相对于 PuchiPix 应用本身解析，而非爱妹子站点，导致 404
2. **占位图未过滤**：懒加载场景下 `src` 为占位 GIF（`/static/zde/timg.gif`）或加载占位图（`/static/images/Loading`），这些 URL 被错误地用作封面

#### 悬浮预览无意义

`VideoCard` 组件对所有站点统一启用 HLS 悬浮倍速预览。爱妹子是图库站点，内容以图片为主，悬浮预览会触发不必要的 `/api/preview` 请求和 HLS.js 加载。

### 修复方案

#### 4.1 缩略图 URL 解析修复（`aimeizizi-provider.ts`）

在 `extractSearchResults` 的 `page.evaluate` 内新增 `resolveUrl` 辅助函数：

- 使用 `new URL(raw, window.location.href).href` 将相对路径解析为绝对路径
- 过滤占位 GIF（`/static/zde/timg.gif`）、加载占位图（`/static/images/Loading`）、data URI

#### 4.2 封面图防盗链修复（`video-card.tsx`）

给封面 `<img>` 标签添加 `referrerPolicy="no-referrer"`，避免爱妹子 CDN 的 Referer 校验拦截。

#### 4.3 图库站点标识（`types.ts` + `site-registry.ts`）

在 `SiteInfo` 接口新增 `gallery?: boolean` 字段。`SiteRegistry` 通过检测 provider 是否实现 `GallerySiteProvider` 接口（即是否拥有 `scrapeGallery` 方法）来自动设置该标志。

#### 4.4 图库模式禁用悬浮预览（`video-card.tsx` + `search/page.tsx`）

- `VideoCardProps` 新增 `gallery` 属性
- `gallery=true` 时：不绑定 `onMouseEnter`/`onMouseLeave` 事件，完全跳过 HLS 预览逻辑
- 搜索页面将 `selectedSite.gallery` 传递给每个 `VideoCard`
- 更新结果栏文案：图库站点显示"图库"而非"视频"，且不显示"悬浮可 8x 倍速预览"提示

### 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/sites/providers/aimeizizi-provider.ts` | 修改 | `extractSearchResults` 新增 `resolveUrl` 函数，解析相对路径、过滤占位图 |
| `src/lib/sites/types.ts` | 修改 | `SiteInfo` 新增 `gallery?: boolean` 字段 |
| `src/lib/sites/site-registry.ts` | 修改 | `getSiteInfos`/`getEnabledSiteInfos` 自动检测 gallery provider |
| `src/components/search/video-card.tsx` | 修改 | 新增 `gallery` prop，禁用 HLS 预览，封面图添加 `referrerPolicy` |
| `src/app/search/page.tsx` | 修改 | 传递 `gallery` 标志，更新文案 |

### 验证结果

- TypeScript 编译：0 错误
- ESLint：0 错误

---
