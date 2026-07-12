# 开发日志 — 2026-07-11 — 功能五：爱妹子下载算法修复 — 图片URL解析 + M3U8视频下载 + 任务路由

## 功能五：爱妹子下载算法修复 — 图片URL解析 + M3U8视频下载 + 任务路由

### 问题背景

爱妹子是写真站（50P1V = 50张图片 + 1个视频），但此前的下载算法存在三个关键缺陷：

1. **图片 URL 未解析为绝对路径**：`scrapeGallery` 从页面提取的图片 URL 是相对路径（如 `/static/images/2026/07/10/.../xxx.jpg`），但 `GalleryDownloader.downloadFile` 使用 `https.get(url)` 要求绝对 URL，导致所有图片下载失败
2. **M3U8 视频从未下载**：`GalleryDownloader` 对 M3U8 视频仅标记为 `pending`，注释说"由 M3U8 下载器处理"，但实际没有任何集成代码调用 `DownloadManager`，视频永远停留在 pending 状态
3. **`POST /api/tasks` 不识别图库 URL**：用户在任务页面输入爱妹子文章 URL 时，走的是视频爬虫流程（`scrapePage`），仅提取 M3U8 URL，完全忽略全部图片

### 页面结构实测分析

使用 Playwright 浏览器访问测试 URL `https://xx.knit.bid/article/32242/`：

| 属性 | 值 |
|------|-----|
| 页面标题 | `[写真] 桜井宁宁 - 纯白毛衣：纯白毛衣美腿视频 50P1V` |
| H1 标题 | 同上 |
| 类型 | 图片 + 视频（50P1V） |
| 总页数 | 5 页 |
| 每页图片 | 10 张 |
| 总图片 | 50 张 |
| 视频 | `https://media.knit.bid/play/23f8dc3af2e2882b.m3u8` |
| 视频元素 | `<video><source src="..." type="application/vnd.apple.mpegurl"></video>` |
| 分类 | 大尺度美女 |
| 标签 | 桜井宁宁, 真人写真, 毛衣, 美腿, 大尺度, 视频 |

**图片懒加载机制确认**：
- 每页第一张图片：`src` = 真实 URL，`data-src` = 空
- 其余图片：`src` = `/static/zde/timg.gif`（占位 GIF），`data-src` = 真实 URL
- 所有图片 URL 均为根路径相对 URL（`/static/images/...`）

**分页确认**：
- 分页 URL 格式：`/article/{id}/page/{n}/`
- 分页导航文本：`第 1 頁，共 5 頁`
- 分页链接 `href` 均为 `#`（JavaScript 驱动），但直接 URL 导航正常

### 修复 5.1：图片 URL 解析为绝对路径（`aimeizizi-provider.ts`）

**问题**：`scrapeGallery` 中图片 URL 直接从 `page.evaluate` 返回的 `data-src`/`src` 属性值使用，这些是相对路径。

**修复**：在 `scrapeGallery` 中对每个图片 URL 调用 `this.resolveUrl(img.url)` 解析为绝对路径。

```typescript
// 修复前
for (const img of firstPageData.images) {
  allImages.push({ url: img.url, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
}

// 修复后
for (const img of firstPageData.images) {
  const fullUrl = this.resolveUrl(img.url);
  if (fullUrl && !imageUrlSet.has(fullUrl)) {
    imageUrlSet.add(fullUrl);
    allImages.push({ url: fullUrl, pageIndex: img.pageIndex, orderIndex: orderIndex++ });
  }
}
```

`resolveUrl` 方法将 `/static/images/...` → `https://xx.knit.bid/static/images/...`。

### 修复 5.2：图片跨页去重（`aimeizizi-provider.ts`）

**问题**：多页爬取时，如果同一图片 URL 出现在多个页面（如广告位、相关推荐），会被重复收集。

**修复**：新增 `imageUrlSet` 进行跨页 URL 去重，与视频的 `videoUrlSet` 机制一致。

```typescript
const imageUrlSet = new Set<string>();

// 每次添加图片前检查
if (fullUrl && !imageUrlSet.has(fullUrl)) {
  imageUrlSet.add(fullUrl);
  allImages.push({ url: fullUrl, ... });
}
```

### 修复 5.3：M3U8 视频下载集成（`gallery-downloader.ts`）

**问题**：`GalleryDownloader` 对 M3U8 视频仅标记 `pending`，从未实际下载。

**修复**：新增 `downloadM3U8Video` 函数，复用现有 M3U8 下载基础设施：

```
downloadM3U8Video(m3u8Url, outputPath, referer)
│
├── 1. 获取 M3U8 内容（fetchM3U8Content）
├── 2. 解析播放列表（parseM3U8）
│   └── Master Playlist → 选择最高码率变体 → 获取 Media Playlist
├── 3. 并发下载 TS 分片（5 线程，每片 5 次重试）
│   └── downloadSegment + generateTSID
├── 4. 校验分片完整性（verifySegments）
├── 5. 合并 TS 分片（mergeSegments）
├── 6. 转码为 MP4（transcodeTS / ffmpeg）
└── 7. 清理临时分片（cleanupSegments）
```

`_doDownload` 中的 M3U8 分支修改为：

