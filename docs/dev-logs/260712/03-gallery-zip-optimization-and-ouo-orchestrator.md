# 开发日志 — 2026-07-12 — 图库 ZIP 优化 + OUO 任务编排器

## 1. 概述

本次开发对图库下载链路进行了四个维度的优化：

| 维度 | 优化内容 | 效果 |
|------|---------|------|
| ZIP 识别 | 爬虫详情页自动识别是否存在 ZIP 压缩包 | 避免无效下载尝试 |
| ZIP 重命名 | 压缩包自动重命名为英文名（拼音/罗马音映射） | 解决中文文件名兼容问题 |
| 内容校验 | 解压后对比文件数量与标题声明（如 "11P2V"） | 自动检测缺失内容，触发回退爬虫 |
| OUO 编排器 | 专门的 ouo.io 任务调度器，智能休眠 + 反机器人行为 | 避免 IP 限速，模拟人类浏览模式 |

---

## 2. 数据库模型优化（`prisma/schema.prisma`）

### 2.1 Gallery 模型新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `downloadMethod` | String | 下载方式：`pending` / `zip` / `scrape` / `both` |
| `expectedImageCount` | Int | 标题声明的预期图片数（从 "11P2V" 解析） |
| `expectedVideoCount` | Int | 标题声明的预期视频数 |
| `contentVerified` | Boolean | 内容数量是否已校验 |

### 2.2 GalleryDownloadInfo 模型新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `downloadSource` | String | 下载来源：`ouo` / `mediafire` / `direct` / `unknown` |
| `ouoUrl` | String | 原始 ouo.io 短链接 |
| `resolvedDirectUrl` | String | 中转站解析后的最终直链 |
| `zipFileName` | String | 重命名后的英文 ZIP 文件名 |
| `parallelism` | Int | 多线程下载使用的并行数 |
| `avgSpeed` | Int | 平均下载速度（字节/秒） |
| `verifiedCount` | Int | 解压后实际文件数量 |
| `countMatched` | Boolean | 文件数量是否与标题声明一致 |

### 2.3 迁移方式

使用 `npx prisma db push` 直接同步 schema 到 SQLite 数据库，再通过 `npx prisma generate` 更新 Prisma Client。

---

## 3. 内容校验工具（`gallery-content-verifier.ts` 新建）

### 3.1 功能概览

| 函数 | 功能 |
|------|------|
| `parseTitleCount(title)` | 从标题解析预期图片/视频数（支持 "11P2V"、"50P"、"11P2V1G" 格式） |
| `generateEnglishZipName(protagonist, description, galleryId, ext)` | 生成纯 ASCII 英文 ZIP 文件名 |
| `countExtractedFiles(extractPath)` | 统计解压目录中的图片/视频/其他文件数 |
| `verifyExtractedContent(extractPath, expectedImages, expectedVideos)` | 对比实际与预期，返回校验结果 |
| `detectDownloadSource(url)` | 根据 URL 域名判断下载来源 |

### 3.2 标题数量解析规则

```
"可可小白兔 - 電車上の女高中生 11P2V"  →  11 张图片，2 个视频
"某主角 - 某描述 50P"                    →  50 张图片，0 个视频
"某主角 - 某描述 11P2V1G"               →  12 张图片（11+1GIF），2 个视频
"某主角 - 某描述"                        →  0, 0（未声明数量，跳过校验）
```

### 3.3 英文 ZIP 文件名生成

```
主角 "可可小白兔", 描述 "電車上の女高中生", ID 27571
  → "keke_xiaobaitu_dianshang_nvgaosheng_27571.zip"

主角 "Alice", 描述 "Cosplay Set", ID 123
  → "alice_cosplay_set_123.zip"
```

内置 80+ 常见中文字符到拼音的映射表，无法映射的字符自动跳过。

### 3.4 内容校验规则

- 实际数量允许比预期多（可能包含封面图、预览图等附加内容）
- 实际数量少于预期超过 2 个时，标记 `needsFallbackScrape = true`
- 标题未声明数量时（`expectedImages === 0 && expectedVideos === 0`），跳过校验

---

## 4. ZIP 下载器集成（`zip-downloader.ts` 修改）

