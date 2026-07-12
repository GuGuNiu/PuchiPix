# 开发日志 — 2026-07-09 — 第五轮迭代 — WebSocket 全链路修复与任务创建通知

## 第五轮迭代 — WebSocket 全链路修复与任务创建通知

### 问题背景

用户反馈：在搜索页面点击爬取视频按钮后，任务管理和下载历史页面中未出现该爬取任务。

经排查发现 5 个关联问题，均为前四轮迭代中引入但未完全连通的「断层」：

| 编号 | 问题描述 | 影响范围 |
|---|---|---|
| Bug 7 | `connect()` 从未被调用 | 全站 WebSocket 不工作 |
| Bug 8 | 事件名称不匹配 | 进度更新无法到达前端 |
| Bug 9 | 缺少 `task:created` 事件 | 新任务无法通知任务管理页 |
| Bug 10 | `POST /api/tasks` 未启动下载 | 手动添加的任务不会自动下载 |
| Bug 11 | 下载历史无实时更新 | 历史页需手动刷新 |

### Bug 7: WebSocket `connect()` 从未被调用

**现象**：搜索页面爬取视频后，任务管理页面不显示新任务，进度条不更新。

**根因**：

Bug 4 的修复声称「连接初始化逻辑迁移至 `task-store.ts` 的 `subscribeToSocket()` 中」，但实际 `subscribeToSocket()` 的实现为：

```typescript
// 问题代码 — 只读取 socket，不调用 connect()
subscribeToSocket: () => {
  const { socket } = useSocketStore.getState();
  if (!socket) return () => {};  // ← socket 永远为 null，直接返回空函数
  // ...
}
```

`useSocketStore.connect()` 在整个应用中**没有任何组件调用**。`layout.tsx` 中也没有初始化 socket 的客户端组件。

**修复**：

新建 `SocketProvider` 客户端组件，在应用根布局中包裹所有子内容：

```tsx
// src/components/providers/socket-provider.tsx
"use client";
import { useEffect } from "react";
import { useSocketStore } from "@/store/socket-store";

export default function SocketProvider({ children }: { children: React.ReactNode }) {
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);

  useEffect(() => {
    connect();
    return () => { disconnect(); };
  }, [connect, disconnect]);

  return <>{children}</>;
}
```

在 `layout.tsx` 中引入：

```tsx
<body>
  <SocketProvider>
    <div className="app-layout">...</div>
  </SocketProvider>
</body>
```

同时重构 `task-store.ts` 的 `subscribeToSocket()`，解决 socket 初始化竞态条件：

- 如果 socket 已存在（`connect()` 先于子组件 `useEffect` 执行），直接绑定监听器
- 如果 socket 不存在，通过 `useSocketStore.subscribe()` 监听 socket 变化，当 `connect()` 完成后自动绑定
- socket 被替换时，先 detach 旧 socket 的监听器，再 attach 到新 socket

### Bug 8: WebSocket 事件名称不匹配

**现象**：即使 WebSocket 连接正常，下载进度仍无法到达前端。

**根因**：

Bug 6 的修复中，服务端进度回调仅通过 EventBus 发射 `'task:progress'` 事件：

```typescript
// 问题代码 — 只通过 EventBus 发射
 dm.setProgressCallback((msg: ProgressMessage) => {
  eventBus.emit('task:progress', {  // ← 经桥接后前端收到 'task:progress'
    taskId: msg.task_id,             // ← camelCase
    progress: msg.progress,
    status: msg.status,
  });
});
```

但客户端 `task-store.ts` 监听的是 `'progress'` 事件，且期望 `ProgressMessage` 格式（snake_case 的 `task_id`）。

已存在的 `broadcastProgress()` 函数（发出 `'progress'` 事件）**从未被调用**。

**修复**：

在 `server.ts` 的进度回调中，同时通过两条通道推送：

