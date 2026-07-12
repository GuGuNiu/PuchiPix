# 开发日志 — 2026-07-10 — 第六轮迭代 — Turbopack 崩溃修复 + 倍速预览全链路打通

## 第六轮迭代 — Turbopack 崩溃修复 + 倍速预览全链路打通

### 问题背景

第一轮迭代中修复了 HLS.js 加载时机问题（`defer` → `async` + `waitForHls` 轮询），但实际测试中发现倍速预览仍然无法播放。复盘后定位到三个此前未发现的深层问题：Turbopack 崩溃导致页面返回 500、预览 API 被 Cloudflare 拦截、CDN 的 Referer 校验导致 m3u8/ts 请求 403。

### Bug 12: Turbopack 处理 Tailwind CSS v4 崩溃

**现象：**

服务启动后，页面路由（`/`、`/tasks`、`/search`、`/history`）全部返回 500，日志中出现 Turbopack panic：

```
FATAL: An unexpected Turbopack error occurred.
Failed to write app endpoint /search/page
Caused by:
- [project]/src/app/globals.css [app-client] (css)
- failed to receive message
- reading packet length
- 远程主机强迫关闭了一个现有的连接。(os error 10054)
```

**根因：**

Next.js 16.2.6 的 Turbopack 在处理 `@tailwindcss/postcss` v4 插件时触发 panic。Turbopack 的 PostCSS 集成与 Tailwind CSS v4 的原生 PostCSS 插件不兼容，导致 PostCSS worker 进程崩溃（os error 10054 = 连接被强制关闭）。

**修复：**

在 `server.ts` 中移除 `turbopack: dev` 选项，改用 Webpack 编译器：

```typescript
// 修改前
const app = next({ dev, turbopack: dev });

// 修改后
const app = next({ dev });
```

同时清理被 Turbopack 崩溃污染的 `.next` 缓存目录。

### Bug 13: next.config.ts eslint 废弃配置警告

**现象：**

启动时输出警告：

```
⚠ `eslint` configuration in next.config.ts is no longer supported.
⚠ Unrecognized key(s) in object: 'eslint'
```

**根因：**

Next.js 16 移除了 `next.config.ts` 中的 `eslint` 配置键支持。

**修复：**

移除 `next.config.ts` 中的 `eslint: { ignoreDuringBuilds: true }` 配置块。

### Bug 14: video-card.tsx JSX 语法错误

**现象：**

Webpack 编译时报错：

```
./src/components/search/video-card.tsx:400:7
Expression expected
  398 |       onMouseLeave={handleMouseLeave}
  399 |       style={{ contain: 'content' }}
> 400 |       <div className="video-card-thumb">
```

**根因：**

在第一轮迭代中为 `<div>` 添加 `style={{ contain: 'content' }}` 属性时遗漏了 `>` 闭合开标签。

**修复：**

补全 `>` 闭合标签：

```tsx
// 修改前
<div
  className="video-card"
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
  style={{ contain: 'content' }}
  <div className="video-card-thumb">

// 修改后
<div
  className="video-card"
  onMouseEnter={handleMouseEnter}
  onMouseLeave={handleMouseLeave}
  style={{ contain: 'content' }}
>
  <div className="video-card-thumb">
```

### Bug 15: /api/preview 被 Cloudflare 拦截（500）

**现象：**

悬浮视频卡片时，前端请求 `POST /api/preview` 返回 500，控制台报错：

```
POST http://localhost:10540/api/preview 500 (Internal Server Error)
```

服务端日志：`{"error":"fetch failed"}`

**根因：**

`/api/preview` 使用 Node.js 原生 `fetch` 直接请求 `kanav.ad` 视频页面。`kanav.ad` 使用 Cloudflare 防护，Cloudflare 通过 TLS 指纹检测识别出 Node.js `fetch` 不是真实浏览器，拒绝连接（`ECONNRESET`）。

验证：
```
node -e "fetch('https://kanav.ad/')..."
// Error: fetch failed
// Cause: read ECONNRESET
// Code: ECONNRESET
```

**修复：**

将 `/api/preview` 重构为双策略架构：

1. **快速路径**：Node.js `fetch` 获取页面 HTML，正则提取 `player_aaaa` 中的 m3u8 URL（<1 秒）
2. **回退路径**：`fetch` 失败时（ECONNRESET / 超时 / DNS 错误），延迟导入 `Scraper`，使用 Playwright 真实浏览器爬取页面（~10 秒），绕过 Cloudflare TLS 指纹检测

```typescript
// 策略 1：快速 fetch
const res = await fetch(url, { ... });
if (res.ok) {
  const m3u8Url = extractM3U8FromHtml(html);
  if (m3u8Url) return NextResponse.json({ m3u8_url: m3u8Url });
}

// 策略 2：Playwright 回退
const m3u8Url = await scrapeM3U8WithPlaywright(url);
```

同时修改前端 `video-card.tsx`：

- 预览 URL 获取失败时不显示 `XCircle` 错误图标，静默保持封面图
- 新增 `previewFailCache`（30 秒 TTL），避免鼠标反复悬浮时重复请求同一 URL
- 请求超时从 8 秒延长到 25 秒，适配 Playwright 回退耗时

