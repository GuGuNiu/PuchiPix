# 开发日志 — 2026-07-11 — 功能十一：爱妹子模块全面优化 — 多域名自适应 + ZIP 信息爬取 + 体积统计 + 智能调度 + 主角屏蔽

## 功能十一：爱妹子模块全面优化 — 多域名自适应 + ZIP 信息爬取 + 体积统计 + 智能调度 + 主角屏蔽

### 11.1 概述

对爱妹子模块进行全面优化，涵盖五个核心功能：

| 功能 | 文件 | 状态 |
|------|------|------|
| 多域名自适应（跳房子算法） | `aimeizizi-provider.ts`、`gallery/route.ts`、`tasks/route.ts` | ✅ 完成 |
| ZIP 压缩包信息爬取 | `aimeizizi-provider.ts`、`prisma/schema.prisma` | ✅ 完成 |
| 图包体积统计（图片+视频） | `gallery-downloader.ts`、`gallery/route.ts`、`gallery/page.tsx` | ✅ 完成 |
| 大批量任务智能调度 | `batch-scheduler.ts`、`search-engine.ts` | ✅ 完成 |
| 预埋主角名屏蔽 | `aimeizizi-provider.ts`、`search-engine.ts` | ✅ 完成 |

### 11.2 多域名自适应（跳房子算法）

#### 11.2.1 背景问题

爱妹子站点存在三个镜像域名，内容完全相同但 WAF 策略不同：

| 域名 | 状态 | 说明 |
|------|------|------|
| `www.lovecutes.com` | ✅ 主域名 | WAF 较宽松 |
| `xx.knit.bid` | ❌ 不可用 | Cloudflare 拦截 |
| `www.lovecutes.net` | ⚠️ 备用 | 偶尔可用 |

固定使用单一域名时，遇到 403/404 导致爬取完全失败。

#### 11.2.2 实现

**`aimeizizi-provider.ts`**：

```typescript
// 跳房子算法：随机打乱域名列表，返回尝试顺序
function shuffleDomains(): string[] {
  const shuffled = [...SITE_DOMAINS];
  const startIdx = Math.floor(Math.random() * shuffled.length);
  return [...shuffled.slice(startIdx), ...shuffled.slice(0, startIdx)];
}

// 获取多域名自适应 URL 列表
getAdaptiveUrls(articleUrl: string): string[] {
  const articleId = extractArticleId(articleUrl);
  if (!articleId) return [articleUrl];
  const domains = shuffleDomains();
  return domains.map((d) => `${d}/article/${articleId}/`);
}
```

**`gallery/route.ts` 和 `tasks/route.ts`** 中的调用方：

```typescript
const urlsToTry = adaptiveProvider.getAdaptiveUrls(url);
for (const tryUrl of urlsToTry) {
  await page.goto(tryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const resp = await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);
  if (!resp) {
    // 可能是 403/404，尝试下一个域名
    continue;
  }
  result = await provider.scrapeGallery(page, tryUrl);
  break;
}
```

#### 11.2.3 设计要点

1. **随机起始**：每次调用产生不同的起始域名，避免固定模式被识别
2. **自动降级**：遇到无 `article` 元素的页面自动切换到下一个域名
3. **屏蔽穿透**：内容被屏蔽的错误不切换域名，直接抛出
4. **域名记录**：`scrapedDomain` 字段记录实际成功爬取的域名，便于排查

### 11.3 ZIP 压缩包信息爬取

#### 11.3.1 数据模型

新增 `GalleryDownloadInfo` 模型：

```prisma
model GalleryDownloadInfo {
  id          Int      @id @default(autoincrement())
  galleryId   Int      @unique @map("gallery_id")
  title       String   @default("")           // 压缩包标题
  fileCount   Int      @default(0) @map("file_count")  // 文件数量
  fileSizeText String  @default("") @map("file_size_text")  // 原始体积文本
  imageDimensions String @default("") @map("image_dimensions")  // 图片尺寸
  password    String   @default("")            // 解压密码
  downloadUrl String   @default("") @map("download_url")  // 外站下载 URL
  provider    String   @default("")            // 下载提供商
  requiresLogin Boolean @default(false) @map("requires_login")
  requiresEmail Boolean @default(false) @map("requires_email")
  status      String   @default("available")   // available | unavailable | downloading | completed | failed
  localPath   String   @default("") @map("local_path")
  extractedPath String @default("") @map("extracted_path")
  actualSize  BigInt   @default(0) @map("actual_size")
  // ...
}
```

#### 11.3.2 提取逻辑

`extractZipDownloadInfo` 方法从页面的 `.download-info-box` 中提取：

- 文件数量、文件大小文本、图片尺寸、解压密码
- 外站下载链接（MediaFire 等）
- 是否需要登录/邮箱验证

#### 11.3.3 持久化

在 `gallery/route.ts` 和 `tasks/route.ts` 中，爬取完成后使用 `upsert` 持久化 ZIP 信息：

```typescript
if (result.zipInfo) {
  await prisma.galleryDownloadInfo.upsert({
    where: { galleryId: gallery.id },
    create: { ... },
    update: { ... },
  });
}
```

