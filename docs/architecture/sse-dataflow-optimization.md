# SSE 数据流深度分析与优化方案

> 分析日期: 2026-07-22 | 结合 PuchiPix 业务逻辑的 SSE 优化

---

## 一、SSE 完整数据流图谱

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          事件发布者 (事件生产者)                           │
│                                                                          │
│  DownloadManager          Orchestrator.StateMachine                       │
│  │ video/mananger.go      │ dag/orchestrator.go                          │
│  │                        │                                              │
│  │ task:progress (158)    │ dag:nodeStateChanged (788)                   │
│  │ task:completed (445)   │ dag:created (278)                            │
│  │ task:failed (534)      │ dag:completed                                │
│  │ task:cancelled (646)   │ dag:failed / dag:paused / dag:resumed        │
│  │                        │ dag:nodeProgress (progress callback)          │
│  └──────┬─────────────────┴────────┬────────────────────────────────────┘
│         │                          │                                      │
│         └────────┬─────────────────┘                                      │
│                  ▼                                                        │
│          ┌──────────────┐                                                │
│          │   EventBus    │  (sync dispatch, RWMutex)                      │
│          │   infra/      │                                                │
│          │   eventbus.go │                                                │
│          └───┬──────┬────┘                                                │
│              │      │                                                     │
├──────────────┼──────┼─────────────────────────────────────────────────────┤
│              │      │          SSE/WS 事件消费者                            │
│              ▼      ▼                                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────┐  │
│  │ task_stream.go       │  │ dag.go               │  │ ws.go         │  │
│  │ /api/tasks/stream    │  │ /api/dag/stream      │  │ /ws           │  │
│  │                      │  │                      │  │               │  │
│  │ 订阅 8 事件:         │  │ 订阅:                 │  │ 订阅 13 事件: │  │
│  │ task:created →upsert │  │ dag:nodeStateChanged  │  │ task:created  │  │
│  │ task:progress →patch │  │ dag:created           │  │ task:progress │  │
│  │ task:completed→patch │  │ dag:completed         │  │ dag:* events  │  │
│  │ task:failed   →patch │  │ dag:failed            │  │ gallery:*     │  │
│  │ task:cancelled→delete│  │ dag:paused            │  │ search:*      │  │
│  │ dag:nodeProgress→np  │  │ dag:resumed           │  │ system:*      │  │
│  │ dag:nodeState  →patch│  │                      │  │               │  │
│  │ gallery:*      →patch│  │                      │  │               │  │
│  └──────────────────────┘  └──────────────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、发现的 7 个 SSE 专项问题

### 问题 1: `task:created` 是死事件——生产环境从未 Emit

**位置**: `task_stream.go:50` (订阅) + `tasks.go:77-93` (TaskCreate handler)

**症状**:
```go
// task_stream.go:49-50 — 订阅了但收不到
unsubCreated := h.EventBus.On("task:created", func(payload any) {
    sse.SendEvent("upsert", payload)
})

// tasks.go:77-93 — 创建任务但没有 emit 事件
err := h.DB.QueryRow(r.Context(),
    `INSERT INTO download_tasks (...) VALUES (...) RETURNING id`, ...).Scan(&id)
// ❌ 没有: h.EventBus.Emit("task:created", task)
writeJSON(w, http.StatusCreated, map[string]any{"id": id, ...})
```

**影响**: 新创建的任务不会通过 SSE 推送到前端。前端必须依赖 HTTP fetch 或 SSE 重连后的 `initial` 事件才能看到新任务。P0-3 去掉 HTTP fetch 后会加剧此问题。

**PuchiPix 业务逻辑优化**: 在 `TaskCreate` handler 中 emit `task:created`:
```go
task := db.DownloadTask{ID: id, URL: req.URL, Status: "pending", ...}
h.EventBus.Emit("task:created", task)
```

**优先级**: 🔴 P0 — 功能缺口

---

### 问题 2: 事件传输过程中的双重序列化