### Bug 16: CDN m3u8/ts 请求被 Referer 校验拦截（403）

**现象：**

`/api/preview` 成功返回 m3u8 URL 后，HLS.js 直接请求该 URL 仍返回 403：

```
GET https://cdn.11yun.space/DAV1/330183/330183.m3u8 → 403 Forbidden
```

**根因：**

CDN（`cdn.11yun.space`）校验 `Referer` 头，要求为来源站点（`https://kanav.ad/`）。浏览器中 HLS.js 发请求时 `Referer` 是 `http://localhost:10540`，被 CDN 拒绝。

验证：
```
// 不带 Referer → 403
fetch('https://cdn.11yun.space/DAV1/330183/330183.m3u8') → 403

// 带正确 Referer → 200
fetch('https://cdn.11yun.space/DAV1/330183/330183.m3u8', {
  headers: { Referer: 'https://kanav.ad/', Origin: 'https://kanav.ad/' }
}) → 200
```

**修复：**

新建 `/api/proxy` HLS 代理端点，服务端代理 m3u8 和 ts 请求并添加正确的 `Referer` 头：

1. 接收 `url`（m3u8/ts URL）和 `referer`（来源站点 URL）参数
2. 服务端 `fetch` 时带上 `Referer` 和 `Origin` 头
3. 对 m3u8 响应内容进行 TS 分片路径改写：将相对路径和绝对 URL 都替换为 `/api/proxy?referer=...&url=...` 格式
4. 前端 `toProxyUrl(m3u8Url, pageUrl)` 函数将 m3u8 URL 包装为代理 URL
5. HLS.js 通过代理 URL 加载 m3u8 → 代理返回改写后的播放列表 → HLS.js 通过代理 URL 下载 TS 分片

**m3u8 改写示例：**

```
# 原始 m3u8 内容
#EXTINF:8.408411,
330183_0000.ts

# 代理改写后
#EXTINF:8.408411,
/api/proxy?referer=https%3A%2F%2Fkanav.ad%2F&url=https%3A%2F%2Fcdn.11yun.space%2FDAV1%2F330183%2F330183_0000.ts
```

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/app/api/proxy/route.ts` | HLS 代理 API：代理 m3u8/ts 请求，添加正确 Referer，改写 TS 分片路径 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `server.ts` | 移除 `turbopack: dev`，改用 Webpack 编译器 |
| `next.config.ts` | 移除废弃的 `eslint` 配置块 |
| `src/components/search/video-card.tsx` | 修复 JSX 语法错误（补全 `>`）；`playM3U8` 新增 `pageUrl` 参数；`toProxyUrl` 函数包装代理 URL；预览失败静默处理 + 失败缓存 |
| `src/app/api/preview/route.ts` | 重构为双策略：快速 fetch + Playwright 回退；fetch 失败时日志记录 |

### 倍速预览完整数据流

```
鼠标悬浮视频卡片
  │
  ├─ 防抖 400ms
  │
  ▼
POST /api/preview { url: 视频页面 URL }
  │
  ├─ 策略1: Node.js fetch 获取 HTML（<1s）
  │    └─ 正则提取 player_aaaa.m3u8_url
  │
  ├─ 策略2: Playwright 浏览器爬取（~10s）
  │    └─ Cloudflare 绕过 → 拦截 m3u8 请求
  │
  ▼
返回 m3u8_url
  │
  ▼
Hls.loadSource(toProxyUrl(m3u8_url, pageUrl))
  │
  ▼
GET /api/proxy?referer=kanav.ad&url=cdn.11yun/xxx.m3u8
  │
  ├─ 服务端 fetch 带 Referer: https://kanav.ad/
  ├─ 成功获取 m3u8 内容
  └─ 改写 TS 路径为 /api/proxy?referer=...&url=...
  │
  ▼
HLS.js 解析改写后的 m3u8
  │
  ▼
GET /api/proxy?referer=kanav.ad&url=cdn.11yun/xxx_0000.ts
  │
  ├─ 服务端 fetch 带 Referer: https://kanav.ad/
  └─ 返回 TS 分片数据（video/mp2t）
  │
  ▼
1x 起播 → 缓冲积累 → 自适应提速至 8x
```

### 验证结果

| 验证项 | 验证方式 | 结果 |
|--------|---------|------|
| Turbopack 崩溃 | 启动服务后访问 `/`、`/tasks`、`/search`、`/history` | ✅ 全部返回 200 |
| eslint 警告 | 观察启动日志 | ✅ 无警告 |
| JSX 语法错误 | Webpack 编译 | ✅ 编译通过 |
| /api/preview | 用真实 kanav.ad 视频页面 URL 调用 | ✅ fetch 失败后 Playwright 回退成功，返回 m3u8 URL |
| /api/proxy m3u8 | 代理请求 m3u8 URL | ✅ 返回 200，Content-Type: application/vnd.apple.mpegurl，TS 路径已改写 |
| /api/proxy ts | 代理请求 TS 分片 | ✅ 返回 200，Content-Type: video/mp2t，大小 1.2MB |
| 倍速预览端到端 | 完整数据流验证 | ✅ 全链路打通 |