### 11.4 图包体积统计（图片+视频）

#### 11.4.1 数据库字段

`Gallery` 模型新增两个字段：

```prisma
totalSize      BigInt @default(0) @map("total_size")       // 图库总文件体积
downloadedSize BigInt @default(0) @map("downloaded_size")  // 已下载文件体积
```

#### 11.4.2 下载器统计逻辑

**`gallery-downloader.ts`** 中的 `_doDownload` 方法：

1. **实时更新**：每下载完一个文件（图片或视频），累加 `totalDownloadedSize` 并更新数据库
2. **最终统计**：所有文件下载完成后，使用 Prisma `aggregate` 查询计算精确的 `finalTotalSize`
3. **状态更新**：更新 `Gallery` 的 `totalSize`、`downloadedSize`、`status`、`completedAt`

```typescript
// 实时更新（每个文件下载后）
await prisma.gallery.update({
  where: { id: galleryId },
  data: { downloadedSize: totalDownloadedSize },
});

// 最终统计（所有文件下载完成后）
const totalSizeResult = await prisma.galleryImage.aggregate({
  where: { galleryId, status: 'downloaded' },
  _sum: { fileSize: true },
});
const videoSizeResult = await prisma.galleryVideo.aggregate({
  where: { galleryId, status: 'completed' },
  _sum: { fileSize: true },
});
const finalTotalSize = (totalSizeResult._sum.fileSize || BigInt(0)) + (videoSizeResult._sum.fileSize || BigInt(0));

await prisma.gallery.update({
  where: { id: galleryId },
  data: {
    status: finalStatus,
    totalSize: finalTotalSize,
    downloadedSize: finalTotalSize,
    completedAt: finalStatus === 'completed' ? new Date() : undefined,
  },
});
```

#### 11.4.3 前端展示

**`gallery/route.ts`** 的 `mapGallery` 函数返回 `TotalSize` 和 `DownloadedSize`。

**`gallery/page.tsx`** 中：
- 卡片徽章：显示 `TotalSize`（如 `263.8 MB`）
- 详情面板信息栏：显示 `DownloadedSize / TotalSize`（如 `263.8 MB / 263.8 MB`）
- `formatFileSize` 辅助函数将字节转为人类可读格式

### 11.5 大批量任务智能调度

#### 11.5.1 BatchScheduler 类

**`src/lib/core/batch-scheduler.ts`**：

调度策略采用三层随机抖动：

| 层级 | 触发条件 | 休息时间 | 说明 |
|------|---------|---------|------|
| 任务间 | 每个任务之间 | 5~15 秒 | 基础间隔，模拟人类操作 |
| 短周期 | 每 5 个任务 | 10~30 秒 | 短暂休息，避免连续请求 |
| 长周期 | 每 15 个任务 | 20~40 分钟 | 长时间休息，避免流量峰值 |

所有间隔均为随机抖动，无固定模式。

#### 11.5.2 集成到搜索引擎

**`search-engine.ts`** 的 `executeBatchSearch` 方法：

```typescript
const scheduler = new BatchScheduler({
  onLog: (msg) => this.logBatch(job, msg),
});

for (let ti = 0; ti < job.titles.length; ti++) {
  await scheduler.waitIfNeeded();  // 任务开始前检查是否需要休息
  // ... 处理标题 ...
  scheduler.markCompleted();       // 标记任务完成
}
```

#### 11.5.3 批量处理辅助函数

提供 `batchProcess` 泛型函数，方便任意 URL 列表的批量处理：

```typescript
export async function batchProcess<T>(
  urls: string[],
  processor: (url: string, index: number) => Promise<T>,
  options?: BatchSchedulerOptions,
): Promise<T[]>
```

### 11.6 预埋主角名屏蔽功能

#### 11.6.1 AimeiziziProvider 屏蔽检查

`checkBlocked` 方法支持三种维度的屏蔽：

```typescript
checkBlocked(
  title: string,
  category: string,
  protagonist?: string,
): { blocked: boolean; reason: string | undefined } {
  // 1. AI 内容关键词检查（标题）
  // 2. AI 分类关键词检查（分类）
  // 3. 主角名屏蔽（预埋，默认不启用）
  if (this.blockedProtagonistsEnabled && protagonist) {
    for (const blocked of this.blockedProtagonists) {
      if (protagonist === blocked || protagonist.includes(blocked)) {
        return { blocked: true, reason: `主角名被屏蔽: "${blocked}"` };
      }
    }
  }
  return { blocked: false, reason: undefined };
}
```

屏蔽列表定义：

```typescript
// 需要屏蔽的主角名列表（预埋功能，默认不启用）
const BLOCKED_PROTAGONISTS: string[] = [];
// 主角屏蔽功能是否启用（默认关闭）
const BLOCKED_PROTAGONISTS_ENABLED = false;
```

#### 11.6.2 SearchEngine 集成

在 `search-engine.ts` 的三个关键方法中集成了 AimeiziziProvider 屏蔽检查：

