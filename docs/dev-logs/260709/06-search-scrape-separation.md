# 开发日志 — 2026-07-09 — 第二轮迭代 — 搜索爬取分离与 hls.js 本地化

## 第二轮迭代 — 搜索爬取分离与 hls.js 本地化

### hls.js 本地化

将 hls.js 从 npm 依赖改为本地文件加载，避免 CDN 依赖和构建打包开销。

**变更内容**：

| 操作 | 详情 |
|---|---|
| 下载 | `hls.min.js`（v1.6.16, 543KB）→ `public/vendor/hls.min.js` |
| 加载 | `src/app/layout.tsx` 的 `<head>` 中添加 `<script src="/vendor/hls.min.js" defer>` |
| 移除依赖 | `package.json` 中移除 `"hls.js": "^1.6.16"` |
| 组件适配 | `video-card.tsx` 中 `import Hls from "hls.js"` → `window.Hls` 全局对象 |
| 类型声明 | 组件内声明 `Window.Hls` 接口类型，保持 TypeScript 类型安全 |

**验证**：`GET /vendor/hls.min.js` → `200`，`Content-Length: 543002`

### 搜索结果标题提取增强

**问题**：搜索结果中视频标题为空，无法显示。

**根因**：`base-provider.ts` 的 `extractSearchResults` 仅从 `<a>` 标签的 `title` 属性和 `textContent` 提取标题。许多站点的搜索结果列表中，`<a>` 标签本身不包含标题文本，标题在父容器的其他元素中。

**修复**：增强标题提取逻辑，按优先级从 3 个来源尝试获取：

```
1. <a> 标签的 title 属性 + textContent
2. 父容器中的标题元素（.title, .vodlist_title, [class*="title"], h3/h4/h5 等）
3. <img> 标签的 alt 属性
```

**验证结果**：搜索 "test" 关键词，成功提取到标题如 `"[lmsk]Elegg&Cinderellaswimsuitstest1440p(Altver.)"` 和封面图 URL。

### 搜索与爬取分离

**问题**：搜索后自动爬取所有视频页面，耗时长且无法预览选择。

**重构方案**：将搜索引擎的「搜索」与「爬取」流程完全解耦，同时添加自动翻页和 kanav 屏蔽器。

**重构后**：
```
搜索关键词 → 自动翻页提取视频列表 → kanav 屏蔽器过滤 → status: pending
                                                              ↓
                                             用户手动触发爬取（单个/批量）
                                              ↓                    ↓
                                        scrapeVideo()         scrapeAll()
                                              ↓                    ↓
                                        kanav 二次屏蔽 → 提取 M3U8 → 创建下载任务
```

**`search-engine.ts` 变更**：

| 方法 | 变更 |
|---|---|
| `executeSearch()` | 包含自动翻页循环（最多 5 页），搜索完成后所有 items 状态为 `pending` |
| `goToNextPage(page, pageNum)` | **新增** — 翻页逻辑，支持多种分页选择器和 URL 直接跳转 |
| `scrapeVideo(jobId, pageUrl)` | **新增** — 爬取单个视频，含 kanav 二次屏蔽 |
| `scrapeAll(jobId)` | **新增** — 批量爬取，含 kanav 二次屏蔽 |
| 搜索延迟 | 关键词间无延迟；翻页间隔 2~3s |
| 爬取延迟 | 批量爬取保留 2~3s 防爬延迟 |
| 重试次数 | 视频爬取重试从 5 次降为 3 次 |
| 搜索上限 | 每关键词最多 50 个结果（含翻页累计） |

### 手动搜索移除延迟

移除 `executeSearch` 中关键词之间的 `SEARCH_DELAY_MIN`/`SEARCH_DELAY_MAX`（3~8秒）随机延迟。搜索完成后立即返回所有结果，不再等待。

爬取阶段仍保留防爬延迟（`PAGE_DELAY_MIN`/`PAGE_DELAY_MAX`，2~3秒），避免被站点识别为爬虫。

### 搜索结果自动翻页

**问题**：单页搜索结果有限，缺少翻页机制。

**实现方案**：在 `executeSearch` 的每个关键词搜索过程中添加自动翻页循环。

