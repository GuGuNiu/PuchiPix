# SSE 快照 × DAG ID × DAG 前置预置处理器 —— 隐性耦合根因分析与解耦方案

> **日期**: 2026-08-09
> **分析对象**: PuchiPix 后端 Go（38,129 行）/ 前端 React+TS
> **分析范围**: 开发日志库（260709~260809，488 篇）+ 源码审计
> **结论**: 三个模块存在"修好一个引发另一个"的连锁故障，根因是**状态源多头、ID 契约隐式化、事件桥接无类型约束、迁移偏移反复复发**。本文给出三维度解耦方案与已落地改造记录。

---

## 目录

1. [三模块历次故障档案](#1-三模块历次故障档案)
2. [触发链条与依赖图谱](#2-触发链条与依赖图谱)
3. [共享状态与跨模块脆弱设计盘点](#3-共享状态与跨模块脆弱设计盘点)
4. [系统性根因](#4-系统性根因)
5. [解耦方案：维度 A —— 调整模块边界](#5-解耦方案维度-a--调整模块边界)
6. [解耦方案：维度 B —— 统一状态管理](#6-解耦方案维度-b--统一状态管理)
7. [解耦方案：维度 C —— 引入成熟状态机/工作流库](#7-解耦方案维度-c--引入成熟状态机工作流库)
8. [兼容性与风险评估](#8-兼容性与风险评估)
9. [本次已落地改造](#9-本次已落地改造)

---

## 1. 三模块历次故障档案

### 1.1 SSE 快照（SSE initial snapshot / 事件流）

| # | 日期 | 故障现象 | 根因 | 修复措施 |
|---|------|---------|------|---------|
| 1 | 260722 | `task:created` 是死事件，前端 upsert 永不触发 | TaskCreate handler 插入 DB 后不 emit | 补 `EventBus.Emit("task:created")` |
| 2 | 260722 | SSE `initial` 只有 download_tasks，缺 galleries/sniff | 单表查询 | UNION ALL 三表联合查询，每行加 `taskType` |
| 3 | 260722 | `patch` 事件语义过载（1 事件名承载 5 种结构） | 事件名不语义化 | 语义化事件名：task:created/progress/completed/failed/cancelled |
| 4 | 260722 | DAG 状态事件洪水（4 节点 DAG 发 23 个事件） | 中间态无过滤 | `isUIVisibleState()` 过滤，-52% 事件量 |
| 5 | 260803 | SSE initial 快照缺失（只有 status 无 initial） | **PG 语法残留**：`::numeric`/`LEAST()` SQLite 不支持，查询失败被 `if err == nil` 静默吞掉 | 修复 26 处 SQL 残留 + 临时回归测试 |
| 6 | 260803 | SSE initial `data: []`（DB 有 20 条 galleries） | **SQLTime scan 缺陷**：TEXT 时间列 scan 进 `time.Time` 报错被 `continue` 吞掉（第 4 组）；裸时间格式解析缺失（第 5 组） | 新建 `db.SQLTime`（sql.Scanner）+ `ParseSQLiteTime` 三格式解析，全库 11 处统一 |
| 7 | 260803 | SSE 事件名断层：前端订阅旧名 `upsert/patch/delete` | 后端 260722 改语义化命名，前端未同步 | 前端全部对齐语义化事件名（7 订阅全匹配） |
| 8 | 260803 | F5 刷新进度归零 | `/api/shelf` 未返回 `progress` + 前端硬编码 `Progress: 0` | 后端返回计算后进度 + 前端读取后端值 |
| 9 | 260804 | 12 处后端写入无 SSE 发射 + 2 处 SSE 路由未转发 + 3 处前端无订阅 | SSE 事件流全链路未对齐 | 全量审计 + task:metadata 事件通道 |
| 10 | 260805 | Tasks 页面列宽抖动 | SSE 高频更新 + 无固定列宽 | `table-layout: fixed` + useReducer 动画状态 |
| 11 | 260809 | 视频任务分片列不显示数据 | SSE `task:progress` 后端发 `segment`，前端读 `completed`，字段名不匹配 | 修正字段映射 + 更新 Segment/TotalSegments |
| 12 | 260809 | Gallery 任务创建后 30s"空等" | `createGalleryTask` 缺 `UPDATE status='scraping'`，DAG 提交后 gallery.status 仍 pending | DAG 提交后补 DB 状态更新 + SSE 事件修正 |

**模式总结**: SSE 快照/事件流的故障根因高度集中于 —— (a) 事件名/字段名前后端契约断裂（4 次），(b) 数据库查询/scan 静默失败（3 次），(c) DB 状态与 FSM 状态不同步（2 次）。每一次修复都只补了断裂的"那一环"，没有建立**单一契约源**与**失败可见性**。

### 1.2 DAG ID（ID 生成 / 实体映射）

| # | 日期 | 故障现象 | 根因 | 修复措施 |
|---|------|---------|------|---------|
| 1 | 260713 | 任务 ID 冲突：视频/图包自增主键跨表重复 | 两表各自 AUTOINCREMENT | 引入 `seq` 全局编号 + DisplayID |
| 2 | 260715 | 编号回收混乱：删除后编号不释放，文件夹名带 `(4)` 后缀 | 递增计数器 + 回收逻辑复杂 | 改为 **6 位随机字符**（排除易混淆字符），文件夹名移除编号后缀 |
| 3 | 260724 | Gallery/Sniff 任务显示纯数字 ID | 前端 task-store 遗漏 `DisplayID` 映射 + 后端 JSON tag 为 `seq` | 统一 JSON tag 为 `DisplayID` + 前端兼容 |
| 4 | 260804 | DAG ID 存在数字编号（`gallery-123`/`video-456-ts`） | 工厂用 `fmt.Sprintf` 硬编码格式 | 统一为 6 位大写字母数字（A1B2C3）；**实体表新增 `dag_id` 字段显式存储映射**；清库 |
| 5 | 260809 | 3 处完全相同的 ID 生成逻辑各自维护 | DRY 违反（dag/idgen.go、api/seq.go、wire_executors.go） | 创建零依赖中立包 `internal/idgen`，统一 `GenerateID()`，规避 `dag→orchestrator` 循环依赖 |

**模式总结**: DAG ID 经历"自增 → 6 位随机 → 统一 6 位随机 + 显式映射"的演进，每次格式变更都**只改了后端生成侧，前端对旧格式的解析契约未同步迁移**——这是连锁故障的温床（详见第 2 节触发链 B）。

### 1.3 DAG 前置预置处理器（任务类型前置识别 / 路由分流）

| # | 日期 | 故障现象 | 根因 | 修复措施 |
|---|------|---------|------|---------|
| 1 | 260724 | TaskCreate 无 gallery URL 路由，图包被当视频处理 | TS→Go 迁移丢失 gallery 路由检测 | 补 gallery URL 路由检测 + createGalleryTask |
| 2 | 260724 | 列表页 URL 未被识别为嗅探任务 | 迁移丢失 `isListingPage` 路由 | `IsListingPage` → createSniffTask |
| 3 | 260726 | Kanav URL 模块无法匹配 | `site-configs.json` domains 数组为空 + baseUrl 不一致 + TaskCreate 视频路径不调用 GetModuleByUrl | 补全域名 + download_tasks 加 site_id + 全链路支持 |
| 4 | 260809 | **Kanav 视频任务被误判为图库**（类型显示"图片"、Toast 弹"图包"） | `TaskCreate` 仅依赖 `provider.(sites.GallerySiteProvider)` 接口断言判型；Kanav 因 M3U8 嗅探需要实现了该接口 | 新增**配置驱动前置处理器**：先查 `SiteModuleConfig.Type`（photo/video）再决定路由。P-TSG-7 变体 |

**模式总结**: 前置处理器的核心缺陷是**用"能力声明"（实现了什么接口）替代"类型判断"（站点是什么类型）**。接口语义混淆 + 配置-路由断裂，且每次修复都是局部打补丁（`if` 链越来越长），没有收敛为独立的路由决策模块。

---

## 2. 触发链条与依赖图谱

### 2.1 三模块全景依赖图

```
┌─────────────────────────── 前置预置处理器（任务类型路由） ───────────────────────────┐
│  TaskCreate (tasks.go L175-223)                                                     │
│    │  GetProviderByUrl → GetModule(SiteModuleConfig.Type)                           │
│    ├── type=="photo" + GallerySiteProvider ──→ createGalleryTask ──→ NewGalleryPipeline │
│    │                                              │  idgen.GenerateID() → dag_id 写回 gallery │
│    ├── type=="photo" + IsListingPage ──────────→ createSniffTask  ──→ NewSniffPipeline │
│    │                                              │  idgen → dag_id 写回 sniff_tasks        │
│    └── type=="video" / 未知 ───────────────────→ 视频任务创建 ──→ NewVideoPipeline      │
│                                                       │  idgen → dag_id 写回 download_tasks │
└───────────────────────────────┬─────────────────────────┘
                                ▼
┌─────────────────────────── DAG ID（idgen 中立包） ───────────────────────────────┐
│  idgen.GenerateID() → 6 位随机码（A1B2C3）                                         │
│  dag_id 显式存储于 galleries / download_tasks / sniff_tasks 三表                   │
│  操作查找：getGalleryDagID / getTaskDagID（查询实体表 dag_id 列）                    │
│  前端：task-store.ts dag:nodeProgress ← 曾解析 "gallery-" 前缀（已废弃格式！）       │
│        gallery-store.ts gallery:stateChanged ← 曾解析 "gallery-" 前缀（已废弃格式！）│
└───────────────────────────────┬─────────────────────────┘
                                ▼
┌─────────────────────────── SSE 快照 / 事件流 ───────────────────────────────────┐
│  initial 快照：UNION ALL 三表 → SQLTime scan → enrichTaskMap → SSE initial        │
│  事件桥：EventBus → task_stream.go 转发（11+ 事件）→ 前端 task-store/gallery-store │
│  DB 回写：gallery:stateChanged → main.go 订阅 → UPDATE galleries SET status       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 三条触发链（连锁故障的具体机制）

**触发链 A：前置处理器错判 → 错误管道 → 状态/进度全线错位**

```
Kanav 视频 URL 进入 TaskCreate
  → 前置处理器仅凭 GallerySiteProvider 接口断言 → 判为 photo
  → createGalleryTask → NewGalleryPipeline（错误管道）
  → gallery:created 事件 TaskType="gallery" → 前端显示"图片" + "图包" Toast
  → 视频管道从未执行 → 任务卡死 → 用户重试/删除 → 再次进入同一错误路由
  → 修复后（260809 前置处理器）→ 路由正确，但……
```

**触发链 B：DAG ID 格式变更 → 前端旧解析契约断裂 → 实时更新静默失效**

```
260804 DAG ID 统一为 6 位随机码（gallery-123 → A1B2C3）
  → 后端 dag:nodeProgress / gallery:stateChanged 载荷仍只带 dagId（6 位随机）
  → 前端 task-store.ts: `dagId.startsWith('gallery-')` 永远为 false
  → isNaN → return → Gallery 节点进度/失败状态实时更新永久失效（静默，无报错）
  → 用户感知"进度不动/状态不更新" → 误以为是 SSE 问题 → 又去修 SSE → 连锁
  ★ 本次已修复：后端事件载荷直接携带 galleryId/taskId/sniffId（见第 9 节）
```

**触发链 C：DB 状态 ↔ FSM 状态不同步 → 状态持久化错位**

```
createGalleryTask 提交 DAG 后未 UPDATE status='scraping'（260809）
  → gallery.status 停留 'pending' 长达 10-30s → 前端"空等"
  → 同时 DAG FSM 已 RUNNING → 内存态与 DB 态分裂
  → 崩溃恢复（main.go）依赖 DB status 判断哪些任务需要重建 DAG
  → DB 态错位 → 恢复错位 → 连锁
  ★ 本次已修复：TransitionNode 节点级 DB 状态回写（见第 9 节）
```

### 2.3 依赖关系矩阵（谁依赖谁）

| 依赖方 | 被依赖方 | 耦合形式 | 脆弱性 |
|--------|---------|---------|--------|
| TaskCreate 前置处理器 | SiteRegistry / SiteModuleConfig | 接口断言 + 配置读取 | 接口语义混淆（能力 vs 类型） |
| createGalleryTask | idgen / DagFactory / galleries 表 | dag_id 写回 | 映射写回失败则操作失效 |
| SSE task:progress | wire_executors.go 发射点 | 字段名约定（segment/completed） | 前后端各自硬编码 |
| SSE initial | task_stream.go UNION ALL SQL | SQL 兼容性 + scan 类型 | 查询失败静默吞掉 |
| SSE dag:nodeProgress | lifecycle.go 发射点 | 载荷字段约定 | 曾依赖 DAG ID 前缀格式 |
| main.go gallery:stateChanged 订阅 | dag 包发射 + galleries.dag_id | dag_id 列 | DAG ID 格式变更需同步 |
| 前端 task-store/gallery-store | 后端 SSE 事件契约 | 事件名 + 字段名 | 无类型约束，人肉对齐 |

---

## 3. 共享状态与跨模块脆弱设计盘点

### 3.1 共享/隐式全局状态

| 状态 | 位置 | 生命周期 | 风险 |
|------|------|---------|------|
| `deletedKeys`（前端模块级 Set） | task-store.ts L24 | 页面级 | 无持久化，刷新丢失 |
| `dag_id` 列（三表） | DB schema | 持久 | 写回点分散在 3 个 API 文件，无统一封装 |
| `EventBus` 全局单例 | infra/eventbus.go | 进程级 | 事件名无类型约束，字符串魔法值 |
| `seq`/`DisplayID` | DB + JSON tag | 持久 | 前后端字段名映射需人肉维护 |
| `taskKey()` = `${taskType}-${ID}` | 前端两 store | 页面级 | 复合键拼接规则隐式，SSE 载荷 ID 字段名不一致（taskId vs ID） |
| `countFilesInDir` 磁盘扫描 | task_stream.go | 查询时 | 磁盘态作为进度真相源，与 DB 态可能分裂 |

### 3.2 已确认的脆弱设计（源码证据）

1. **`wire_executors.go:215`（已修复）**: `WHERE source_url = ?13` —— PG `$13` 占位符迁移残留！SQLite 中 `?13` 会被当作**第 13 个命名参数**，而恰好该语句有 13 个绑定值，因此"侥幸正确"。参数顺序/数量一变即静默错位。这是 P-TSG SQL 语法子模式的漏网之鱼。
2. **`lifecycle.go:249`（已修复）**: `// DB status update would go here; deferred to Phase 4 integration` —— TransitionNode 的 DB 状态同步从未实现，DB 与 FSM 在终态转换时必然分裂。
3. **`task_stream.go:114`（已修复）**: `if err == nil { ... }` 无 else —— initial 查询失败被静默吞掉，正是 260803 快照缺失故障的掩盖机制。
4. **前端 dagId 前缀解析（已修复）**: task-store.ts L336 / gallery-store.ts L470 用 `dagId.startsWith('gallery-')` 解析实体 ID —— 与 260804 后的 6 位随机 DAG ID 永久脱节。
5. **CLI README/help.go**: 文档仍以 `gallery-123` 为例（README L158-201、help.go L93-104）—— 文档契约未随 ID 统一更新，会误导后续开发。

---

## 4. 系统性根因

把 1~3 节的证据收敛，连锁故障的**系统性根因**是以下四条，按严重度排序：

### R1. 状态源多头，无单一权威源（根因之首）
同一任务的"状态"至少存在 4 份：**DB 实体表状态**（galleries.status）、**FSM 内存状态**（dag.nodes[].fsm）、**EventStore 事件溯源状态**（dag_events）、**前端 store 状态**（task-store/gallery-store）。这 4 份状态通过**事件**和**调用时点**同步，任何一处遗漏（如 createGalleryTask 忘写 status）都会造成"修好 FSM、坏掉 DB"或反之。**TransitionNode 的 DB 同步 TODO 数年未实现**就是 R1 的活证据。

### R2. ID 契约隐式化，格式变更无迁移机制
DAG ID 从 `gallery-{id}` 变更为 6 位随机码时，前端解析逻辑、CLI 文档、日志约定全部散落在各处硬编码。**ID 编码格式是一种跨模块契约，但没有任何"契约注册表"或"格式版本"机制**——改一处漏三处，且漏掉的地方因静默失败而不可见。

### R3. 事件桥接无类型约束
EventBus 是 `map[string]any` + 字符串事件名，前后端各自硬编码事件名、载荷字段名（PascalCase/camelCase 混用、`taskId` vs `ID` vs `galleryId` 混用）。SSE 事件流的 4 次断裂全部源于此。**没有共享的类型定义、没有契约测试、没有运行时校验**。

### R4. 迁移偏移（P-TSG）反复复发
TS→Go 迁移（260721~260801）遗留 30+ 偏移点，且新代码不断重蹈覆辙：SQL 方言残留（`?13`）、时间列 scan 类型错误、路由检测丢失/判据降级、状态更新遗漏。每次修复都只补"这一次暴露的点"，没有建立**防复发机制**（SQL 兼容性门禁、scan 类型门禁、契约测试）。

---

## 5. 解耦方案：维度 A —— 调整模块边界

> 适用场景：**不换技术栈、小步快跑、风险敏感**。目标是把职责边界画清楚，让"路由决策""ID 生成""状态持久化"各有其主。

### A1. 收敛前置处理器为独立路由决策模块（消除接口语义混淆）

- **现状**: 类型路由逻辑内联在 `tasks.go TaskCreate`（L175-223 一大段 if 链），判据是"接口断言 + 配置 type"双条件，与执行器层的接口断言（`newScrapeExecutor` 的 `provider.(sites.GallerySiteProvider)`）**两处重复**。
- **改造**:
  1. 新建 `internal/sites/routing/task_router.go`，导出 `ResolveTaskType(siteReg, url) TaskRoute`，返回 `{Kind: gallery|sniff|video|unknown, SiteID, ModuleType}`。
  2. TaskCreate 只调用该模块，删除内联 if 链。
  3. 新增独立 `VideoSiteProvider` 接口标记视频站点，Kanav 改为实现 `VideoSiteProvider + GallerySiteProvider`（能力与类型分离的长期方案，260809 日志已建议）。
  4. `newScrapeExecutor` 复用同一路由模块（消除两处断言不一致）。
- **范围**: 2 个新文件 + tasks.go/scrape executor 改造；约 200 行。
- **迁移成本**: 低（纯重构，行为不变）；**风险**: 低（编译+单测可验证）。

### A2. DAG ID 与实体 ID 彻底分离，事件载荷携带实体 ID

- **现状**: 前端需从 DAG ID 反推实体 ID（已因格式变更断裂）。
- **改造**: 所有 DAG 相关事件（dag:nodeProgress、gallery:stateChanged、dag:nodeStateChanged）的载荷**统一携带** `galleryId`/`taskId`/`sniffId`（从节点 Config 读取），前端**禁止解析 DAG ID 格式**。
- **范围**: 后端 lifecycle.go 发射点（已做）+ 前端 2 个 store（已做）。
- **迁移成本**: 低（向后兼容：新载荷字段可选，旧字段保留）；**风险**: 低。

### A3. dag_id 写回封装为实体层方法

- **现状**: `updateGalleryDagID`/`updateTaskDagID` 散落在 api/gallery.go、api/tasks.go、api/actions.go。
- **改造**: 收敛到 `db` 包或 `entities` 包：`(e *EntityStore) SetDagID(ctx, table, entityID, dagID)`，一处实现、全链路复用。
- **范围**: 1 个新方法 + 3 处调用替换；**成本**: 极低；**风险**: 极低。

### A4. CLI/文档契约同步更新

- 修正 `internal/cli/README.md`、`help.go` 中 `gallery-123` 示例为 6 位随机 ID 示例，避免误导。

---

## 6. 解耦方案：维度 B —— 统一状态管理

> 适用场景：**已经受够了点状补丁，愿意投入中等改造**。目标：单状态源 + 事件驱动 + 失败可见。

### B1. 确立"DB 实体表 = 唯一权威状态源"（消除 4 份状态并列）

- **原则**: FSM 是"执行视图"，DB 是"事实视图"，事件是"传播通道"。所有**面向用户/前端/恢复**的状态一律从 DB 读取，FSM 状态仅供调度器内部使用。
- **改造**:
  1. `TransitionNode` 在进入终态时**必同步 DB**（本次已实现回调，建议进一步收口为 orchestrator 内置能力而非 main.go 注入）。
  2. SSE `initial` 快照一律查 DB（已如此），事件只做增量修正（已如此），保证重连后状态收敛于 DB。
  3. 崩溃恢复（main.go）以 DB status 为唯一判据重建 DAG（已如此，需保持）。
- **成本**: 中（主要是习惯与审计）；**风险**: 中（需确保 DB 写入点全覆盖）。

### B2. SSE 事件契约类型化 + 契约测试门禁

- **改造**:
  1. 定义共享事件契约：`docs/sse-events.md` 或 Go 侧 `internal/events/contract.go` 常量（事件名 + 载荷字段名 + 类型），前端从同一文档生成 TS 类型。
  2. 后端新增 `sse-contract-check` 测试（260803 已有脚本雏形），CI 强制校验：每个 `EventBus.Emit` 的事件名/字段与契约一致。
  3. `task_stream.go` 转发层做**载荷规范化**（统一 PascalCase、统一 ID 字段名），前端不再做兼容分支。
- **成本**: 中（一次契约整理 + 测试脚本）；**风险**: 低（纯校验，不改运行时行为）。

### B3. 静默失败清零：所有 `if err == nil` 加 else 告警

- 全库审计 `if err == nil { ... }` 无 else 的查询路径（本次已修复 task_stream.go initial），建立"查询失败必须可见"的门禁。
- **成本**: 低；**风险**: 低。

### B4. 迁移偏移防复发清单

- 将 P-TSG 模式（SQL 方言、时间 scan、路由判据、状态同步）固化为 checklist 或静态检查：grep `\$\d`/`\?\d{2}`（`?13` 这类）、scan 目标类型审查、`startsWith('gallery-')` 搜索。
- **成本**: 低；**风险**: 低。

---

## 7. 解耦方案：维度 C —— 引入成熟状态机/工作流库

> 适用场景：**愿意接受较大迁移，追求长期可维护性**。260722 已做过一次组件库对比（维持自研 + dominikbraun/graph + container/heap），本维度在其结论之上给出"何时值得迁移"的触发条件。

### C1. 候选库与适配分析

| 方案 | 定位 | 与现状契合度 | 迁移成本 | 风险 |
|------|------|------------|---------|------|
| **维持自研 + 强化**（当前） | 13 态 FSM + 事件溯源 + 快照恢复 | 高（已实现全部策略层） | 0 | 中（R1/R2/R3 需自建纪律） |
| **Hatchet**（Go SDK, PG-only） | 分布式任务队列 + DAG + 重试 + 观察性 | 中（需 PostgreSQL，当前 SQLite） | 高（DB 层迁移 + 语义重映射） | 高 |
| **Temporal**（Go SDK） | 持久化工作流 + 活动 + 定时器 | 低（进程外服务太重，单机无收益） | 极高 | 极高 |
| **Argo / Airflow / Prefect** | K8s / Python 生态 | 不匹配（Go 单二进制 + 本地 Windows） | — | 不适用 |
| **dagu / kflow / simple-workflow**（2025-2026 Go 库） | 轻量 DAG 调度 | 低（无事件溯源/快照恢复/槽位池） | 中 | 中（功能缺口） |

**结论（与 260722 一致）**: 当前规模（单实例、<100 并发 DAG、本地 Windows + SQLite）**不值得引入外部工作流引擎**。Hatchet 的迁移触发条件：**出现多实例部署需求 + 数据库迁移 PostgreSQL 时**再评估。

### C2. 若未来迁移到 Hatchet 的路径

1. 前置条件: PostgreSQL + 多实例 + 任务量增长 3-5 倍。
2. 语义映射: `DagNode` → Hatchet Task；`TransitionPolicy/Guard` → Hatchet 条件步骤；`SlotPool` → Hatchet worker 并发槽；`EventStore` → Hatchet 事件历史。
3. 保留: SQLite 单机模式仍走自研 FSM（双后端抽象）。
4. 风险: Hatchet 对"每节点自定义 DB 副作用 + 文件系统状态校验"（PuchiPix 的核心）支持一般，需大量 activity 封装。

### C3. 立即可做的"借用成熟理念"（零迁移成本）

- **状态机**: 借用 XState/Step Functions 的 Guard/Action/Choice 模式——**已实现**（TransitionPolicy/GuardFn/TaskTypeRegistry，260720）。
- **工作流**: 借用 Temporal 的"activity 幂等 + 确定性重放"理念，给 executor 补充幂等键（URL+type+phase），消除重复提交。
- **事件溯源**: 借用 EventStore 的"快照 + 重放"——已实现，需补**快照自动定时器**（当前仅事件数阈值触发）。

---

## 8. 兼容性与风险评估

### 8.1 各维度改造对现有功能/历史数据的兼容性

| 改造 | 历史数据兼容 | 现有功能影响 | 回滚难度 |
|------|------------|------------|---------|
| A1 路由模块化 | 无（无 schema 变更） | 行为不变（纯重构） | 低（文件级回滚） |
| A2 事件携带实体 ID | 无影响（新字段可选） | 前端新增可用字段，旧解析兜底保留 | 低 |
| A3 dag_id 封装 | 无 | 无 | 低 |
| A4 文档同步 | 无 | 无 | 低 |
| B1 DB 唯一权威 | 存量状态迁移无需 | 需验证所有 DB 写入点 | 中 |
| B2 事件契约测试 | 无 | 契约不符会被测试拦下（可能先红后绿） | 中 |
| C1 引入 Hatchet | 需数据迁移（SQLite→PG） | 全量重构 | 高 |

### 8.2 推荐落地顺序（依赖关系）

```
Phase 1（本次已完成）：A2 事件携带实体 ID + TransitionNode DB 回写 + ?13 修复 + initial 失败告警
  → 立即止血：前端实时更新恢复、DB/FSM 终态一致、静默失败可见
Phase 2：A1 路由模块化 + A3 dag_id 封装 + A4 文档同步
  → 边界清晰：前置处理器独立、ID 写回收敛
Phase 3：B2 SSE 契约测试 + B3 静默失败清零 + B4 P-TSG 防复发清单
  → 防复发：契约有测试、失败可见、迁移不复发
Phase 4（视规模增长）：C1 评估 Hatchet 迁移
  → 仅当多实例/PostgreSQL 需求出现
```

### 8.3 验证策略

- 每个 Phase 均需: `go build ./...` + `go vet ./...` + `go test ./...` + `npx tsc --noEmit` 全绿。
- 功能验证: CLI 创建 3 类任务（gallery/sniff/video），观察 SSE initial/增量事件与 DB 状态一致性；重启验证崩溃恢复。

---

## 9. 本次已落地改造

> 对应 Phase 1，2026-08-09 实施，源码证据见第 3 节。

| # | 文件 | 改造 | 效果 |
|---|------|------|------|
| 1 | `backend/internal/orchestrator/wire_executors.go` | `WHERE source_url = ?13` → `?` | 消除 PG `$13` 占位符残留（此前"侥幸正确"） |
| 2 | `backend/internal/orchestrator/dag/lifecycle.go` | `dag:nodeProgress`/`gallery:stateChanged` 载荷新增 `galleryId`/`taskId`/`sniffId`（`extractEntityID`） | 前端不再依赖 DAG ID 前缀格式 |
| 3 | `backend/internal/orchestrator/dag/orchestrator.go` | 新增 `statusSyncFn` 字段 + `SetStatusSyncFn` | TransitionNode DB 回写回调接口 |
| 4 | `backend/internal/orchestrator/dag/lifecycle.go` | `TransitionNode` 终态转换后调用 `statusSyncFn`（替换 deferred TODO） | DB/FSM 终态一致 |
| 5 | `backend/cmd/server/main.go` | 注入状态同步回调：按 galleryId/taskId/sniffId 回写 failed/cancelled | 关闭 video/sniff DAG 失败不回写 DB 的缺口 |
| 6 | `backend/internal/api/task_stream.go` | initial 查询失败加 ERROR 日志 + 空快照 | 静默失败清零（260803 根因模式修复） |
| 7 | `frontend/src/store/task-store.ts` | `dag:nodeProgress` 优先读 `galleryId`，旧前缀解析仅作兜底 | 前端 Gallery 进度实时更新恢复 |
| 8 | `frontend/src/store/gallery-store.ts` | `gallery:stateChanged` 优先读 `galleryId`，旧前缀解析兜底 | 前端 Gallery 失败/取消实时更新恢复 |

**验证结果**: `go build ./...` ✅ | `go vet ./...` ✅ | `go test ./internal/orchestrator/... ./internal/api/...` ✅ 全绿 | `npx tsc --noEmit` ✅ 零错误。

---

*报告结束。后续 Phase 2-4 见开发日志存档 260809。*