```typescript
// 修复前
} else {
  // M3U8 视频：记录 URL，标记为 pending（由 M3U8 下载器处理）
  await prisma.galleryVideo.update({
    where: { id: video.id },
    data: { fileName, status: 'pending' },
  });
}

// 修复后
} else {
  // M3U8 视频：解析播放列表 → 下载分片 → 合并 → 转码 MP4
  await prisma.galleryVideo.update({
    where: { id: video.id },
    data: { status: 'downloading' },
  });

  const m3u8Downloaded = await downloadM3U8Video(
    video.url, filePath, gallery.sourceUrl,
  );

  if (m3u8Downloaded) {
    success++;
    await prisma.galleryVideo.update({
      where: { id: video.id },
      data: { localPath: filePath, fileName, status: 'completed' },
    });
  } else {
    failed++;
    await prisma.galleryVideo.update({
      where: { id: video.id },
      data: { status: 'failed' },
    });
  }
}
```

### 修复 5.4：任务路由 — 图库 URL 自动检测（`tasks/route.ts`）

**问题**：用户在任务页面输入爱妹子 URL 时，`POST /api/tasks` 调用 `scraper.scrape(url)` → `provider.scrapePage()`，仅提取 M3U8 URL，忽略全部图片。

**修复**：在 `POST /api/tasks` 入口处检测 URL 是否匹配图库 Provider（实现了 `scrapeGallery` 方法），如果是则走图库流程：

```
POST /api/tasks
│
├── getGalleryProvider(url) — 检测是否图库 URL
│   ├── 是 → handleGalleryUrl(url)
│   │   ├── 创建/更新 Gallery 记录
│   │   ├── 使用共享浏览器打开页面
│   │   ├── 调用 provider.scrapeGallery(page, url)
│   │   │   └── 自动翻页爬取全部图片和视频
│   │   ├── 批量写入 GalleryImage / GalleryVideo
│   │   ├── 异步触发 GalleryDownloader.downloadGallery
│   │   └── 返回 { type: 'gallery', galleryId, title, imageCount, videoCount }
│   │
│   └── 否 → 走原有视频爬虫流程
│       ├── scraper.scrape(url) → scrapePage → 提取 M3U8
│       └── 创建 DownloadTask + 启动 DownloadManager
```

**前端兼容**：返回 `type: 'gallery'` 标识，前端可据此显示不同的成功提示（如"图库爬取完成，50张图片 + 1个视频正在下载"）。

### 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/sites/providers/aimeizizi-provider.ts` | 修改 | 图片 URL 调用 `resolveUrl` 解析为绝对路径；新增 `imageUrlSet` 跨页去重 |
| `src/lib/downloader/gallery-downloader.ts` | 修改 | 新增 `downloadM3U8Video` 函数，集成 M3U8 下载基础设施；M3U8 分支改为实际下载 |
| `src/app/api/tasks/route.ts` | 重写 | 新增 `getGalleryProvider` 检测和 `handleGalleryUrl` 图库流程；图库 URL 自动路由 |

### 下载策略对比

| 策略 | 修复前 | 修复后 |
|------|--------|--------|
| 图片 URL | 相对路径（`/static/images/...`），下载失败 | 绝对 URL（`https://xx.knit.bid/static/images/...`） |
| 图片去重 | 无去重，可能重复 | `imageUrlSet` 跨页 URL 去重 |
| M3U8 视频 | 标记 `pending`，永不下载 | 完整流程：获取→解析→下载分片→合并→转码 MP4 |
| 任务路由 | 统一走视频爬虫，忽略图片 | 自动检测图库 URL，走图库流程 |
| 用户操作 | 需要手动调用 `/api/gallery` | 在任务页面输入 URL 即可自动识别 |

### 验证结果

- TypeScript 编译：0 错误
- ESLint：0 错误

### 架构图（修复后）

```
用户输入 URL
    │
    ▼
POST /api/tasks
    │
    ├── getGalleryProvider(url)
    │   │
    │   ├── 是图库 URL ──────────────────────┐
    │   │                                    ▼
    │   │                          handleGalleryUrl(url)
    │   │                                    │
    │   │                          ┌─────────┴─────────┐
    │   │                          │                   │
    │   │                   scrapeGallery()     GalleryDownloader
    │   │                          │                   │
    │   │                 ┌────────┤          ┌────────┤
    │   │                 │        │          │        │
    │   │             图片(绝对URL) 视频    图片下载   M3U8视频下载
    │   │                 │        │          │        │
    │   │                 │        │     downloadFile  downloadM3U8Video
    │   │                 │        │          │        │
    │   │                 │        │          │   ┌────┴────┐
    │   │                 │        │          │   │         │
    │   │                 └────────┘          │  分片下载  合并→MP4
    │   │                       │             │
    │   │                  写入数据库          │
    │   │                       │             │
    │   └── 否 → 视频爬虫流程   │             │
    │       (scrapePage)        │             │
    │           │               │             │
    │       DownloadManager     │             │
    │                          └─────────────┘
    │
    ▼
data/galleries/
├── 桜井宁宁 - 纯白毛衣 (1)/
│   ├── images/
│   │   ├── 001.jpg  ← 绝对URL下载
│   │   ├── 002.jpg
│   │   └── ... (50张)
│   └── videos/
│       └── video_1.mp4  ← M3U8→TS分片→合并→MP4
```

---