### 4.1 下载流程改进

在 `downloadAndExtractZip` 中新增以下步骤：

1. **来源检测**：调用 `detectDownloadSource(downloadUrl)` 判断下载来源
2. **英文名生成**：调用 `generateEnglishZipName()` 生成 ASCII 文件名
3. **标题数量解析**：调用 `parseTitleCount(gallery.title)` 获取预期数量
4. **数据库更新**：将 `downloadSource`、`ouoUrl`、`zipFileName` 等写入 `GalleryDownloadInfo`
5. **压缩包重命名**：下载完成后将文件重命名为英文名
6. **内容校验**：解压后调用 `verifyExtractedContent()` 对比实际与预期数量
7. **校验结果存储**：将 `verifiedCount`、`countMatched` 写入数据库

### 4.2 ZipDownloadResult 接口扩展

```typescript
interface ZipDownloadResult {
  success: boolean;
  status: string;
  localPath: string;
  extractedPath: string;
  actualSize: number;
  fileCount: number;
  downloadSource?: string;      // 下载来源
  zipFileName?: string;          // 英文 ZIP 文件名
  contentVerified?: boolean;     // 内容校验是否通过
  needsFallbackScrape?: boolean; // 是否需要回退爬虫下载
  verifyReason?: string;         // 校验不匹配原因
  error?: string;
}
```

---

## 5. 图库下载器集成（`gallery-downloader.ts` 修改）

在 `_doDownload` 中根据已有下载方式更新 `downloadMethod`：

```typescript
const newMethod = existingGallery?.downloadMethod === 'zip' ? 'both' : 'scrape';
```

- 如果之前已经通过 ZIP 下载（`downloadMethod === 'zip'`），爬虫下载后标记为 `both`
- 如果之前未下载过，爬虫下载后标记为 `scrape`

---

## 6. OUO 任务编排器（`ouo-orchestrator.ts` 新建）

### 6.1 设计目标

ouo.io 有严格的 IP 限速策略：同一链接短时间内多次访问会被重定向到 `/shorten` 页面。需要一个专门的编排器来：

1. **自动调度**：按队列顺序处理 OUO 下载任务
2. **反机器人行为**：模拟人类浏览模式，任务间随机间隔、周期性长休息
3. **IP 限速保护**：检测到 `/shorten` 重定向时自动进入冷却期
4. **生命周期管理**：通过 LifecycleManager 统一启动和关闭
5. **事件驱动**：通过 EventBus 发布实时状态

### 6.2 调度策略

比通用 `BatchScheduler` 更保守（因 ouo.io IP 限速严格）：

| 调度类型 | 触发条件 | 休息时间 |
|---------|---------|---------|
| 任务间间隔 | 每个任务完成后 | 30~90 秒（高斯分布，均值 60s） |
| 短周期休息 | 每 3 个任务 | 5~10 分钟 |
| 长周期休息 | 每 8 个任务 | 20~40 分钟 |
| IP 限速冷却 | 检测到 `/shorten` 重定向 | 10~15 分钟 |
| 任务失败重试间隔 | 非限速错误 | 60~120 秒 |

### 6.3 核心类设计

```
OuoTaskOrchestrator
├── enqueue(galleryId, ouoUrl, manualUrl?, maxRetries?)  → 入队
├── enqueueBatch(tasks[])                                 → 批量入队
├── start() / stop()                                      → 生命周期
├── pause() / resume()                                    → 暂停/恢复
├── cancel(galleryId)                                     → 取消指定任务
├── clearQueue()                                          → 清空队列
├── getStatus()                                           → 获取状态
└── getHistory(limit?)                                    → 历史记录
```

### 6.4 IP 限速检测

通过错误信息关键词检测 IP 限速：

```typescript
const RATE_LIMIT_KEYWORDS = ['shorten', 'IP 限速', '限速', 'rate limit'];
```

检测到限速后：
1. 当前任务标记为 `rate_limited`
2. 编排器进入 10~15 分钟冷却期
3. 冷却结束后任务重新入队（如果还有重试次数）

### 6.5 可中断 sleep

长休息时间（20~40 分钟）使用分段 sleep 实现，每 5 秒检查一次是否需要停止：