**位置**: `event_store.go:101` + `task_stream.go:51-52` + `dag.go:170-174`

**症状**:
```
EventStore.AppendAsync():
  → json.Marshal(event.Payload)    // 第1次序列化 (存 DB用)
  → EventBus.Emit("dag:nodeStateChanged", event)  // 完整 event 对象

SSE handler (task_stream.go):
  → json.Marshal(payload)           // 第2次序列化! (转 SSE 文本)
  → sse.SendEvent("patch", raw)

dag.go handler:
  → json.Marshal(payload)           // 第3次序列化! (又一个消费者)
  → sse.SendEvent("dag:nodeStateChanged", string(raw))
```

**影响**:
- 同一个 `dag:nodeStateChanged` 事件在传输链路中被序列化 3 次
- `task_stream.go` 将 DAG 事件重命名为 `patch`，前端需要反序列化后猜测事件类型
- `dag.go` 将事件序列化为 `string(raw)`，前端收到的是"字符串化的 JSON 字符串"

**PuchiPix 业务逻辑优化**:
1. EventStore 预先序列化 payload 为 `json.RawMessage`
2. EventBus 直接传递 `json.RawMessage`，避免重复 Marshal
3. `task_stream.go` 保持 DAG 事件的原生名称（`dag:nodeStateChanged`），不要重命名为 `patch`

**优先级**: 🟡 P1 — 性能优化

---

### 问题 3: `patch` 事件语义过载——一个事件名承载 5 种不同数据结构

**位置**: `task_stream.go:54-93`

**症状**:
`patch` 事件可以携带任意一种数据结构：
```go
// task:progress → patch  {"id": 1, "progress": 50, "speed": "2MB/s"}
unsubProgress := h.EventBus.On("task:progress", ...)
    sse.SendEvent("patch", json.RawMessage(raw))

// task:completed → patch {"id": 1, "status": "completed", "filePath": "..."}
unsubCompleted := h.EventBus.On("task:completed", ...)
    sse.SendEvent("patch", json.RawMessage(raw))

// dag:nodeStateChanged → patch {"dagId":"...", "nodeId":"...", "from":"...", "to":"..."}
unsubNodeState := h.EventBus.On("dag:nodeStateChanged", ...)
    sse.SendEvent("patch", json.RawMessage(raw))

// gallery:downloadProgress → patch {"galleryId": 1, "completed": 5, "total": 20}
unsubGalleryProg := h.EventBus.On("gallery:downloadProgress", ...)
    sse.SendEvent("patch", json.RawMessage(raw))
```

**影响**: 前端 handler 必须检查 `patch` 事件的 payload 字段来判断"这是任务进度？DAG状态变化？还是画廊进度？"

```ts
// task-store.ts 当前的处理方式 —— 盲目信任 payload 结构
eventSource.addEventListener('patch', (e) => {
  const { id, taskType, changes } = JSON.parse(e.data); // 可能不是这个结构！
  // ...
});
```

**PuchiPix 业务逻辑优化**: 使用**语义化事件名**：
```
task:progress       → sse.SendEvent("task:progress", payload)
task:completed      → sse.SendEvent("task:completed", payload)
dag:nodeStateChanged → sse.SendEvent("dag:nodeStateChanged", payload)
gallery:progress    → sse.SendEvent("gallery:progress", payload)
```

前端按事件名精确匹配 handler，无需 payload 类型推断。

**优先级**: 🟡 P1 — 可维护性 / 正确性

---

### 问题 4: SSE `initial` 事件数据不完整——只有 video tasks 没有 galleries

**位置**: `task_stream.go:25-44`

**症状**:
```go
// task_stream.go:27-28 — 只查 download_tasks，不查 galleries/sniff_tasks
rows, err := h.DB.Query(r.Context(),
    `SELECT id, url, m3u8_url, status, progress, file_path, format, 
            priority, error_msg, seq, created_at, updated_at
     FROM download_tasks ORDER BY id DESC`)
```

