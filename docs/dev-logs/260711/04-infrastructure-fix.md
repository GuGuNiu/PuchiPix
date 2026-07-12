# 开发日志 — 2026-07-11 — 功能三：爱妹子模块基础设施接驳修正

## 功能三：爱妹子模块基础设施接驳修正

### 背景

分析发现爱妹子（Gallery）模块与 KanAV（Video）模块完全独立运行，未共享任何核心基础设施。导致以下问题：

1. **TTL 队列锁未使用**：同一 URL 可被并发爬取，无去重保护
2. **EventBus 事件未发布**：前端无法感知图库爬取/下载进度
3. **反爬虫算法不统一**：UA 轮换、指数退避、随机抖动参数不一致
4. **浏览器实例不共享**：gallery route 独立启动 Chromium，浪费资源
5. **翻页无上限保护**：可能被恶意页面触发无限翻页

### 修正内容

#### 3.1 创建共享反爬虫工具模块 `src/lib/core/anti-crawler.ts`

从 `search-engine.ts` 中提取通用的反爬虫算法，统一为全站共享模块：

| 工具 | 说明 |
|------|------|
| `USER_AGENTS` | 5 个真实浏览器 UA（Chrome/Firefox/Safari） |
| `randomUA()` | 随机选择 UA |
| `sleep(ms)` | Promise 延迟 |
| `randomDelay(min, max)` | 随机抖动间隔 |
| `backoffDelay(retry, base, max)` | 指数退避（默认 base=2000, max=16000） |
| `buildAntiCrawlerHeaders(referer?)` | 构建带 UA + Accept-Language + Referer 的请求头 |
| `PAGE_DELAY_MIN/MAX` | 翻页间隔常量（800~1500ms） |
| `BATCH_DELAY_MIN/MAX` | 批量任务间隔常量（3000~5000ms） |
| `MAX_RETRIES` | 最大重试次数（3） |
| `MAX_GALLERY_PAGES` | 图库翻页安全上限（30） |

#### 3.2 创建共享浏览器池 `src/lib/core/browser-pool.ts`

```typescript
export async function getSharedBrowser(): Promise<Browser>
export async function closeSharedBrowser(): Promise<void>
```

- 全局单例，通过 `globalThis` 管理生命周期
- 自动断线重连
- 所有模块（SearchEngine、Gallery API）共享同一 Chromium 实例

#### 3.3 EventBus 事件类型扩展

在 `event-bus.ts` 的 `EventMap` 中新增 7 个图库事件：

| 事件 | 载荷 | 触发时机 |
|------|------|---------|
| `gallery:scrapeStarted` | `{ galleryId, url }` | 开始爬取图库 |
| `gallery:scrapeCompleted` | `{ galleryId, title, imageCount, videoCount }` | 爬取完成 |
| `gallery:scrapeFailed` | `{ galleryId, url, error }` | 爬取失败 |
| `gallery:downloadStarted` | `{ galleryId, total }` | 开始下载 |
| `gallery:downloadProgress` | `{ galleryId, completed, total, failed }` | 下载进度更新 |
| `gallery:downloadCompleted` | `{ galleryId, success, failed, skipped, savePath }` | 下载完成 |
| `gallery:downloadFailed` | `{ galleryId, error }` | 下载失败 |

#### 3.4 修正 `gallery-downloader.ts`

- 接入 `ttlLock`：通过 `gallery:download:{id}` 锁防止同一图库被并发下载
- 接入 `eventBus`：在下载开始、每个文件完成、下载完成时发布事件
- 接入 `backoffDelay`：重试延迟使用共享指数退避算法（base=1000, max=8000）
- 接入 `randomUA`：每次下载请求使用随机 UA
- 新增 `downloading` Set：内存级防重复下载保护
- 下载完成后更新图库状态为 `completed` / `partial` / `failed`

#### 3.5 修正 `aimeizizi-provider.ts`