```typescript
dm.setProgressCallback((msg: ProgressMessage) => {
  // 1. 直接广播 'progress' 事件（snake_case 格式，供 task-store 消费）
  broadcastProgress(msg);

  // 2. 通过 EventBus 发射 'task:progress' 事件（camelCase 格式，供 useEventBus Hook 消费）
  eventBus.emit('task:progress', {
    taskId: msg.task_id,
    progress: msg.progress,
    status: msg.status,
    speed: msg.speed,
  });

  // 3. 状态变更事件
  if (msg.status === 'completed') {
    eventBus.emit('task:completed', { taskId: msg.task_id });
  } else if (msg.status === 'failed') {
    eventBus.emit('task:failed', { taskId: msg.task_id, error: 'Download failed' });
  }
});
```

**双通道设计原因**：

| 通道 | 事件名 | 载荷格式 | 消费方 |
|---|---|---|---|
| `broadcastProgress()` | `'progress'` | snake_case (`task_id`) | `task-store.ts` |
| EventBus 桥接 | `'task:progress'` | camelCase (`taskId`) | `useEventBus()` Hook |

### Bug 9: 缺少任务创建通知事件

**现象**：搜索页面爬取视频创建下载任务后，任务管理页面无法实时感知。

**根因**：EventBus 的 `EventMap` 中没有 `task:created` 事件类型。搜索引擎和 API 路由在创建 Prisma 下载任务后，仅调用 `dm.startDownload()` 启动下载，不发出任何通知事件。任务管理页面的 `task-store` 只监听 `progress` 事件，且只更新已知任务的进度——对于新创建的未知任务直接忽略。

**修复**：

1. **EventBus 新增事件类型**：

```typescript
// src/lib/core/event-bus.ts
export interface EventMap {
  'task:created': { taskId: number; title?: string; source?: string };
  // ... 其他事件
}
```

2. **搜索引擎发出事件**：在 `search-engine.ts` 的 3 处任务创建位置（`scrapeVideo`、`scrapeAll`、`executeBatchSearch`）添加：

```typescript
const task = await prisma.downloadTask.create({ ... });

eventBus.emit('task:created', {
  taskId: task.id,
  title: scrapeResult.title || item.title,
  source: 'search',  // 或 'batch'
});

dm.startDownload(dlTask).catch(...);
```

3. **API 路由发出事件**：在 `POST /api/tasks` 创建任务后添加：

```typescript
eventBus.emit('task:created', {
  taskId: task.id,
  title: title || '',
  source: 'manual',
});
```

4. **task-store 监听事件并自动刷新**：

```typescript
const handleTaskCreated = (_msg: TaskCreatedMessage) => {
  scheduleRefetch();  // 500ms 节流后调用 fetchTasks()
};

socket.on('task:created', handleTaskCreated);
```

同时增强 `handleProgress`：收到未知任务（不在 `tasks` 列表中）的进度消息时，也触发 `scheduleRefetch()`，作为 `task:created` 事件丢失时的兜底。

### Bug 10: `POST /api/tasks` 未自动启动下载

**现象**：任务管理页面和仪表盘手动添加的 M3U8 链接创建任务后，任务状态一直停留在 `pending`，不会自动开始下载。

**根因**：`POST /api/tasks` 路由只创建 Prisma 任务记录并返回，不调用 `dm.startDownload()`。搜索引擎的爬取流程会自动启动下载，但手动添加的任务不会。

**修复**：

在 `POST /api/tasks` 创建任务后，如果有 M3U8 URL（直接提供的或爬虫提取的），自动启动下载：

```typescript
if (m3u8URL) {
  const dm = getDownloadManager();
  const dlTask = mapTask(task);
  dm.startDownload(dlTask).catch((err) => {
    console.error(`[Tasks] 下载任务 #${task.id} 启动失败: ${err.message}`);
  });
}
```

### Bug 11: 下载历史页面无实时更新

**现象**：任务下载完成后，下载历史页面不显示新记录，需手动点击刷新。

**根因**：`history/page.tsx` 仅在组件挂载时调用 `fetchHistory()`，不监听任何 WebSocket 事件。

**修复**：

在历史页面添加 WebSocket `progress` 事件监听，当任务状态变为 `completed`、`failed` 或 `cancelled` 时自动刷新（500ms 节流）：

```typescript
const socket = useSocketStore((s) => s.socket);

