# PuchiPix 模块通信链路审计报告

> 审计日期: 2026-07-22 | 审计范围: 后端 Go + 前端 Next.js 全栈

---

## 一、数据流全景图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              前端 (localhost:10540)                               │
│                                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  task-store   │  │ gallery-store│  │ socket-store │  │  use-api (React Query) │ │
│  │  (Zustand)    │  │  (Zustand)   │  │  (Zustand)   │  │  stats/prefs/config    │ │
│  └───┬──────┬────┘  └──┬──────┬────┘  └──────┬───────┘  └───────────┬───────────┘ │
│      │ HTTP │ SSE      │ HTTP │ SSE          │ WS                      │ HTTP        │
│      ▼      ▼          ▼      ▼              ▼                         ▼             │
│  ┌───────────────────────────────────────────────────────────────────────────────┐ │
│  │                      server.ts (HTTP Proxy :10540→:10541)                       │ │
│  │  /api/* ──HTTP Proxy──> Go Backend    /ws ──TCP Upgrade──> Go Backend          │ │
│  └───────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────┬────────────────────────────────────────────┘
                                       │
┌──────────────────────────────────────┼────────────────────────────────────────────┐
│                              后端 (localhost:10541)                                │
│                                      │                                              │
│  ┌───────────────────────────────────┼──────────────────────────────────────────┐ │
│  │                    HTTP Handlers (chi router)                                  │ │
│  │  /api/tasks/stream (SSE)  /api/tasks (REST)  /ws (WebSocket)  /api/dag/*     │ │
│  └──────┬──────────────────────────────┬──────────────────┬──────────────────────┘ │
│         │                              │                  │                         │
│         ▼                              ▼                  ▼                         │
│  ┌──────────────┐              ┌──────────────┐   ┌──────────────┐                 │
│  │   EventBus    │◄─────────────│  TaskStream  │   │  WS Handler  │                 │
│  │   (in-memory) │              │  SSE (8种事   │   │  (13种事件)  │                 │
│  └───┬─────┬─────┘              │  件订阅)     │   └──────────────┘                 │
│      │     │                    └──────────────┘                                     │
│      │     │                                                                         │
│      ▼     ▼                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐          │
│  │                       Orchestrator 核心层                              │          │
│  │                                                                        │          │
│  │  DagOrchestrator ◄──adapter──► SchedulerEngine                        │          │
│  │       │                              │                                 │          │
│  │       │                    ┌─────────┴──────────┐                      │          │
│  │       ▼                    │                    │                      │          │
│  │  StateMachine     SlotPool ◄── ReadyQueue      │                      │          │
│  │       │                    │                    │                      │          │
│  │       ▼                    ▼                    ▼                      │          │
│  │  EventStore ──► EventBus    Executors (scrape/download/verify/extract) │          │
│  │       │                                                                 │          │
│  │       ▼                                                                 │          │
│  │  PostgreSQL (dag_events, dag_snapshots)                                │          │
│  └──────────────────────────────────────────────────────────────────────┘          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、发现的 9 个冗余中转/低效链路

### P0-1: Orchestrator ↔ Scheduler 双向适配器层 (完全冗余)

**位置**: `backend/cmd/puchipix-server/main.go:144-149`

**问题描述**:
Orchestrator 和 Scheduler 通过两个适配器层双向通信，每个适配器只做纯字段拷贝：

```
DagOrchestrator.SubmitDag()
  → SchedulerInterface.Submit(node)          // 接口
    → schedulerAdapter.Submit()              // 适配器：拷贝8个字段
      → SchedulerEngine.Submit(adapter)      // 另一套类型
        → 执行...
          → DagOrchestratorInterface.OnNodeCompleted()  // 接口
            → orchestratorAdapter.OnNodeCompleted()     // 适配器：再次拷贝
              → DagOrchestrator.OnNodeCompleted()
```

**冗余点**:
1. `orchestrator.SchedulableNode` (types.go:285) 和 `scheduler.SchedulableNodeAdapter` (engine.go:38) 字段完全一致
2. `orchestrator.ResourceRequirement` (types.go:120) 和 `slot.ResourceRequirement` (pool.go:342) 字段完全一致——注释明确写着 "to avoid a circular import"
3. `orchestrator.SlotUsage` (types.go:127) 和 `slot.SlotUsage` (pool.go:349) 同样重复
4. `schedulerAdapter` (main.go:275-305) 做纯字段映射
5. `orchestratorAdapter` (main.go:322-362) 做纯参数转换

**根因**: orchestrator 和 scheduler 分属不同 Go package，通过 interface 隔离避免循环引用。但这两个包语义上是紧密耦合的单体——scheduler 离开 orchestrator 没有任何独立存在价值。

**优化方案**: 合并 `orchestrator/dag/` 和 `orchestrator/scheduler/` 为同一 package，共享 `SchedulableNode` 和 `ResourceRequirement` 单一定义。删除两个适配器（~80行纯锅炉板）。

**预期收益**: 消除 4 个类型定义重复 + 2 个适配器对象 + 每次转发的字段拷贝开销。

---

### P0-2: 前端 SSE 连接重复 (task-store 和 gallery-store 各自独立连接)

**位置**:
- `frontend/src/store/task-store.ts:134` — `connectSSE()`
- `frontend/src/store/gallery-store.ts:39` — `connectSSE()`

**问题描述**:
两个 Zustand store 各自建立独立的 `EventSource` 连接到**同一个** SSE 端点 `/api/tasks/stream`：

```
task-store.connectSSE()
  → new EventSource('/api/tasks/stream')    // 连接 #1
  → 监听: initial, upsert, patch, delete, sniffTask, nodeProgress

gallery-store.connectSSE()
  → new EventSource('/api/tasks/stream')    // 连接 #2 (重复!)
  → 监听: initial(仅gallery过滤), patch(仅gallery字段), nodeProgress(进度映射)
```

**冗余点**:
1. **两个 TCP 连接**占用双倍浏览器连接资源（浏览器限制同域名 6 个连接）
2. **`initial` 事件发送两次**——每次 SSE 连接建立时 Go 后端都查询全量 `download_tasks` 表并推送
3. **`nodeProgress` 事件被两个 store 独立处理**——gallery-store 需要解析同样的数据做进度映射
4. **`patch` 事件逻辑几乎相同**——只是过滤条件不同

**优化方案**:
创建**统一 SSE 连接管理器**，单例 EventSource 连接到 `/api/tasks/stream`，通过事件分发器桥接到各 store：

```ts
// 新建 lib/sse/sse-bridge.ts
class SseBridge {
  private eventSource: EventSource;
  private listeners = new Map<string, Set<Function>>();

  connect() {
    this.eventSource = new EventSource('/api/tasks/stream');
    this.eventSource.addEventListener('initial', (e) => this.dispatch('initial', e));
    this.eventSource.addEventListener('upsert', (e) => this.dispatch('upsert', e));
    // ... 其他事件
  }

  on(event: string, handler: Function) { /* ... */ }
  private dispatch(event: string, e: MessageEvent) { /* fan-out to listeners */ }
}
```

两个 store 改为订阅 SseBridge 单例而非各自创建 EventSource。

**预期收益**: SSE 连接数从 2 降到 1，`initial` 数据库查询减半，减少浏览器连接竞争。

---

### P0-3: SSE initial 事件与 HTTP fetch 数据重复

**位置**:
- `frontend/src/store/task-store.ts:58-107` — `fetchTasks()` (HTTP)
- `backend/internal/api/handlers/task_stream.go:25-44` — SSE `initial` 事件 (DB查询)
- `frontend/src/store/gallery-store.ts:26` — `fetchGalleries()` (HTTP)

**问题描述**:
页面加载时的数据获取路径：

```
页面加载
  ├─ task-store.fetchTasks()
  │   ├─ fetch('/api/tasks')           ──► Go: SELECT * FROM download_tasks
  │   └─ fetch('/api/shelf?limit=500') ──► Go: SELECT * FROM galleries
  │
  └─ task-store.connectSSE()
      └─ EventSource '/api/tasks/stream'
          └─ SSE initial 事件 ──► Go: SELECT * FROM download_tasks  (再次查询!)