**影响**:
- SSE `initial` 只包含视频下载任务，不包含图库(gallery)和嗅探(sniff)任务
- 前端 `task-store.fetchTasks()` 之前还要额外请求 `/api/shelf?limit=500` 补充 gallery 数据
- P0-3 去掉 HTTP fetch 后，图库任务不会出现在 `initial` 中

**PuchiPix 业务逻辑优化**: 扩展 SSE `initial` 为**全量任务快照**：
```sql
-- 联合查询三类任务
SELECT 'video' as task_type, id, url, status, ... FROM download_tasks
UNION ALL
SELECT 'gallery' as task_type, id, source_url as url, status, ... FROM galleries
UNION ALL  
SELECT 'sniff' as task_type, id, url, status, ... FROM sniff_tasks
ORDER BY created_at DESC
```

这样前端一次 `initial` 事件就拿到所有任务数据。

**优先级**: 🔴 P0 — 数据完整性问题

---

### 问题 5: 状态变化事件洪水——每个节点每次转换都产生事件

**位置**: `dag/orchestrator.go:787-797`

**症状**:
一个 4 节点 DAG (scrape→download→extract→verify) 的生命周期事件量：

| 节点 | 状态转移路径 | 事件数 |
|------|------------|--------|
| scrape | PENDING→READY→QUEUED→ALLOCATED→RUNNING→VERIFYING→COMPLETED | 6 |
| download | PENDING→READY→QUEUED→ALLOCATED→RUNNING→VERIFYING→COMPLETED | 6 |
| extract | PENDING→READY→QUEUED→ALLOCATED→RUNNING→VERIFYING→COMPLETED | 6 |
| verify | PENDING→READY→QUEUED→ALLOCATED→RUNNING→COMPLETED | 5 |
| **合计** | | **23 个 dag:nodeStateChanged 事件** |

每个事件 200-400 字节 JSON → 单 DAG 产生 ~7-9KB SSE 流量。

**PuchiPix 业务逻辑优化**: 

方案A: **状态压缩** — 合并相邻的快速转换。PENDING→READY→QUEUED→ALLOCATED 这 4 个转换通常在同一毫秒内完成，可以合并为单事件：
```
PENDING → ALLOCATED (包含中间状态摘要)
```

方案B: **只向客户端推送"有意义"的状态** — 前端 UI 只关心：任务开始(RUNNING)、进度(PROGRESS)、完成(COMPLETED)、失败(FAILED)
```
PENDING/READY/QUEUED/ALLOCATED → 跳过（纯内部控制流）
RUNNING → 推送
VERIFYING → 推送
COMPLETED/FAILED → 推送
```
将事件量从 23 降到 11（~52% 减少）。

**优先级**: 🟡 P1 — 带宽优化

---

### 问题 6: 无服务器端事件过滤——所有客户端接收所有事件

**位置**: `task_stream.go:48-104` + `dag.go:169-200`

**症状**:
目前 SSE 是全广播模式：每个连接的客户端接收**所有**任务和所有 DAG 的所有事件。

```
客户端 A (在看 Dashboard)  ────┐
客户端 B (在看具体图库 #42)  ──┤── 收到同样的全部事件流
客户端 C (在看搜索页)      ────┘
```

**PuchiPix 业务逻辑优化**:

方案A: **基于当前页面的按需订阅** — 前端在 SSE URL 中携带过滤参数：
```
/api/tasks/stream?dagId=gallery-42      // 只看 gallery-42 的事件
/api/tasks/stream?taskType=video         // 只看 video 任务事件
/api/tasks/stream                        // Dashboard 看全部
```

后端根据参数过滤 EventBus 订阅：
```go
dagID := r.URL.Query().Get("dagId")
if dagID != "" {
    // 只订阅该 DAG 的事件
    h.EventBus.On("dag:nodeStateChanged", func(payload any) {
        event := payload.(orchestrator.DagEvent)
        if event.DagID == dagID {
            sse.SendEvent("dag:nodeStateChanged", payload)
        }
    })
}
```

