# 开发日志 — 2026-07-12 — SSE 实时任务管理系统重构

## 1. 概述

将任务管理界面从 WebSocket 轮询架构重构为 SSE（Server-Sent Events）实时推送架构，同时新增 `scraping` 识别中状态、修复来源列多域名匹配、优化进度条阶段显示。

| 维度 | 旧方案 (WebSocket) | 新方案 (SSE) |
|------|-------------------|--------------|
| 传输方式 | Socket.IO WebSocket | EventSource (HTTP SSE) |
| 更新粒度 | 事件触发全量 `fetchTasks()` | 增量 `upsert` / `patch` 推送 |
| 数据流量 | 每次事件拉取全量任务列表 | 仅推送变更字段（300ms 节流） |
| 响应延迟 | 500ms 防抖 + HTTP 往返 | 即时推送（< 300ms） |
| 重连机制 | 手动 Socket.IO 重连 | 浏览器内置 EventSource 自动重连 |

---

## 2. 类型与事件层扩展

### 2.1 TaskStatus 新增 `scraping`（`src/types/index.ts`）

```typescript
export type TaskStatus =
  | 'pending'
  | 'scraping'      // 新增：页面识别/爬取中
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'transcoding';
```

**设计原因**：此前图库 `scraping` 状态被映射为 `pending`，视频任务爬取阶段没有独立状态。用户无法区分"等待下载"和"正在识别页面内容"，导致添加任务后界面无反馈。

### 2.2 EventBus 事件扩展（`src/lib/core/event-bus.ts`）

| 事件 | 变更 |
|------|------|
| `task:progress` | 增加 `segment?` / `total?` 字段，支持分片进度推送 |
| `task:scraping` | 新增事件，视频任务开始爬取页面时触发 |

### 2.3 server.ts 进度回调适配

DownloadManager 的 `setProgressCallback` 中，向 `task:progress` 事件传递 `segment` 和 `total`，使 SSE 端点能推送分片进度。

---

## 3. SSE 端点实现（`src/app/api/tasks/stream/route.ts` 新建）

### 3.1 推送协议

| 事件类型 | 触发条件 | 数据格式 |
|---------|---------|---------|
| `initial` | 连接建立时 | 全量 `DownloadTask[]` |
| `upsert` | 任务创建/爬取完成等需要 DB 查询的事件 | 完整 `DownloadTask` 对象 |
| `patch` | 进度等高频事件（300ms 节流合并） | `{ id, taskType, changes: Partial<DownloadTask> }` |
| `delete` | 任务删除 | `{ id, taskType }` |

### 3.2 节流机制

高频事件（如 `task:progress`、`gallery:downloadProgress`）通过 `schedulePatch()` 函数合并：

```
事件到达 → 存入 pendingPatches Map（按 taskType-id 去重合并）
         → 300ms 定时器触发 → 批量发送所有 patch → 清空 Map
```

**效果**：10 个分片/秒的下载进度，实际只产生 ~3 条 SSE 消息（每条包含最新进度）。

### 3.3 EventBus 事件订阅映射

| EventBus 事件 | SSE 推送方式 |
|--------------|-------------|
| `task:created` | `upsert`（查询 DB 获取完整任务） |
| `task:scraping` | `patch`（仅 Status 字段） |
| `task:progress` | `patch`（Progress + Segment + TotalSegments + Status） |
| `task:completed` | `patch`（Status=completed, Progress=100） |
| `task:failed` | `patch`（Status=failed, ErrorMsg） |
| `task:scraped` | `upsert`（爬取完成后查询最新数据） |
| `gallery:scrapeStarted` | `patch`（Status=scraping） |
| `gallery:scrapeCompleted` | `upsert`（含标题、图片/视频数量） |
| `gallery:downloadProgress` | `patch`（按 completed/total 计算百分比） |
| `gallery:downloadCompleted` | `upsert`（含最终状态和路径） |
| `gallery:zipDownloadProgress` | `patch`（直接使用 percent 字段） |

### 3.4 生命周期管理

- **keepalive**：每 15 秒发送 `: keepalive\n\n` 注释，防止 Nginx/代理超时断连
- **清理**：`request.signal.addEventListener('abort', cleanup)` 在客户端断开时清理所有 EventBus 订阅、定时器和 pending patch

---

## 4. 前端 Store 重构（`src/store/task-store.ts`）

### 4.1 架构变更

```
旧: useSocketStore (Socket.IO) → subscribeToSocket() → 事件 → scheduleRefetch → fetchTasks()
新: connectSSE() → EventSource → initial/upsert/patch/delete → 直接更新 tasks 数组
```

### 4.2 复合键设计

视频任务和图库任务使用自增 ID，可能重叠。使用复合键区分：

```typescript
function taskKey(t: DownloadTask): string {
  return `${t.TaskType || 'video'}-${t.ID}`;
}
```

### 4.3 乐观更新