```

**问题**:
1. `download_tasks` 表在 HTTP 请求和 SSE 连接中各查询一次，**数据完全重复**
2. 前端收到 HTTP 响应 → 设置状态 → 几毫秒后 SSE `initial` → **全量替换**状态
3. `gallery-store` 的 HTTP fetch 获取 `galleries` 数据，但 SSE `initial` 只含 `download_tasks` 不含 galleries——导致 gallery 数据必须依赖 HTTP

**优化方案**:
1. **SSE `initial` 扩展为全量数据**：包含 tasks + galleries + sniff tasks 的联合快照
2. **去掉 fetchTasks HTTP 调用**：让 SSE 成为初始加载的唯一路径
3. **或反过来**：保留 HTTP fetch 作为初始加载，SSE 只做增量推送（去掉 `initial` 事件）

推荐方案2：SSE 作为唯一数据源（事件溯源模式更纯粹）。

**预期收益**: 消除每次页面加载时 2 次多余 DB 查询，前后端减少 1 个 HTTP 往返。

---

### P1-4: 事件传播路径不一致 (Task 事件 vs DAG 事件走不同通道)

**位置**:
- `backend/internal/api/handlers/task_stream.go:48-104` — SSE 订阅 8 种事件
- `backend/internal/api/ws.go:64-78` — WebSocket 订阅 13 种事件
- `backend/internal/infra/eventbus.go` — 统一 EventBus

**问题描述**:
后端事件传播存在三套体系：

| 事件来源 | 传播路径 | 到达前端方式 |
|---------|---------|------------|
| 视频任务状态变更 | API handler → EventBus.Emit("task:*") | **仅 WebSocket** |
| DAG 节点状态变更 | StateMachine → EventStore → EventBus.Emit("dag:*") | SSE + WebSocket |
| Gallery 下载进度 | DownloadManager → EventBus.Emit("gallery:*") | SSE + WebSocket |
| 系统事件 (shutdown) | main.go → EventBus.Emit("system:*") | **仅 WebSocket** |

**问题**:
1. 视频任务事件 (`task:created/completed/failed`) 通过 WebSocket 推送但**不走 SSE**（SSE 的 task_stream.go 虽然订阅了这些事件，但视频任务 API handler 不一定 emit 到 EventBus——需要验证）
2. DAG 事件通过 EventStore → EventBus 自动扇出到 SSE + WS——这是正确的统一路径
3. 前端需要**同时连接 SSE 和 WebSocket** 才能获得完整事件覆盖——如果只连 SSE，会丢失 task:* 和 system:* 事件；如果只连 WS，会丢失 SSE 特有的 `initial` 全量数据

**优化方案**:
建立**统一事件出口 (Unified Event Outlet)**：
1. 所有业务事件统一 emit 到 EventBus
2. SSE 和 WebSocket 从同一个 EventBus 订阅相同的事件集
3. 前端只需连接**一种**传输方式即可获得完整数据

```go
// 新建 internal/api/event_outlet.go
type EventOutlet struct {
    eventBus *infra.EventBus
}