```
打开第1页 → 提取结果 → 等待 2~3s → 翻到第2页 → 提取结果 → 等待 2~3s → ...
```

**翻页策略**（`goToNextPage()` 方法）：
- 尝试多种分页选择器（`.pagination a`、`.page a`、`.mac_pages a` 等）
- 尝试"下一页"按钮（`a:has-text("下一页")`、`a.next` 等）
- 回退方案：直接修改 URL 中的 `page=N` 参数

**关键参数**：

| 参数 | 值 | 说明 |
|---|---|---|
| `MAX_PAGES_PER_KEYWORD` | 5 | 每个关键词最大翻页数 |
| `PAGE_DELAY_MIN` | 2000ms | 翻页最小间隔 |
| `PAGE_DELAY_MAX` | 3000ms | 翻页最大间隔 |

**终止条件**：
- 已翻到最大页数
- 当页新增结果为 0（无新内容）
- 无"下一页"按钮
- 用户取消任务

**结果统计显示每页新增数量和累计数量如"第 2 页新增 12 个（累计 24）"）。

### Kanav 分类屏蔽器

**问题**：搜索结果中包含用户不需要的分类（同人作品、动漫番剧等），需两级过滤。

**实现方案**：两级屏蔽机制。

**第一级 — 搜索阶段（标题关键词过滤）**：

搜索完成后，对 KanavProvider 的搜索结果进行标题关键词过滤：

```typescript
if (provider instanceof KanavProvider) {
  filteredItems = filteredItems.filter((item) => {
    const titleLower = item.title.toLowerCase();
    for (const kw of provider.blockedCategories) {
      if (titleLower.includes(kw.toLowerCase())) return false;
    }
    return true;
  });
}
```

`KanavProvider.blockedCategories` 包含：`['同人作品', '同人', '动漫番剧', '动漫']`

**第二级 — 爬取阶段（精确内容过滤）**：

爬取视频详情页后，使用 `KanavProvider.checkBlocked(actors, tags)` 方法基于精细元数据做二次屏蔽：
- 演员字段包含屏蔽关键词 → 屏蔽
- 标签字段包含屏蔽关键词 → 屏蔽

被屏蔽的视频状态设为 `failed`，error 设为 `屏蔽: xxx`，不创建下载任务。

### 一键爬取与卡片爬取按钮

**搜索页面新增**：

| UI 元素 | 位置 | 功能 |
|---|---|---|
| 一键爬取按钮 | 画廊顶部右侧 | 批量爬取所有 pending 视频，显示待爬取数量 |
| 卡片爬取按钮 | 视频卡片右下角 | 悬浮显示，爬取单个视频 |

**交互流程**：
1. 搜索完成 → 视频列表展示，所有卡片状态为 `等待爬取`
2. 用户悬浮卡片 → 显示封面 + 播放预览（如有 M3U8）+ 爬取按钮
3. 点击卡片爬取按钮 → 调用 `POST /api/search/scrape`（单个）→ 状态更新为 `已下载`
4. 点击一键爬取 → 调用 `POST /api/search/scrape`（批量）→ 异步爬取所有 pending 视频
5. 爬取成功后 M3U8 可用 → 悬浮预览生效

**CSS 新增**：
```css
.video-card-scrape-btn {
  position: absolute; bottom: 8px; right: 8px; z-index: 3;
  background: var(--accent); border: 1px solid var(--accent-light);
  opacity: 0; transition: opacity 0.2s ease;
}
.video-card:hover .video-card-scrape-btn { opacity: 1; }
```

### 新增爬取 API

#### `POST /api/search/scrape`

**单个爬取**：
```json
// Request
{ "jobId": "search_xxx", "pageUrl": "https://kanav.ad/vod/play/id/123" }

// Response（200）
{ "pageUrl": "...", "title": "...", "m3u8Url": "...", "status": "downloaded", "taskId": 42 }
```

**批量爬取**：
```json
// Request
{ "jobId": "search_xxx", "all": true }

// Response（200）
{ "message": "批量爬取已启动", "jobId": "search_xxx" }
```

批量爬取为异步执行，前端通过轮询 `GET /api/search/:id` 获取实时状态更新。

---