- 接入 `MAX_GALLERY_PAGES`：`totalPages = Math.min(pageTotal, 30)` 防止无限翻页
- 接入 `randomDelay` + `PAGE_DELAY_MIN/MAX`：翻页间隔使用共享抖动算法
- 接入 `sleep`：替代 `page.waitForTimeout`，与 SearchEngine 一致
- 移除未使用的 `description` 变量和 `resolveUrl` 的 `baseUrl` 参数

#### 3.6 修正 `gallery/route.ts`

- 接入 `getSharedBrowser`：替代独立浏览器实例
- 接入 `ttlLock`：通过 `gallery:scrape:{url}` 锁防止同一 URL 并发爬取
- 接入 `eventBus`：发布 `scrapeStarted` / `scrapeCompleted` / `scrapeFailed` 事件
- 接入 `randomUA` + `DEFAULT_ACCEPT_LANGUAGE`：每次爬取注入随机 UA
- 新增 HTTP 409 响应：当 TTL 锁获取失败时返回 409 Conflict

#### 3.7 修正 `gallery/[id]/download/route.ts`

- 下载冲突时返回 HTTP 409（而非 500）
- TTL 锁和 EventBus 事件由 `GalleryDownloader` 内部统一管理

#### 3.8 修正 `search-engine.ts`

- 移除本地定义的 `USER_AGENTS`、`randomUA`、`sleep`、`randomDelay`、`backoffDelay`
- 改为从 `@/lib/core/anti-crawler` 导入共享实现
- 移除 `MAX_KEYWORD_RETRIES`、`BATCH_TITLE_DELAY_MIN/MAX` 等重复常量
- 统一使用 `MAX_RETRIES`、`BATCH_DELAY_MIN/MAX`

### 修正后的共享矩阵

```
┌─────────────────────────────────────────────────────────┐
│              修正后共享基础设施使用矩阵                    │
├──────────────────┬──────────────┬───────────────────────┤
│ 基础设施          │ KanAV 模块   │ 爱妹子模块             │
├──────────────────┼──────────────┼───────────────────────┤
│ 任务编排器        │ SearchEngine │ gallery/route.ts      │
│ TTL 队列锁        │ ✅ scrape锁  │ ✅ scrape锁+download锁│
│ 反爬虫防御算法    │ ✅ 共享anti-crawler │ ✅ 共享anti-crawler │
│ 动态抖动算法      │ ✅ 共享randomDelay  │ ✅ 共享randomDelay  │
│ EventBus 广播    │ ✅ task/search事件 │ ✅ gallery事件     │
│ 共享浏览器池      │ (待迁移)     │ ✅ getSharedBrowser   │
│ BaseSiteProvider │ ✅ 继承      │ ✅ 继承               │
└──────────────────┴──────────────┴───────────────────────┘
```

### 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/core/anti-crawler.ts` | 新增 | 共享反爬虫工具模块 |
| `src/lib/core/browser-pool.ts` | 新增 | 共享浏览器池 |
| `src/lib/core/index.ts` | 修改 | 导出新模块 |
| `src/lib/core/event-bus.ts` | 修改 | 新增 7 个 gallery 事件类型 |
| `src/lib/downloader/gallery-downloader.ts` | 重写 | 接入 TTL 锁、EventBus、共享退避 |
| `src/lib/sites/providers/aimeizizi-provider.ts` | 修改 | 接入共享抖动、翻页上限 |
| `src/app/api/gallery/route.ts` | 重写 | 接入 TTL 锁、EventBus、共享浏览器、UA 轮换 |
| `src/app/api/gallery/[id]/download/route.ts` | 修改 | 409 冲突响应 |
| `src/lib/search/search-engine.ts` | 修改 | 移除本地定义，改用共享模块 |

### 验证结果

- TypeScript 编译：0 错误
- ESLint：0 错误，0 警告

---