func (out *EventOutlet) StreamSSE(w http.ResponseWriter, r *http.Request) {
    // 统一 SSE 流：initial snapshot + 所有事件实时推送
}

func (out *EventOutlet) StreamWS(conn *websocket.Conn) {
    // 统一 WS 流：所有事件实时推送
}
```

**预期收益**: 事件传播路径一致化，前端可降级为单连接模式（SSE only 或 WS only）。

---

### P1-5: React Query 与 Zustand 混合导致数据获取两条体系

**位置**:
- Zustand stores: `task-store.ts`, `gallery-store.ts`, `sniff-store.ts`, `socket-store.ts`
- React Query hooks: `hooks/use-api.ts` (useTasksQuery, useShelfQuery, useStatsQuery, etc.)

**问题描述**:
前端存在两套**互不相通**的数据管理层：

| 特性 | Zustand (tasks/galleries) | React Query (stats/prefs/config) |
|------|--------------------------|----------------------------------|
| 初始加载 | fetch + SSE | useQuery |
| 缓存策略 | 手动（内存中） | 自动（staleTime 30s） |
| 失效机制 | SSE 事件驱动 | mutation invalidate |
| 去重 | 手动 key 判断 | 内置 queryKey |
| 竞态处理 | 无 | 内置（最新请求优先） |

**问题**:
1. `useStatsQuery()` 从 `/api/stats` 获取统计，其中的任务计数与 `task-store` 中维护的任务列表**可能不一致**
2. `useShelfQuery()` 与 `gallery-store.fetchGalleries()` 查询**相同数据源** (`/api/shelf`)
3. 两种失效机制的协调完全靠开发者手动保证

**优化方案**:
将 task-store 和 gallery-store 迁移到 React Query：
- 利用 `queryClient.setQueryData()` 处理 SSE 实时更新
- 利用 React Query 的 cache、去重、竞态处理替代手写逻辑
- 保持 SSE 连接在 React Query 外部（或作为 `queryClient` 的 persistent subscriber）

**预期收益**: 统一数据层心智模型，消除手动缓存管理代码，获得自动去重和竞态处理。

---

### P2-6: 前端 TypeScript DAG 类型完全冗余

**位置**: `frontend/src/types/dag.ts` (238 行)

**问题描述**:
`dag.ts` 完整复制了 Go 后端的 DAG 类型系统，包括：
- `NodeState` 枚举 (13 种状态)
- `VALID_TRANSITIONS` 状态转移表
- `canTransition()` / `isTerminalState()` 函数
- `IllegalTransitionError` 错误类
- `DagNodeDefinition`, `DagDefinition`, `SchedulableNode` 等接口

**但实际上**:
- 状态转移验证**只在 Go 后端执行**——前端的 `canTransition()` 从未被调用
- `VALID_TRANSITIONS` 表只作为文档存在——实际状态转换由 Go StateMachine 执行
- `DagNodeDefinition` 等接口只用于 API 响应的类型标注，不需要业务逻辑

**需要的**: 仅 API 响应类型（DagSummary, DagDetailData, DagEventsData 等，已在 `lib/dag-client/types.ts` 中）
**不需要的**: 状态机逻辑、转移表、验证函数

**优化方案**:
1. 删除 `types/dag.ts` 中 NOT used 的部分（预估 60%+）
2. 保留仅用于 API 响应反序列化的接口定义
3. 将保留部分合并到 `lib/dag-client/types.ts`，删除 `types/dag.ts`

**预期收益**: 减少 ~140 行死代码，消除 Go↔TS 类型同步维护负担。

---

### P2-7: server.ts HTTP 代理层可用 Next.js 内置 rewrites 替代

**位置**: `frontend/src/server.ts` (138 行)

**问题描述**:
自定义 Node.js 服务器仅做一件事：将 `/api/*` 和 `/ws` 请求代理到 Go 后端。Next.js 内置的 `rewrites()` 功能完全等效：

```ts
// next.config.ts - 替代整个 server.ts
{
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:10541/api/:path*',
      },
    ];
  },
}
```

但 **WebSocket upgrade 代理**（server.ts:89-116）无法简单用 rewrites 替代。不过前端 NativeWsClient 已经直连 `ws://localhost:10541/ws`，WS proxy 代码已是死代码（注释也承认 "the frontend connects directly"）。

**优化方案**:
1. 移除 server.ts，使用 `next.config.ts` rewrites 处理 HTTP 代理
2. 确认 WebSocket 不再需要 proxy 路径后，删除 WS upgrade 处理代码
3. 改用 `next dev` / `next start` 标准启动方式

**预期收益**: 删除 138 行代理代码，简化部署配置，减少一个 Node.js 进程层。

---

### P2-8: StateReconciler 接入链路断裂 (已知技术债务)

**位置**:
- `backend/internal/orchestrator/state_reconciler.go` — 已实现
- `backend/internal/orchestrator/scheduler/engine.go:127-134` — DagOrchestratorInterface 有 `GetNodeForVerification` 但未在调度循环中调用

**问题描述**:
StateReconciler 用于重启后验证节点副作用（如中断的 scrape 是否产生数据），但它的调用链路需要：
```
SchedulerEngine.scheduleLoop()
  → 发现 VERIFYING 节点
    → orchAdapter.GetNodeForVerification()  // 已实现
      → DagOrchestrator.GetNodeForVerification()  // 已实现
        → StateReconciler.VerifyNode()  // 已实现 ✅
          → 返回 VerificationResult
            → ??? 谁处理结果？谁触发 needs_retry 转换？
```

StateReconciler 的 `VerifyNode` 实现已经完整，但**调度循环中没有代码调用它**。注释也注明 "Without a reconciler the scheduler's GetNodeForVerification callback has no effect"。

**优化方案**:
在 `SchedulerEngine.scheduleLoop()` 中添加验证阶段：对进入 VERIFYING/RESUME_VERIFY 的节点调用 `dagOrchestrator.GetNodeForVerification()` → `reconciler.VerifyNode()` → 根据结果驱动状态转换。

此为项目已知技术债务，已在 MEMORY.md 记录为 "P0: VERIFYING 重启死锁 + StateReconciler 未接入"。

---

### P2-9: 前端 gallery-store normalizeGallery() 字段映射冗余

**位置**: `frontend/src/store/gallery-store.ts:68-101`

**问题描述**:
`normalizeGallery()` 对每个字段做 Go camelCase → TS PascalCase 双路径兼容（如 `raw.id ?? raw.ID`）。这是 Go→TS 迁移遗留问题——Go 后端现在统一输出 camelCase JSON，但前端仍然保留 PascalCase 类型定义。

**根因**: `types/index.ts` 中的 TypeScript 类型使用 PascalCase（如 `GalleryData.ID`），而 Go JSON 输出 camelCase（如 `{"id": 1}`）。这导致数据边界层需要逐字段映射。

**优化方案**:
统一前后端字段命名规范为 camelCase（前端 TS 类型直接匹配 Go JSON 输出），消除 `normalizeGallery()` 双路径映射。

**预期收益**: 减少 ~30 行映射代码，降低字段名不一致导致的 bug 风险。

---

## 三、优化优先级矩阵

| 优先级 | 问题 | 影响范围 | 改动量 | 风险 | 建议 |
|--------|------|---------|--------|------|------|
| **P0** | P0-1: Orchestrator↔Scheduler 适配器重复 | 后端核心路径 | ~80行删除 + 包合并 | 中 | 立即执行 |
| **P0** | P0-2: SSE 连接重复 | 前端连接资源 | ~50行 + 新模块 | 低 | 立即执行 |
| **P0** | P0-3: SSE initial vs HTTP fetch 重复 | 数据加载路径 | ~30行 | 低 | 立即执行 |
| **P1** | P1-4: 事件传播路径不一致 | 全栈事件体系 | ~100行 + 新模块 | 中 | 下一迭代 |
| **P1** | P1-5: React Query/Zustand 双轨 | 前端数据层 | ~200行迁移 | 中 | 下一迭代 |
| **P2** | P2-6: 前端 TS DAG 类型冗余 | 维护负担 | ~140行删除 | 低 | 逐步清理 |
| **P2** | P2-7: server.ts 代理层 | 部署配置 | ~138行删除 | 低 | 逐步清理 |
| **P2** | P2-8: StateReconciler 未接入 | 功能完整度 | ~50行 | 低 | 作为已知债务处理 |
| **P2** | P2-9: normalizeGallery 字段映射 | 数据边界层 | ~30行 | 低 | 逐步清理 |

---

## 四、建议的中转站 (Unified Hub)

当前项目的通信瓶颈在于缺乏**统一数据与事件总线**。建议建立以下中转站：

### 1. 后端统一事件出口 (Event Outlet)

```
所有业务模块 ──EventBus──> EventOutlet ──┬── SSE Stream (单出口)
                                        └── WebSocket Stream (单出口)
```

- 所有事件通过 EventBus 统一发布
- EventOutlet 作为唯一出口，SSE 和 WS 作为可选的传输协议
- 前端只需连接一种协议即可获取完整事件流

### 2. 前端统一数据桥 (Data Bridge)

```
SSE EventSource (单例) ──> DataBridge ──┬── React Query (tasks/shelf/stats)
                                        └── Zustand (仅 UI 状态: 主题/语言/侧边栏)
```

- `DataBridge` 作为前端数据入口的单例
- 初始数据通过 SSE `initial` 全量注入 React Query cache
- 增量更新通过 SSE 事件调用 `queryClient.setQueryData()`
- Zustand 仅保留纯 UI 状态（主题、语言、侧边栏折叠）
- 移除 HTTP fetch 作为初始加载路径

### 3. 后端统一调度域 (Unified Scheduling Domain)

```
Orchestrator + Scheduler (合并为一个 package)
  ├── StateMachine
  ├── SlotPool
  ├── ReadyQueue
  ├── SchedulingStrategy
  └── EventStore
```

- 合并后共享 `SchedulableNode`, `ResourceRequirement`, `SlotUsage` 类型
- 消除双向适配器层
- 减少 Go package 间接口定义

---

## 五、总结

本次审计发现 **9 个冗余中转/低效链路**，按优先级分为：

- **P0 (3项)**: 应立即修复的核心链路冗余，改动量小、收益明确
- **P1 (2项)**: 中优先级架构优化，需要一定重构投入
- **P2 (4项)**: 低优先级的清理项，可逐步在后续迭代中处理

完成全部 P0+P1 优化后，预期收益：
- 后端: 消除 ~4 个重复类型定义 + 2 个适配器层，简化核心调度路径
- 前端: 减少 1 个 SSE 连接 + 1 个 HTTP 往返 + 2 套数据管理体系
- 全栈: 统一事件传播路径，建立单一数据真实来源（SSE 事件溯源 + React Query cache）
