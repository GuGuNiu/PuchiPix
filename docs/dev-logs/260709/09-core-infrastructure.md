# 开发日志 — 2026-07-09 — 第四轮迭代 — 核心基础设施层（Core Infrastructure）

## 第四轮迭代 — 核心基础设施层（Core Infrastructure）

### 问题背景

前三轮迭代完成了站点提供者架构、UI 重构、搜索爬取分离、悬浮预览优化等业务功能，但项目底层缺少四个关键基础设施模块，导致以下问题长期存在：

| 缺失模块 | 具体症状 |
|---|---|
| 统一生命周期 | `server.ts` 用 `setTimeout` + 重试初始化各模块；进程被 `Ctrl+C` 终止时下载管理器和 Socket.IO 不做优雅关闭，可能丢数据 |
| TTL 队列锁 | 下载管理器用 `activeDownloads.has()` 简单判重，搜索引擎用 `Set<string>` 标记爬取中 URL，均无 TTL 过期和跨模块互斥能力；崩溃后标记永远不释放 |
| 全局广播站 | 下载进度仅通过单一 `progressCallback → io.emit('progress')` 通道推送，服务端各模块之间无事件通信机制，前端各页面各自轮询 |
| 路由状态保持 | 搜索页关键词、站点选择、激活的 Job ID 全部存在 `useState` 中，切到任务页再切回来全部丢失；任务页展开状态同理丢失 |

### 架构总览

```
src/lib/core/
├── index.ts              # 统一导出（21 行）
├── lifecycle.ts          # 生命周期管理器（218 行）
├── ttl-lock.ts           # TTL 队列锁（222 行）
├── event-bus.ts          # 全局广播站（191 行）
└── route-state.ts        # 路由状态保持（249 行）
```

四个模块均为单例模式，通过 `src/lib/core/index.ts` 统一导出，可按需引用：

```typescript
import { lifecycle, ttlLock, eventBus, routeState, useRouteState } from '@/lib/core';
```

### LifecycleManager — 统一生命周期管理器

**文件**：`src/lib/core/lifecycle.ts`（218 行）

#### 设计

四阶段状态机：

```
booting → ready → draining → shutdown
                  ↑
            SIGINT/SIGTERM 触发
```

#### 核心 API

| 方法 | 说明 |
|---|---|
| `onInit(hook)` | 注册启动 hook，按注册顺序在 `boot()` 时依次执行 |
| `onShutdown(hook)` | 注册关闭 hook，按注册**逆序**在 `shutdown()` 时执行（先关 HTTP，再关数据库） |
| `boot()` | 执行全部 init hooks，每个 hook 有独立超时；全部成功后状态变为 `ready`，绑定信号处理 |
| `shutdown(exitCode?)` | 状态变为 `draining`，逆序执行 shutdown hooks，最后 `process.exit()` |
| `isHealthy()` | 供 `/api/health` 使用，`status === 'ready'` 时返回 `true` |
| `getHealthInfo()` | 返回状态摘要：status、uptime、initHooks/shutdownHooks 数量、lastError |

#### 关键设计决策

1. **有序启动**：init hooks 按注册顺序执行，前一个完成才执行下一个。Socket.IO → DownloadManager → EventBus Bridge，确保依赖关系。

2. **逆序关闭**：shutdown hooks 按注册逆序执行。先关 HTTP 服务器（拒绝新请求）→ 再停下载管理器 → 最后清 EventBus。

3. **超时保护**：每个 hook 有独立 `timeout` 参数（默认 10s），超时自动 reject。下载管理器初始化给予 15s 超时（需等待 Prisma 连接）。

4. **信号处理**：`boot()` 完成后自动监听 `SIGINT`/`SIGTERM`，触发优雅关闭。同时注册 `uncaughtException` 和 `unhandledRejection` 全局兜底（记录但不退出）。

5. **防重复调用**：`shutdown()` 用 `shuttingDown` 标志防止多次调用（信号可能连续触发）。

#### 使用示例

```typescript
// server.ts
lifecycle.onInit({
  name: 'socket.io',
  fn: async () => { initSocketIO(server); },
});

lifecycle.onInit({
  name: 'download-manager',
  timeout: 15000,
  fn: async () => {
    const { getDownloadManager } = await import('./src/lib/api-helpers');
    const dm = getDownloadManager();
    dm.setProgressCallback(/* ... */);
  },
});

lifecycle.onShutdown({
  name: 'http-server',
  timeout: 5000,
  fn: async () => {
    return new Promise((resolve) => server.close(resolve));
  },
});

await lifecycle.boot();
```