方案B: **事件频率节流** — `dag:nodeProgress` 事件在下载阶段可能每秒几十次。对进度事件做 debounce (200ms 窗口内合并)：
```go
// 进度事件节流器
type progressThrottler struct {
    mu        sync.Mutex
    lastFlush time.Time
    pending   map[string]orchestrator.NodeProgress
}
```

**优先级**: 🟡 P1 — 扩展性优化 (当前客户端少时影响小)

---

### 问题 7: gallery-store 仍然使用独立 EventSource (未迁移)

**位置**: `frontend/src/store/gallery-store.ts:39` (`connectSSE`)

**症状**:
P0-2 修复了 task-store，但 gallery-store 仍然有独立的 `connectSSE()` 方法创建自己的 EventSource。

**PuchiPix 业务逻辑优化**: 将 gallery-store 也迁移到使用 `sse-bridge.ts`:

```ts
// gallery-store.ts
import { onSseEvent, initSseBridge } from '@/lib/sse/sse-bridge';

connectSSE: () => {
    initSseBridge();
    const unsubs: (() => void)[] = [];
    
    unsubs.push(onSseEvent('initial', (data: any[]) => {
        // 从 initial 数据中提取 gallery 类型的任务
        const galleries = data.filter(d => d.taskType === 'gallery');
        set({ galleries, loading: false });
    }));
    
    unsubs.push(onSseEvent('gallery:progress', (payload) => {
        setProgress({ galleryId: payload.galleryId, ... });
    }));
    
    return () => unsubs.forEach(fn => fn());
}
```

**优先级**: 🔴 P0 — 与 P0-2 配套的完善工作

---

## 三、优化优先级与实施建议

| # | 优先级 | 问题 | 优化方向 | 预计改动 |
|---|--------|------|---------|---------|
| 1 | 🔴 P0 | task:created 死事件 | TaskCreate handler 中 emit | +3 行 |
| 2 | 🔴 P0 | SSE initial 数据不完整 | 联合查询 galleries + sniff_tasks | +15 行 SQL |
| 3 | 🔴 P0 | gallery-store 独立 EventSource | 迁移到 sse-bridge.ts | ~50 行重构 |
| 4 | 🟡 P1 | patch 事件语义过载 | 使用语义化事件名 | 重构 task_stream.go 8 个订阅 |
| 5 | 🟡 P1 | 状态变化事件洪水 | 过滤中间状态/合并快速转换 | +30 行 orchestrator |
| 6 | 🟡 P1 | 服务器端事件过滤 | URL 参数过滤 + 节流 | +80 行 |
| 7 | 🟡 P1 | 双重序列化 | 预序列化 json.RawMessage | 改 event_store.go |

---

## 四、优化后的目标 SSE 架构

```
EventBus (统一事件发布)
  │
  ├─ task:created/upsert ─────────┐
  ├─ task:progress ───────────────┤
  ├─ task:completed ──────────────┤
  ├─ dag:nodeStateChanged ────────┤
  ├─ dag:nodeProgress (debounced)─┤
  └─ gallery:progress ────────────┤
                                  ▼
                   ┌─────────────────────────┐
                   │   Unified SSE Outlet    │
                   │                         │
                   │  /api/tasks/stream      │
                   │  ?dagId=gallery-42      │    ← 按需过滤
                   │  ?taskType=video        │    ← 按类型过滤
                   │                         │
                   │  initial: 联合查三表     │    ← 全量快照
                   │  事件流: 语义化事件名    │    ← 无 patch 过载
                   │  进度: debounced 200ms   │    ← 减少洪水
                   └───────────┬─────────────┘
                               ▼
                   ┌─────────────────────────┐
                   │   Frontend SseBridge    │
                   │   (单例 EventSource)     │
                   │                         │
                   │   onSseEvent('task:*')  │
                   │   onSseEvent('dag:*')   │
                   │   onSseEvent('gallery:*')│
                   └───────────┬─────────────┘
                               ▼
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
       task-store        gallery-store       sniff-store
```
