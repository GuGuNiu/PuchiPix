# 任务删除乐观更新修复

## 概述

修复任务管理页面删除任务时无法秒删或删除后任务"复活"的问题。根因是 SSE 的 `upsert`/`initial` 事件会重新插入已乐观删除的任务，以及批量删除串行执行且无乐观更新。

## 问题分析

### 症状

- 单个删除：点击删除后任务从 UI 消失，但几秒后重新出现在列表头部
- 批量删除：任务逐个消失，速度慢，最后部分任务仍然存在

### 根因

**根因 1 — SSE `upsert` 事件"复活"已删除任务**

`handleDelete` 调用 `removeTask` 乐观移除任务后，如果 SSE 端随后推送一个 `upsert` 事件（如下载进度触发的 DB 查询），`upsert` 处理器的 `findIndex` 找不到任务，于是执行"新任务插入到列表头部"逻辑，导致任务重新出现。

```
删除流程时序：
  1. handleDelete → removeTask(id)     → 任务从 tasks 数组移除 ✅
  2. fetch DELETE /api/tasks/:id        → 服务端删除 ✅
  3. SSE upsert（并发进度事件）          → findIndex 找不到 → 插入到头部 ❌ 任务复活
  4. SSE delete（服务端 emit）           → 再次移除（但已经复活了）
```

**根因 2 — 批量删除串行 + 无乐观更新**

`handleBatchAction` 使用 `for...await` 逐个删除，且没有先调用 `removeTask` 乐观移除。10 个任务的删除需要 10 次 RTT，期间任务在 UI 上一直可见。

---

## 修复方案

### 1. `deletedKeys` 防复活机制

**文件**: `src/store/task-store.ts`

新增模块级 `deletedKeys` Set，记录最近 5 秒内删除的任务 key。在 SSE 的 `upsert` 和 `initial` 事件处理器中检查该集合，跳过已删除任务的插入。

```typescript
const deletedKeys = new Set<string>();

function markDeleted(key: string) {
  deletedKeys.add(key);
  setTimeout(() => deletedKeys.delete(key), 5000);
}
```

**应用点**：

| SSE 事件 | 修复前 | 修复后 |
|---------|--------|--------|
| `initial` | 直接 `set({ tasks: data })` | 过滤 `deletedKeys` 中的任务 |
| `upsert` | `findIndex` 找不到时插入头部 | 先检查 `deletedKeys.has(key)`，有则 `return` |
| `delete` | 从 `tasks` 数组移除 | 不变（已有逻辑正确） |

**`removeTask` 改动**：调用时同步标记 `deletedKeys`。

```typescript
removeTask: (id, taskType?: string) =>
  set((s) => {
    if (taskType) {
      const key = `${taskType}-${id}`;
      markDeleted(key);
      return { tasks: s.tasks.filter((t) => taskKey(t) !== key) };
    }
    markDeleted(`video-${id}`);
    markDeleted(`gallery-${id}`);
    return { tasks: s.tasks.filter((t) => t.ID !== id) };
  }),
```

**TTL 设计**：5 秒超时后自动从 `deletedKeys` 移除，避免内存泄漏和误阻挡后续同 ID 的新任务。

### 2. 批量删除并行 + 乐观更新

**文件**: `src/app/tasks/page.tsx`

将批量删除从 `for...await` 串行改为 `Promise.allSettled` 并行，且在发送请求前先对所有选中任务调用 `removeTask` 乐观移除。

```typescript
if (isDelete) {
  // 乐观移除
  ids.forEach((id) => {
    const task = tasks.find((t) => t.ID === id);
    useTaskStore.getState().removeTask(id, task?.TaskType === 'gallery' ? 'gallery' : 'video');
  });

  // 并行 DELETE
  const results = await Promise.allSettled(
    ids.map((id) => {
      const task = tasks.find((t) => t.ID === id);
      const isGallery = task?.TaskType === 'gallery';
      const endpoint = isGallery ? `/api/gallery/${id}` : `/api/tasks/${id}`;
      return fetch(endpoint, { method: "DELETE" });
    })
  );

  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
  const fail = results.length - ok;
  // ...
}
```

**性能对比**（10 个任务）：

| 指标 | 修复前（串行） | 修复后（并行） |
|------|-------------|-------------|
| UI 消失时机 | 最后一个 API 完成后 | 点击确认后立即 |
| 总耗时 | ~10 × RTT | ~1 × RTT |
| 乐观更新 | ❌ | ✅ |

---

## 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/store/task-store.ts` | 新增 `deletedKeys` 防复活机制；`removeTask` 标记已删除 key；`initial`/`upsert` 事件处理器过滤已删除任务 |
| `src/app/tasks/page.tsx` | 批量删除改为先乐观移除 + `Promise.allSettled` 并行请求 |

---

## 验证结果

| 验证项 | 状态 |
|--------|------|
| Lint 检查 | ✅ 无错误 |
| 单个删除 | ✅ 点击后立即消失，不再复活 |
| 批量删除 | ✅ 所有选中任务立即消失 |
| 并发 upsert 事件 | ✅ 5 秒内被 `deletedKeys` 阻挡 |
| SSE 重连 initial 事件 | ✅ 已删除任务不会重新出现 |
| 删除失败回滚 | ✅ `fetchTasks()` 重新加载（单个删除 catch 分支） |

---

## 时间戳

- 开发与测试: 2026-07-13
- 作者: PuchiPix Team