### TTLQueueLock — TTL 队列锁

**文件**：`src/lib/core/ttl-lock.ts`（222 行）

#### 设计

基于 key 的互斥锁，每个锁有 TTL（Time-To-Live）自动过期。竞争者可选择排队等待或立即返回。

```
acquire("scrape:https://...")
  │
  ├─ key 未被锁定（或锁已过期）→ 立即获取成功，返回 LockHandle
  ├─ key 已被锁定 + waitTimeout=0 → 立即返回 null
  └─ key 已被锁定 + waitTimeout>0 → 轮询等待，超时返回 null
```

#### 核心 API

| 方法 | 说明 |
|---|---|
| `acquire(key, options)` | 获取锁，返回 `LockHandle` 或 `null` |
| `release(key, lockId)` | 释放锁（需验证 lockId，防止过期锁被错误释放） |
| `releaseHandle(handle)` | 通过 handle 释放锁的便捷方法 |
| `refresh(key, lockId, ttl)` | 续期锁（长时间操作可定期续约） |
| `isLocked(key)` | 检查 key 是否被锁定 |
| `getActiveLocks()` | 获取所有活跃锁信息（供健康检查） |
| `startCleanup()` / `stopCleanup()` | 启动/停止后台过期锁清理定时器 |

#### `AcquireOptions`

| 参数 | 默认值 | 说明 |
|---|---|---|
| `ttl` | 30000 (30s) | 锁的存活时间 |
| `waitTimeout` | 0 (不等待) | 等待获取锁的超时时间 |
| `pollInterval` | 100 (ms) | 等待时的轮询间隔 |

#### 关键设计决策

1. **lockId 验证**：释放锁时需提供 `lockId`，防止以下场景：
   - A 获取锁 → TTL 过期 → B 获取锁 → A 调用 `release()` → 不验证的话会错误释放 B 的锁

2. **后台清理**：每 5 秒扫描一次过期锁，防止内存泄漏。`acquire()` 时也会惰性检查。

3. **自动启动**：模块导入时自动调用 `startCleanup()`，无需手动初始化。

#### 集成到搜索引擎

在 `search-engine.ts` 的 `scrapeVideo()` 方法中，爬取视频前获取 `scrape:${itemUrl}` 锁（TTL 60s），防止跨 Job 重复爬取同一 URL：

```typescript
const lockKey = `scrape:${itemUrl}`;
const lockHandle = await ttlLock.acquire(lockKey, { ttl: 60000 });
if (!lockHandle) {
  this.log(job, `视频正在被其他任务爬取: ${targetItem.title}`, 'warn');
  return targetItem;
}

try {
  // ... 爬取逻辑
} finally {
  this.scrapingItems.delete(itemKey);
  if (lockHandle) ttlLock.releaseHandle(lockHandle);
}
```

### EventBus — 全局广播站

**文件**：`src/lib/core/event-bus.ts`（191 行）

#### 设计

类型安全的发布/订阅事件系统，通过 `EventMap` 接口约束事件名和载荷类型，支持通配符订阅和 Socket.IO 桥接。

#### 事件类型映射（`EventMap`）

| 事件名 | 载荷 | 发射位置 |
|---|---|---|
| `task:created` | `{ taskId, title?, source? }` | `search-engine.ts`、`tasks/route.ts` |
| `task:progress` | `{ taskId, progress, status, speed? }` | `server.ts` 进度回调 |
| `task:completed` | `{ taskId, title? }` | `download-manager.ts` |
| `task:failed` | `{ taskId, error }` | `download-manager.ts` |
| `task:cancelled` | `{ taskId }` | `download-manager.ts` |
| `search:started` | `{ jobId, keywords }` | `search-engine.ts` |
| `search:completed` | `{ jobId, totalFound, totalDownloaded }` | `search-engine.ts` |
| `scrape:started` | `{ pageUrl }` | `search-engine.ts` |
| `scrape:failed` | `{ pageUrl, error }` | `search-engine.ts` |
| `sniff:url` | `{ url, type }` | 嗅探模块（预留） |
| `system:shutdown` | `{ reason }` | `server.ts` 关闭流程 |

#### 核心 API