- `addTask(task)`：检查复合键去重后插入头部
- `removeTask(id)`：立即从数组移除，不等 API 响应
- `connectSSE()`：返回清理函数，组件卸载时关闭 EventSource

### 4.4 向后兼容

保留 `subscribeToSocket` 方法名，内部委托给 `connectSSE`，避免其他页面（如 `history/page.tsx`）的引用断裂。

---

## 5. 任务页面优化（`src/app/tasks/page.tsx`）

### 5.1 识别中状态显示

| 区域 | 识别中显示 | 正常显示 |
|------|----------|---------|
| 标题列 | "识别中..."（灰色斜体） | 任务标题 |
| 状态列 | "识别中" pill（青蓝色渐变） | 对应状态 pill |
| 分片/数量列 | "识别中..." | `11P2V` 或 `5/120` |
| 进度条 | 不确定动画（indeterminate） | 百分比进度条 |
| 进度文本 | "识别中" | `45.2%` |

### 5.2 进度阶段标签

```typescript
function getProgressStage(task: DownloadTask): string {
  if (task.Status === "scraping") return "识别中";
  if (task.Status === "completed") return "已完成";
  if (task.Progress >= 99) return "探测中";
  if (task.Progress >= 97) return "转码中";
  if (task.Progress >= 95) return "合并中";
  return "下载中";
}
```

### 5.3 来源列修复

此前使用 `SITES.find(s => srcUrl.includes(host))` 仅检查 `baseUrl` 的 hostname，无法匹配爱妹子的镜像域名。

改为使用 `getSiteModuleByUrl()`（`src/lib/sites/site-modules.ts` 新增），检查顺序：
1. `baseUrl` 的 hostname
2. `domains[]` 列表中所有 hostname
3. 站点 ID 子串匹配

爱妹子三个镜像域名均可正确显示徽章：
- `www.lovecutes.com` ✓
- `xx.knit.bid` ✓
- `www.lovecutes.net` ✓

### 5.4 SSE 连接状态指示器

工具栏右侧显示绿点"实时"或灰点"离线"，反映 EventSource 连接状态。

### 5.5 乐观删除

删除操作先从 UI 移除任务，再发送 DELETE 请求。失败时回滚（重新 `fetchTasks()`）。

### 5.6 不确定进度条动画

```css
.progress-bar-indeterminate {
  width: 30% !important;
  animation: progress-indeterminate 1.4s ease-in-out infinite;
}
@keyframes progress-indeterminate {
  0% { transform: translateX(-100%); }
  50% { transform: translateX(150%); }
  100% { transform: translateX(300%); }
}
```

---

## 6. API 路由适配（`src/app/api/tasks/route.ts`）

### 6.1 Gallery 状态映射

`scraping` 不再降级为 `pending`，直接映射为 `scraping`。

### 6.2 视频任务初始状态

POST 创建视频任务时：
- `.m3u8` URL → `status: 'pending'`（可直接下载）
- 其他 URL → `status: 'scraping'`（需先爬取页面）

### 6.3 scrapeVideoAsync 发射事件

开始爬取前 emit `task:scraping` 事件，SSE 端点收到后推送 patch 到前端。

---

## 7. 仪表盘适配（`src/app/page.tsx`）

- 从 `subscribeToSocket` 切换到 `connectSSE`
- `STATUS_LABEL` / `STATUS_CLASS` 添加 `scraping` 条目
- 保留 5 秒 `/api/stats` 轮询（仪表盘不需要强实时）

---

## 8. tsconfig.json 修复

`exclude` 增加 `data` 和 `old` 目录，避免 `data/galleries/` 下的 `.ts` 视频分片文件被 TypeScript 编译器误解析。

---

## 9. 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/types/index.ts` | 修改 | TaskStatus 新增 `scraping` |
| `src/lib/core/event-bus.ts` | 修改 | task:progress 加字段、新增 task:scraping |
| `server.ts` | 修改 | 进度回调传递 segment/total |
| `src/lib/sites/site-modules.ts` | 修改 | 新增 `getSiteModuleByUrl()` |
| `src/app/api/tasks/stream/route.ts` | 新建 | SSE 端点 |
| `src/app/api/tasks/route.ts` | 修改 | scraping 状态映射 + 初始状态 |
| `src/store/task-store.ts` | 重写 | SSE 驱动替代 WebSocket |
| `src/app/tasks/page.tsx` | 重写 | 识别中状态 + 来源修复 + SSE 接入 |
| `src/app/page.tsx` | 修改 | connectSSE + scraping 状态 |
| `src/app/styles/components.css` | 修改 | scraping pill + indeterminate 动画 |
| `tsconfig.json` | 修改 | exclude data/old 目录 |

---

## 10. 验证结果

- TypeScript 编译：0 个新增错误（16 个 pre-existing 错误均在未修改文件中）
- Lint 检查：无错误
- 架构一致性：EventBus → SSE → Store → UI 全链路类型安全

---

*2026-07-12*