```typescript
private async interruptibleSleep(ms: number): Promise<void> {
  while (elapsed < ms) {
    if (!this.running || abortSignal.aborted) return;
    if (this.paused) { await sleep(2000); continue; }
    await sleep(Math.min(5000, remaining));
  }
}
```

确保应用关闭或暂停时能快速响应。

### 6.6 单例模式

通过 `globalThis` 实现跨模块共享的单例：

```typescript
const OUO_ORCHESTRATOR_KEY = '__ouoOrchestratorInstance__';

export function getOuoOrchestrator(): OuoTaskOrchestrator {
  if (!globalThis[OUO_ORCHESTRATOR_KEY]) {
    globalThis[OUO_ORCHESTRATOR_KEY] = new OuoTaskOrchestrator();
  }
  return globalThis[OUO_ORCHESTRATOR_KEY];
}
```

---

## 7. EventBus 事件扩展

### 7.1 新增 OUO 编排器事件

| 事件名 | 载荷 | 触发时机 |
|--------|------|---------|
| `ouo:taskQueued` | `{ galleryId, ouoUrl, queuePosition }` | 任务入队 |
| `ouo:taskStarted` | `{ galleryId, ouoUrl, processedCount }` | 开始处理任务 |
| `ouo:taskCompleted` | `{ galleryId, success, zipFileName?, contentVerified? }` | 任务完成 |
| `ouo:taskFailed` | `{ galleryId, error, willRetry }` | 任务失败 |
| `ouo:cooldown` | `{ reason, durationMs, nextTaskAt? }` | 进入冷却 |
| `ouo:rateLimited` | `{ galleryId, cooldownMs }` | IP 限速触发 |
| `ouo:queueEmpty` | `{ totalProcessed, totalSucceeded, totalFailed }` | 队列处理完毕 |
| `ouo:orchestratorStatus` | `{ running, paused, queueLength, processedCount, rateLimited }` | 状态变更 |

### 7.2 新增图库校验事件

| 事件名 | 载荷 | 触发时机 |
|--------|------|---------|
| `gallery:zipVerifyFailed` | `{ galleryId, reason, expectedImages, actualImages, expectedVideos, actualVideos }` | 内容校验不通过 |

---

## 8. API 路由

### 8.1 OUO 编排器 API

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/ouo` | 查询编排器状态和历史记录 |
| POST | `/api/ouo/queue` | 入队（支持单个和批量） |
| DELETE | `/api/ouo/queue` | 清空队列 |
| POST | `/api/ouo/pause` | 暂停编排器 |
| POST | `/api/ouo/resume` | 恢复编排器 |
| POST | `/api/ouo/cancel` | 取消指定任务 |

### 8.2 download-zip API 扩展

POST `/api/gallery/[id]/download-zip` 新增请求参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `enqueue` | boolean | 是否通过 OUO 编排器入队（默认 false） |
| `maxRetries` | number | 编排器下载时的最大重试次数（默认 2） |

当 `enqueue: true` 且下载来源为 `ouo` 时，任务入队而非直接下载。

---

## 9. 生命周期集成（`server.ts` 修改）

### 9.1 启动流程

```
boot 阶段（按顺序执行）:
  1. socket.io 初始化
  2. download-manager 初始化
  3. event-bus-bridge 桥接
  4. ouo-orchestrator 启动  ← 新增
```

### 9.2 关闭流程

```
shutdown 阶段（逆序执行）:
  1. http-server 关闭
  2. download-manager 停止
  3. ouo-orchestrator 停止  ← 新增（等待当前任务完成，最多 15 秒）
  4. browser-instances 关闭
  5. ttl-lock 清理
  6. event-bus 清理
```

---

## 10. 完整架构图

```
用户请求
    │
    ├── POST /api/gallery/[id]/download-zip { enqueue: true }
    │   │
    │   ├── detectDownloadSource(url) → 'ouo'
    │   │
    │   └── ouoOrchestrator.enqueue(galleryId, ouoUrl)
    │       │
    │       └── 任务加入队列 → emit('ouo:taskQueued')
    │
    ▼