useEffect(() => {
  if (!socket) return;

  const handleProgress = (msg: { task_id: number; status: string }) => {
    if (["completed", "failed", "cancelled"].includes(msg.status)) {
      scheduleRefetch();
    }
  };

  socket.on("progress", handleProgress);
  return () => { socket.off("progress", handleProgress); };
}, [socket, fetchHistory]);
```

使用 `useSocketStore((s) => s.socket)` 响应式获取 socket，解决 socket 初始化竞态条件。

### 新增文件

| 文件 | 说明 |
|---|---|
| `src/components/providers/socket-provider.tsx` | WebSocket 连接初始化 Provider，在应用根布局包裹所有子内容 |

### 修改文件

| 文件 | 变更 |
|---|---|
| `src/app/layout.tsx` | 引入 `SocketProvider`，包裹应用内容 |
| `server.ts` | 进度回调新增 `broadcastProgress(msg)` 直接广播 `'progress'` 事件；导入 `broadcastProgress` |
| `src/lib/core/event-bus.ts` | `EventMap` 新增 `task:created` 事件类型 |
| `src/lib/search/search-engine.ts` | 3 处任务创建位置（`scrapeVideo`、`scrapeAll`、`executeBatchSearch`）发出 `task:created` 事件 |
| `src/app/api/tasks/route.ts` | `POST` 创建任务后发出 `task:created` 事件；有 M3U8 URL 时自动启动下载 |
| `src/store/task-store.ts` | 重写 `subscribeToSocket()`：响应式绑定 socket（解决竞态）；监听 `task:created` 事件自动刷新；未知任务进度触发兜底刷新 |
| `src/app/history/page.tsx` | 新增 WebSocket `progress` 事件监听，任务完成/失败/取消时自动刷新；`fetchHistory` 改为 `useCallback` |

### 数据流全链路

修复后，从搜索页面爬取到任务管理/历史页面显示的完整数据流：

```
搜索页面点击爬取
    │
    ▼
POST /api/search/scrape → engine.scrapeVideo()
    │
    ├──→ 创建 DownloadTask (Prisma)
    │
    ├──→ eventBus.emit('task:created')
    │         │
    │         ├──→ Socket.IO 桥接 → io.emit('task:created')
    │         │         │
    │         │         └──→ task-store handleTaskCreated → scheduleRefetch() → fetchTasks()
    │         │                                              │
    │         │                                              └──→ 任务管理页面自动显示新任务 ✓
    │         │
    │         └──→ 服务端内部监听者（日志等）
    │
    └──→ dm.startDownload(dlTask)
              │
              ├──→ broadcastProgress(msg)
              │         │
              │         └──→ io.emit('progress', msg)
              │                   │
              │                   ├──→ task-store handleProgress → updateTask() → 进度条实时更新 ✓
              │                   │
              │                   └──→ history-page handleProgress → 完成时 scheduleRefetch() → 历史页自动刷新 ✓
              │
              └──→ eventBus.emit('task:progress' / 'task:completed' / 'task:failed')
                        │
                        └──→ Socket.IO 桥接 → useEventBus Hook 消费
```

### 验证结果

- 所有修改文件 Linter 检查通过，0 error 0 warning
- `SocketProvider` 在应用加载时自动初始化 WebSocket 连接
- 搜索页面爬取视频后，任务管理页面通过 `task:created` 事件自动刷新，立即显示新任务
- 下载进度通过 `'progress'` 事件实时更新到任务管理页面和仪表盘
- 任务完成/失败/取消时，下载历史页面通过 `'progress'` 事件自动刷新
- `POST /api/tasks` 手动添加任务后自动启动下载
- task-store 响应式绑定 socket，解决 SocketProvider 与子组件 `useEffect` 执行顺序竞态
- 未知任务进度消息触发兜底 `scheduleRefetch()`，即使 `task:created` 事件丢失也能恢复

---