| 方法 | 说明 |
|---|---|
| `on(event, handler)` | 订阅事件，返回 `EventSubscription`（含 `unsubscribe()`） |
| `on('*', handler)` | 通配符订阅，接收所有事件（用于日志） |
| `once(event, handler)` | 订阅一次，触发后自动取消 |
| `emit(event, payload)` | 发布事件，同步通知所有订阅者 + 桥接 Socket.IO |
| `getLastEvent(event)` | 获取最近一条事件缓存（迟到订阅者补全状态） |
| `setSocketBridge(fn)` | 设置 Socket.IO 桥接函数，所有 `emit` 自动推送到前端 |
| `getStats()` | 返回事件类型数、总处理器数、通配符处理器数 |

#### 关键设计决策

1. **强类型约束**：`EventMap` 接口确保 `emit('task:progress', {...})` 的载荷类型正确，TypeScript 编译时检查。

2. **错误隔离**：单个 handler 抛异常不影响其他 handler 执行，每个 handler 调用包裹在 `try/catch` 中。

3. **最近事件缓存**：每个事件类型保留最后一条，`getLastEvent()` 可供迟到的订阅者补全初始状态（如页面刚加载时获取最后一次进度）。

4. **Socket.IO 桥接**：`setSocketBridge()` 设置后，所有 `emit` 自动通过 `getIO().emit(event, payload)` 推送到前端。前端通过 `useEventBus()` Hook 或直接监听 Socket.IO 事件接收。

#### 前端 Hook — `useEventBus`

**文件**：`src/hooks/use-event-bus.ts`（52 行）

```typescript
const { lastEvent, count } = useEventBus('task:completed');
```

组件挂载时自动订阅指定事件，卸载时自动取消订阅。

#### 集成到 DownloadManager

在 `download-manager.ts` 中，任务完成/失败/取消时发射 EventBus 事件：

```typescript
// 任务完成
this.emitProgress(task.ID, 100, download.totalSegments, download.totalSegments, 'completed');
eventBus.emit('task:completed', { taskId: task.ID, title: task.VideoInfo?.Title });

// 任务失败
eventBus.emit('task:failed', { taskId: task.ID, error: errMsg });

// 任务取消
this.emitProgress(taskId, 0, 0, 0, 'cancelled');
eventBus.emit('task:cancelled', { taskId });
```

#### 集成到搜索引擎

在 `search-engine.ts` 中，搜索启动/完成、爬取启动/失败时发射事件：

```typescript
eventBus.emit('search:started', { jobId: job.id, keywords: job.keywords });
eventBus.emit('search:completed', { jobId: job.id, totalFound: job.totalFound, totalDownloaded: job.totalDownloaded });
eventBus.emit('scrape:started', { pageUrl: targetItem.pageUrl });
eventBus.emit('scrape:failed', { pageUrl: targetItem.pageUrl, error: errMsg });
```

#### Server.ts 桥接

在 `server.ts` 中，下载进度回调同时通过两条通道推送：

1. **`broadcastProgress(msg)`** — 直接通过 Socket.IO 发送 `'progress'` 事件，保持 `ProgressMessage` 原始格式（snake_case），供 `task-store.ts` 的 `subscribeToSocket()` 消费
2. **`eventBus.emit('task:progress', ...)`** — 通过 EventBus 发射 camelCase 格式事件，经 Socket.IO 桥接后供 `useEventBus('task:progress')` Hook 消费

```typescript
dm.setProgressCallback((msg: ProgressMessage) => {
  // 直接广播 'progress' 事件到前端，保持 ProgressMessage 原始格式
  broadcastProgress(msg);

  // 同时通过 EventBus 通知服务端内部监听者
  eventBus.emit('task:progress', {
    taskId: msg.task_id,
    progress: msg.progress,
    status: msg.status,
    speed: msg.speed,
  });

  if (msg.status === 'completed') {
    eventBus.emit('task:completed', { taskId: msg.task_id });
  } else if (msg.status === 'failed') {
    eventBus.emit('task:failed', { taskId: msg.task_id, error: 'Download failed' });
  }
});

eventBus.setSocketBridge((event, payload) => {
  getIO().emit(event, payload);
});
```

**双通道设计原因**：`task-store` 需要原始 `ProgressMessage` 格式（`task_id` 为 snake_case），而 `useEventBus` Hook 和服务端内部监听者需要 EventBus 的 camelCase 格式（`taskId`）。两条通道并行，互不干扰。