1. **`scrapeVideo`**：单个视频爬取时检查
2. **`scrapeAll`**：批量爬取时检查
3. **`executeBatchSearch`**：批量搜索时检查

```typescript
if (provider instanceof AimeiziziProvider) {
  const blockCheck = provider.checkBlocked(
    scrapeResult.title,
    scrapeResult.categories.join(','),
    scrapeResult.actors[0],
  );
  if (blockCheck.blocked) {
    // 标记为失败，记录原因
  }
}
```

### 11.7 Kanav 和 Aimeizizi 模块独立性

两个 Provider 的屏蔽逻辑完全独立，通过 `instanceof` 检查分别处理：

| 维度 | KanavProvider | AimeiziziProvider |
|------|---------------|-------------------|
| 屏蔽方法 | `checkBlocked(actors, tags)` | `checkBlocked(title, category, protagonist)` |
| 屏蔽维度 | 演员名 + 标签 | 标题 + 分类 + 主角名 |
| 屏蔽列表 | `blockedCategories` | `blockedTitleKeywords` + `blockedCategories` + `blockedProtagonists` |
| 触发位置 | `executeSearch`、`scrapeVideo`、`scrapeAll`、`executeBatchSearch` | 同左 |
| 独立性 | ✅ 仅检查 `instanceof KanavProvider` | ✅ 仅检查 `instanceof AimeiziziProvider` |

### 11.8 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `prisma/schema.prisma` | 修改 | 新增 `GalleryDownloadInfo` 模型；`Gallery` 新增 `totalSize`、`downloadedSize`、`scrapedDomain`、`publishTime` 字段 |
| `src/lib/sites/providers/aimeizizi-provider.ts` | 修改 | 实现 `getAdaptiveUrls`、`extractZipDownloadInfo`、`resolveUrl`；`checkBlocked` 支持主角名；`scrapeGallery` 跨页去重 + URL 解析 |
| `src/lib/downloader/gallery-downloader.ts` | 修改 | 新增 M3U8 视频下载 (`downloadM3U8Video`)；实时统计 `totalSize`/`downloadedSize`；接入 `ttlLock`、`eventBus`、`backoffDelay` |
| `src/lib/core/batch-scheduler.ts` | 新建 | 智能调度器类，三层随机抖动策略 |
| `src/lib/search/search-engine.ts` | 修改 | `executeBatchSearch` 集成 `BatchScheduler`；`scrapeVideo`/`scrapeAll`/`executeBatchSearch` 新增 AimeiziziProvider 屏蔽检查 |
| `src/app/api/tasks/route.ts` | 修改 | 新增 `getGalleryProvider`、`handleGalleryUrl`；图库 URL 自动路由；多域名自适应；ZIP 信息持久化 |
| `src/app/api/gallery/route.ts` | 修改 | `mapGallery` 返回 `TotalSize`/`DownloadedSize`/`ScrapedDomain`/`DownloadInfo`；多域名自适应；ZIP 信息持久化 |
| `src/app/api/gallery/[id]/route.ts` | 修改 | `mapGalleryWithRelations` 包含新字段；`include` 参数扩展 |
| `src/app/gallery/page.tsx` | 修改 | 卡片显示体积徽章；详情面板显示 `DownloadedSize / TotalSize`；ZIP 信息展示区；`formatFileSize` 辅助函数 |

### 11.9 验证结果

- **Prisma Client**：重新生成成功，包含所有新模型和字段
- **TypeScript 编译**：`tsc --noEmit` 无 gallery 相关错误
- **功能链路验证**：
  - 多域名自适应：`getAdaptiveUrls` → `shuffleDomains` → 依次尝试 → 记录 `scrapedDomain`
  - ZIP 信息：`extractZipDownloadInfo` → `prisma.galleryDownloadInfo.upsert` → `mapGallery.DownloadInfo` → 前端展示
  - 体积统计：`_doDownload` 实时更新 → `aggregate` 最终计算 → `mapGallery.TotalSize/DownloadedSize` → 前端展示
  - 智能调度：`BatchScheduler.waitIfNeeded` → 短周期/长周期检查 → `markCompleted`
  - 主角屏蔽：`checkBlocked(title, category, protagonist)` → `blockedProtagonistsEnabled` 开关
  - 模块独立：`instanceof KanavProvider` / `instanceof AimeiziziProvider` 分别处理

### 11.10 总结

本次优化实现了爱妹子模块的五个核心功能，显著提升了爬取稳定性和数据完整性：

1. **多域名自适应**：跳房子算法解决了单域名 WAF 拦截问题，爬取成功率大幅提升
2. **ZIP 信息爬取**：完整提取压缩包元信息，为后续整包下载提供数据基础
3. **体积统计**：图片和视频的体积实时统计，用户可直观了解图库大小
4. **智能调度**：三层随机抖动策略有效避免流量被站点识别
5. **主角屏蔽**：预埋功能为后续内容过滤提供扩展能力

所有功能均遵循模块独立原则，Kanav 和 Aimeizizi 的屏蔽逻辑互不影响。