OuoTaskOrchestrator 处理循环
    │
    ├── waitBetweenTasks()
    │   ├── 长周期（每8个）→ 休息 20~40 分钟
    │   ├── 短周期（每3个）→ 休息 5~10 分钟
    │   └── 普通间隔      → 高斯分布 30~90 秒
    │
    ├── processTask(task)
    │   │
    │   ├── downloadAndExtractZip(galleryId)
    │   │   ├── detectDownloadSource()
    │   │   ├── generateEnglishZipName()
    │   │   ├── parseTitleCount()
    │   │   ├── resolveDirectDownloadUrl(ouoUrl)
    │   │   │   └── resolveOuoIo() → resolveMediaFire() → 直链
    │   │   ├── parallelDownload(directUrl) → 4线程并行
    │   │   ├── 重命名为英文名
    │   │   ├── extractArchive() → 解压
    │   │   └── verifyExtractedContent() → 内容校验
    │   │
    │   ├── 成功 → emit('ouo:taskCompleted')
    │   ├── IP限速 → handleRateLimit() → 冷却 10~15 分钟
    │   └── 失败 → 重试 or 标记失败
    │
    └── 队列空 → emit('ouo:queueEmpty')
```

---

## 11. 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `prisma/schema.prisma` | 修改 | Gallery 新增 4 字段，GalleryDownloadInfo 新增 8 字段 |
| `src/lib/downloader/gallery-content-verifier.ts` | 新建 | 标题解析、英文名生成、内容校验、来源检测 |
| `src/lib/downloader/zip-downloader.ts` | 修改 | 集成来源检测、英文名、内容校验；ZipDownloadResult 扩展 |
| `src/lib/downloader/gallery-downloader.ts` | 修改 | downloadMethod 字段更新逻辑 |
| `src/lib/core/ouo-orchestrator.ts` | 新建 | OUO 任务编排器核心模块 |
| `src/lib/core/event-bus.ts` | 修改 | 新增 8 个 OUO 事件 + 1 个校验事件 |
| `src/lib/core/index.ts` | 修改 | 导出 OuoTaskOrchestrator 和 BatchScheduler |
| `server.ts` | 修改 | 注册 OUO 编排器的 init/shutdown hook |
| `src/app/api/ouo/route.ts` | 新建 | GET 编排器状态 |
| `src/app/api/ouo/queue/route.ts` | 新建 | POST 入队 / DELETE 清空 |
| `src/app/api/ouo/pause/route.ts` | 新建 | POST 暂停 |
| `src/app/api/ouo/resume/route.ts` | 新建 | POST 恢复 |
| `src/app/api/ouo/cancel/route.ts` | 新建 | POST 取消任务 |
| `src/app/api/gallery/[id]/download-zip/route.ts` | 修改 | 支持 enqueue 参数 |
| `src/types/index.ts` | 修改 | GalleryZipInfo/GalleryDownloadInfoData/GalleryData 新增字段 |

---

## 12. 使用方式

### 12.1 单个图库直接下载（原有行为不变）

```bash
POST /api/gallery/27571/download-zip
# 无 body 或 { manualUrl: "https://ouo.io/xxx" }
```

### 12.2 通过编排器入队

```bash
POST /api/gallery/27571/download-zip
{ "enqueue": true, "maxRetries": 3 }
```

### 12.3 批量入队

```bash
POST /api/ouo/queue
{
  "tasks": [
    { "galleryId": 27571, "ouoUrl": "https://ouo.io/abc" },
    { "galleryId": 27572, "ouoUrl": "https://ouo.io/def" },
    { "galleryId": 27573, "ouoUrl": "https://ouo.io/ghi" }
  ]
}
```

### 12.4 查询状态

```bash
GET /api/ouo
# 返回: { status: { running, paused, queueLength, ... }, history: [...] }
```

### 12.5 暂停/恢复

```bash
POST /api/ouo/pause
POST /api/ouo/resume
```

### 12.6 取消任务

```bash
POST /api/ouo/cancel
{ "galleryId": 27571 }
```

---

## 13. 修订记录

| 日期 | 修订内容 |
|------|---------|
| 2026-07-12 | 初始版本：数据库模型优化、内容校验工具、ZIP 下载器集成、OUO 任务编排器、API 路由、生命周期集成 |