### RouteStatePersist — 路由状态保持

**文件**：`src/lib/core/route-state.ts`（249 行）

#### 设计

基于 `sessionStorage` 的路由级状态持久化，每个路由独立命名空间，支持 TTL 过期和滚动位置恢复。

#### 核心 API

| 方法 | 说明 |
|---|---|
| `save(routeKey, data, scrollTop)` | 保存路由状态到 sessionStorage |
| `load(routeKey, ttl)` | 读取路由状态，TTL 过期返回 null |
| `clear(routeKey)` | 清除指定路由状态 |
| `clearAll()` | 清除所有路由状态 |

#### `useRouteState` Hook

```typescript
const { savedData, restoreScroll, saveState } = useRouteState(pathname, {
  ttl: 10 * 60 * 1000,  // 10 分钟 TTL
  saveScroll: true,      // 保存滚动位置
  scrollSelector: '.content-area',
});
```

| 返回值 | 说明 |
|---|---|
| `savedData` | 路由上次保存的状态数据（`useState` 懒初始化，首次渲染即恢复） |
| `restoreScroll()` | 手动恢复滚动位置 |
| `saveState(data)` | 保存当前状态 + 滚动位置 |

#### 关键设计决策

1. **懒初始化恢复**：使用 `useState(() => loadFromStorage())` 而非 `useEffect + setState`，避免首次渲染后触发额外的 re-render（React 19 的 `react-hooks/set-state-in-effect` 规则）。

2. **卸载时保存**：通过 `useEffect` 的 cleanup 函数在组件卸载（路由切换）时自动保存当前滚动位置。

3. **TTL 过期保护**：默认 5 分钟，搜索页 10 分钟。过期的状态不恢复，避免显示过时数据。

4. **滚动位置恢复**：延迟 100ms 恢复滚动位置，等 DOM 渲染完成后再设置 `scrollTop`。

5. **`beforeunload` 持久化**：页面卸载时自动 flush 到 sessionStorage，防止数据丢失。

#### 集成到搜索页

```typescript
const { savedData, saveState } = useRouteState(pathname, {
  ttl: 10 * 60 * 1000,
  saveScroll: true,
});

// 懒初始化恢复状态
const [keywords, setKeywords] = useState(() => (savedData?.keywords as string) ?? "");
const [selectedSiteId, setSelectedSiteId] = useState(
  () => (savedData?.selectedSiteId as string) ?? "kanav"
);
const [activeJobId, setActiveJobId] = useState<string | null>(
  () => (savedData?.activeJobId as string | null) ?? null
);

// 状态变化时自动保存
useEffect(() => {
  saveState({ keywords, selectedSiteId, activeJobId });
}, [keywords, selectedSiteId, activeJobId, saveState]);
```

#### 集成到任务页

```typescript
const { savedData, saveState } = useRouteState(pathname, {
  ttl: 5 * 60 * 1000,
  saveScroll: true,
});

const [expandedTask, setExpandedTask] = useState<number | null>(
  () => (savedData?.expandedTask as number) ?? null
);

useEffect(() => {
  saveState({ expandedTask });
}, [expandedTask, saveState]);
```

### 集成改造

#### `server.ts` 重构（126 行，原 48 行）

**之前**：
- `setTimeout(initDownloadManager, 500)` 延迟初始化
- 5 次重试 + 指数退避
- 无信号处理，`Ctrl+C` 直接终止进程
- 无关闭流程

**之后**：
- 3 个 init hooks（Socket.IO → DownloadManager → EventBus Bridge）
- 4 个 shutdown hooks（HTTP → DownloadManager → TTL Lock → EventBus）
- 信号自动监听，优雅关闭
- 进度回调改为通过 EventBus 发射，再由 Socket.IO 桥接推送

#### `src/app/api/health/route.ts` 增强

**之前**：
```json
{ "status": "ok", "time": 1234567890, "version": "2.0.0" }
```

**之后**：
```json
{
  "status": "ok",
  "lifecycle": {
    "status": "ready",
    "uptime": 3600000,
    "uptimeStr": "1h 0m 0s",
    "startedAt": "2026-07-09T10:00:00.000Z",
    "initHooks": 3,
    "shutdownHooks": 4,
    "lastError": null
  },
  "eventBus": {
    "eventTypes": 8,
    "totalHandlers": 15,
    "wildcardHandlers": 1
  },
  "activeLocks": 2,
  "time": 1234567890,
  "version": "2.0.0"
}
```

