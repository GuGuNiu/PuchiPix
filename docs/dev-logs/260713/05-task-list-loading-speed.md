# 任务列表加载速度优化

## 概述

解决 tasks 页面进入后需要等待 2~3 秒才能显示数据列表的问题。通过分析数据流，发现 SSE 连接建立后需要同步查询全量数据库才发送 `initial` 事件，导致初始渲染被阻塞。

## 问题分析

从服务器日志观察到：

- `GET /api/tasks` — **25~34ms**（HTTP 请求极快）
- `GET /api/tasks/stream` — **3.3s → 410ms**（SSE 连接建立慢）

之前的逻辑：页面加载时同时发起 HTTP 请求和 SSE 连接，但 SSE 的 `initial` 事件会覆盖 HTTP 数据。由于 SSE 需要同步查询数据库后才发送首条事件，用户被迫等待 SSE 就绪才能看到列表。

## 修改清单

### 1. SSE 后端 — 立即发送空 initial，异步加载全量数据

**文件**: `src/app/api/tasks/stream/route.ts`

**变更**: SSE 连接建立后，先立即发送空数组 `[]` 让客户端结束 loading，再异步查询数据库并推送全量数据。

```typescript
// 立即发送空数组，让客户端快速结束 loading 状态
send('initial', []);

// 异步加载全量数据并推送
fetchAllTasks().then((tasks) => {
  send('initial', tasks);
}).catch((err) => {
  console.error('[SSE] 异步加载任务列表失败:', err);
});
```

同时给 `fetchAllTasks` 的 Prisma 查询添加 `take: 500` 限制，防止未来数据量增大时查询过慢：

```typescript
prisma.downloadTask.findMany({ ... take: 500 })
prisma.gallery.findMany({ ... take: 500 })
```

### 2. 前端 Store — 空数组不覆盖已有 HTTP 数据

**文件**: `src/store/task-store.ts`

**变更**: SSE `initial` 事件处理逻辑优化。如果 HTTP 已经加载了数据，SSE 发送的空 `initial` 不会清空列表；有数据时则正常更新。

```typescript
eventSource.addEventListener('initial', (e: MessageEvent) => {
  const data = JSON.parse(e.data) as DownloadTask[];
  const filtered = data.filter((t) => !deletedKeys.has(taskKey(t)));
  set((s) => {
    if (filtered.length === 0 && s.tasks.length > 0) {
      return { loading: false }; // 空数组不覆盖已有数据
    }
    return { tasks: filtered, loading: false };
  });
});
```

## 优化后数据流

1. 页面加载 → HTTP `GET /api/tasks`（~25ms）→ **立即渲染列表**
2. 同时 SSE 连接建立 → 立即收到空 `initial` → 忽略（已有数据）
3. SSE 异步查询完成 → 收到全量 `initial` → 静默同步，列表不闪烁

## 效果

- 进入 tasks 页面后，**HTTP 数据一到就立即显示**，不再需要等待 SSE 的延迟
- 从原来的 **2~3 秒** 延迟优化到 **毫秒级** 响应
- SSE 仍保持实时增量更新能力，不影响后续进度推送

## 关联修改

- `src/app/api/tasks/stream/route.ts` — SSE 初始推送策略 + 查询限制
- `src/store/task-store.ts` — initial 事件处理逻辑

---

*2026-07-13*