#### `src/hooks/index.ts` 更新

新增导出 `useEventBus` hook：

```typescript
export { useEventBus } from './use-event-bus';
export type { UseEventBusReturn } from './use-event-bus';
```

### Linter 问题与修复

实施过程中遇到 3 类 Lint 错误，全部修复：

#### 1. `Function` 类型不安全（event-bus.ts）

**错误**：`@typescript-eslint/no-unsafe-function-type`

```typescript
// 修复前
private handlers: Map<string, Set<Function>> = new Map();
on(event: string, handler: Function): EventSubscription { ... }

// 修复后
private handlers: Map<string, Set<(payload: unknown) => void>> = new Map();
on(event: string, handler: (payload: unknown) => void): EventSubscription { ... }
```

#### 2. `require()` 导入禁止（server.ts）

**错误**：`@typescript-eslint/no-require-imports`

```typescript
// 修复前
eventBus.setSocketBridge((event, payload) => {
  const { getIO } = require('./src/lib/ws/socket');
  getIO().emit(event, payload);
});

// 修复后
import { initSocketIO, getIO } from './src/lib/ws/socket';
eventBus.setSocketBridge((event, payload) => {
  getIO().emit(event, payload);
});
```

#### 3. Effect 中同步 setState（route-state.ts、search/page.tsx、tasks/page.tsx）

**错误**：`react-hooks/set-state-in-effect` — React 19 禁止在 `useEffect` 中同步调用 `setState`，会导致级联渲染。

```typescript
// 修复前（route-state.ts）
const [savedData, setSavedData] = useState(null);
useEffect(() => {
  const entry = routeStateInstance.load(routeKey, ttl);
  if (entry) {
    setSavedData(entry.data);  // ← 触发额外渲染
  }
}, [routeKey, ttl]);

// 修复后（懒初始化）
const [savedData] = useState(() => {
  const entry = routeStateInstance.load(routeKey, ttl);
  return entry?.data ?? null;  // 首次渲染即恢复，无额外渲染
});
```

搜索页和任务页同理，将 effect 中的 `setState` 改为 `useState` 懒初始化。

### 新增文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/lib/core/index.ts` | 21 | 统一导出四个模块 |
| `src/lib/core/lifecycle.ts` | 218 | 统一生命周期管理器 |
| `src/lib/core/ttl-lock.ts` | 222 | TTL 队列锁 |
| `src/lib/core/event-bus.ts` | 191 | 全局广播站 |
| `src/lib/core/route-state.ts` | 249 | 路由状态保持 |
| `src/hooks/use-event-bus.ts` | 52 | 前端 EventBus 订阅 Hook |

### 修改文件

| 文件 | 变更 |
|---|---|
| `server.ts` | 从 48 行重写为 126 行：LifecycleManager 管理启动/关闭流程，EventBus 桥接替代直接 io.emit |
| `src/lib/downloader/download-manager.ts` | 新增 `eventBus` 导入；任务完成/失败/取消时发射 EventBus 事件 |
| `src/lib/search/search-engine.ts` | 新增 `ttlLock` + `eventBus` 导入；爬取前获取 TTL 锁防重复；搜索/爬取生命周期发射事件 |
| `src/app/api/health/route.ts` | 增强健康检查：返回生命周期状态、EventBus 统计、活跃锁数量 |
| `src/app/search/page.tsx` | 集成 `useRouteState`：恢复/保存关键词、站点选择、Job ID |
| `src/app/tasks/page.tsx` | 集成 `useRouteState`：恢复/保存展开的任务详情 |
| `src/hooks/index.ts` | 导出 `useEventBus` hook |

### 验证结果

- 所有新增文件 Linter 检查通过，0 error 0 warning
- 所有修改文件 Linter 检查通过，0 error（仅 3 个 pre-existing warning）
- `server.ts` 重构后 init/shutdown hook 注册正确
- `EventMap` 类型约束编译通过，事件载荷类型安全
- `useRouteState` 懒初始化模式符合 React 19 规范
- TTL 队列锁在 `scrapeVideo` 中正确获取和释放（finally 块）
- EventBus 桥接到 Socket.IO 的 try/catch 容错处理正确

---
