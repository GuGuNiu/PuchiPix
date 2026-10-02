# 任务状态机与数据链设计

> 2026-09 重构说明：视频任务实体状态（`download_tasks.status`）的流转收敛到
> `backend/internal/taskstate` 单一权威；转码/合并进度实时落库；`probing`
> 成为真实持久化状态；SSE 断线重放按任务缓存。本文描述重构后的完整设计。

## 一、五层状态视图

项目里"任务状态"同时存在于五个层面，理解它们的分工是读懂状态流转的前提：

| 层 | 载体 | 权威 | 说明 |
|---|---|---|---|
| 1. DAG 节点 FSM | 内存 `NodeState`（14 态，`orchestrator/types.go`） | `TaskStateMachine.Transition` 集中守护 | 调度层状态机，带转移表、历史、策略覆盖 |
| 2. 实体状态 | SQLite `download_tasks/galleries/sniff_tasks.status` | **视频：`taskstate.Store`（本次新增）**；gallery/sniff 仍分散写入 | 面向用户/API 的持久化状态 |
| 3. 文件/分片进度 | `taskprogress`（内存 + checkpoint 表） | 各 Engine | gallery 每文件、video 每分片 |
| 4. 下载器运行态 | `ActiveDownload.Status`（active/paused/cancelled） | DownloadManager | 进程内生命周期，暂停/取消需镜像到第 2 层 |
| 5. 展示态 | `task_compute` 派生（EffectiveStatus / ProgressStage / AllowedActions） | 读时计算 | 状态重命名（scraped→download_pending）与操作矩阵 |

## 二、视频实体状态机（taskstate）

```
pending ──▶ scraping ──▶ downloading ──▶ merging ──▶ transcoding ──▶ probing ──▶ completed
   ▲           │             │  │            │            │  │           │
   │           │             │  └────────────┼────────────┼──┼───────────┤
   │           └──▶ failed ◀─┘       (pause/cancel 从任一活跃态可达)    │
   └──── retry (failed/cancelled/paused → pending/downloading) ◀───────┘
```

- 转移表：`taskstate.legalFrom`（目标态 → 合法来源集合），`CanTransition` 供校验。
- 写入是**原子条件更新**：`UPDATE … WHERE id=? AND status IN (合法来源)`。
  并发冲突（API 暂停/取消 vs 管线推进）时用户操作必胜，管线收到
  `ConflictError` 后放弃本次推进——替代了旧的"先写后补"约定。
- 每次转移**恰好发出一个** `task:progress` 事件（payload 含 status/progress），
  不再依赖各写入点自觉补发。
- 附加列白名单（progress/error_msg/file_path/format/completed_segments/
  total_segments）随转移同语句写入。

### probing 是真实状态

探测窗口（转码完成 → 时长/分辨率探测完成）此前用
`status='transcoding' && progress>=100` 的魔法约定表达，前后端各复制一份。
现在管线显式 `transcoding → probing → completed`，读取端仅在
`task_compute.ComputeProgressStage` 保留旧约定的回退（兼容历史行）。

### 进度语义：相位进度与展示进度分离

`progress` 列是**分相位复用**的内部真相：downloading 阶段是分片百分比，
merging/transcoding 阶段是各自相位的百分比，相位边界由 status 区分。
`SetPhaseProgress` 以 2s / 5% 跳变节流把相位百分比落库——页面刷新、
REST 轮询、书架 15s 兜底轮询读到的都是新鲜值，不再整段停在 0%。

裸相位值在相位边界会归零（下载 100% → 合并 0%），直接展示非常突兀。
因此**展示层使用复合进度（display progress）**，在唯一权威
`task_compute.ComputeDisplayProgress` 中合成单调 0-100 刻度：

| 相位 | 展示区间 |
|---|---|
| scraping / downloading | 0–90（相位值 × 0.9） |
| merging | 90–95 |
| transcoding | 95–99 |
| probing | 99 |
| completed | 100 |
| paused / failed / cancelled | 原值（列已无法区分所属相位，不猜测） |

应用点（全部走这一个函数）：

- `EnrichTaskMap`：REST 全部任务读路径 + SSE initial 快照；
  `Progress` 输出复合值，原始相位值存入新增的 `PhaseProgress` 字段；
  ProgressStage 仍从原始值推导（保留旧行的 transcoding>=100 回退）。
- SSE `task:progress` 转发（`RewriteProgressPayload`）：重放缓存与实时帧
  都是展示就绪的复合值 + phaseProgress 原始值。
- `/api/videos` 书架列表同样输出复合值 + PhaseProgress。

非视频任务（gallery/sniff）单相位，原值透传。

分片胶囊（Segment/TotalSegments）只反映**已下载分片**：合并循环的
OnProgress 事件曾把"已合并文件数"塞进 segment 字段导致胶囊归零，
已修正为始终携带下载分片数；前端亦保留"仅 downloading 事件更新胶囊"
的纵深防护。

## 三、事件链（SSE）

`/api/tasks/stream` 的投递保证分三级：

1. **终态事件**（completed/failed/cancelled/deleted）：Critical，永不丢弃。
2. **状态转移帧**（`task:progress` 且 status 与该任务缓存不同）：
   绕过 500ms 节流，以 High 优先级投递（不进聚合器）。
3. **常规进度帧**：Low，500ms/任务节流，风暴时可被聚合并以
   `events:aggregated` 通报（前端收到后 800ms 去抖重拉自愈）。

**断线重放**：`Handlers.progressReplayCache` 按任务缓存最新一帧
（上限 500 条，FIFO 驱逐）。重连时先重放缓存（每个活跃任务一帧）、
再发各类型最后事件、**最后发 initial 快照**——顺序保证数据库真相覆盖
陈旧重放帧，而不是相反。

事件顺序（连接建立时）：订阅 → 重放缓存 → 各类型 last-event → initial → 实时事件。

**gallery 进度推送**（2026-10-01 接线）：`taskprogress.Engine.SetOnProgress`
在每次文件状态变化后携带最新摘要回调，main.go 以每 gallery 250ms 节流
emit `task:progress`（completed/total/failed/progress，不带 status——
gallery 实体状态仍由 DAG 同步与执行器所有）。此前该钩子从未安装，
gallery 文件级进度只能靠 `/api/shelf/{id}/files/progress` 轮询。

**执行器事件驱动**（2026-10-01）：`VideoDownloadExecutor` 等待终态从
"500ms 睡眠 + 1s DB 轮询"改为订阅 EventBus 终态事件
（task:completed/failed/cancelled，按 taskId 过滤，先订阅后启动下载），
保留 5s 慢轮询兜底——覆盖不发事件的裸 SQL 终态写入（如 DAG 终态护栏）。
无 EventBus 时回退为旧 1s 轮询。

## 四、崩溃恢复

优雅停机：`dm.Stop()` 把活跃任务写成 cancelled。**硬崩溃**后启动时：

- `taskstate.Store.RecoverStale` 把
  `scraping/downloading/merging/transcoding/probing` 全部重置为 paused
  （旧实现只覆盖前两者，merge/转码中崩溃的行会永久卡死且无重试入口）。
- paused 行的 AllowedActions 为 resume/cancel/delete，用户可直接恢复。
- DAG 终态护栏（`SetDagStatusSyncFn`）的可修复集合同步加入 probing。

## 五、前端消费

- 任务页不轮询任务列表：initial 快照 + SSE 增量；进度条下显示每任务
  速度（`speed` 字段，此前后端发送但前端未用）。
- 状态变更即相位边界：前端收到与当前不同的 status 时直接采用新进度值
  （相位重新起算），其余情况维持非回退（Math.max）保护。
- `events:aggregated` → 去抖重拉 `/api/tasks/all` 自愈被丢弃的帧。
- 视频书架（/shelf/videos）：订阅同一 SSE 流实时更新卡片状态/进度，
  "下载中"筛选涵盖 downloading/merging/transcoding/probing，转码状态
  有标签与进度条（此前书架不认识这些状态、无实时）。

## 六、建模分析与漏洞清单（2026-10-01）

把 `legalFrom` 作为有向图、把错误路径沿代码推演后，用
`taskstate/model_test.go` 将以下图性质固化为回归测试：
良构性（表引用的每个状态都有定义）、可达性（从 pending 可达所有状态）、
无死端（所有非终态可达终态）、用户动作覆盖（每个活跃相域能直达
paused/failed/cancelled，管线相域能直达 pending 自动重试）、终态封闭
（completed 不允许出边，自环除外）、恢复覆盖（ActiveStatuses 恰好覆盖
全部需抢救的非终态，且 paused 可恢复）。

分析发现并修复的漏洞：

| # | 漏洞 | 后果 | 修复 |
|---|---|---|---|
| A | 转移表缺少 活跃相位→pending 的自动重试边 | 任何下载/合并/转码失败触发 ConflictError，重试被跳过，行永久卡死（管线已死） | `legalFrom[pending]` 补齐 downloading/merging/transcoding/probing（由 `TestTransitionModelUserActionCoverage` 守护） |
| B | 转码 30 分钟超时（子 context DeadlineExceeded、父 ctx 存活）被归类为"已取消" | 超时后不写任何状态，行永久卡 transcoding | `handleDownloadError` 只把**父 context 取消**视为用户取消；子 context 超时走重试/失败路径，错误消息 "transcode timed out" |
| C | 探测窗口内（最长 15s）用户暂停/取消后，完成转移仍会执行 | 用户暂停被静默覆盖为 completed | 完成转移前复查 `downloadCtx.Err()`；转移表的条件 UPDATE 本身也会拒绝（ConflictError） |
| D | `Transition` 幂等重入（行已在目标态）丢弃 Progress | 进度回写静默丢失 | 幂等路径合并 Progress 进 Set |
| E | 管线深处返回的 ConflictError 会进重试/失败逻辑 | 与行的当前属主（用户暂停/取消）重复竞争、日志噪音 | `handleDownloadError` 入口对 ConflictError 短路 |
| F | API 层 pause/cancel/提交失败 是裸 SQL 镜像写 | 竞态下可把 completed 行覆盖成 paused/cancelled | 三处收敛到 `Handlers.stateStore.Transition`，冲突返回 409，事件由权威层统一发出 |

写入者矩阵（修复后）：管线 11 处、API 动作 3 处全部走 `taskstate.Store`；
DAG 状态同步（按 seq）与终态护栏是带 WHERE 守护的条件镜像写，属例外并已文档化。

### 剩余已知边界（不修，记录在案）

- manager 路径的 `CancelDownload` 对已完成行返回成功（尽力而为语义），
  响应体可能说 "cancelled" 而行保持 completed——数据完整性由转移表保证，
  响应语义不精确；UI 只对非终态提供 cancel，触发面极小。
- 暂停事件的进度载荷是原始分片百分比，而下载中的展示值是 ×0.9 的复合值，
  暂停瞬间百分比会有一次小幅跳升（更接近真实下载进度），纯视觉。
- DAG 暂停（PauseDag）不取消管线 context：行被 statusSync 写成 paused 后，
  管线下一步转移将 ConflictError 终止——结果一致（用户暂停获胜），但管线
  goroutine 以错误退出而非干净取消。
- galleries/sniff 实体写入仍未接入 taskstate（同构迁移是后续方向）。

## 七、已知边界与后续方向

- `galleries`/`sniff_tasks` 的实体写入仍分散在 API/executors/main 状态同步
  （约 20 处），尚未接入 taskstate——建议后续为 gallery 建立同构转移表。
- `galleries.status` 的 `scraped` 存储态与展示态 `download_pending` 的重命名
  仍发生在读时（`EnrichTaskMap`），三处名称指同一状态。
- `events:aggregated` 的重拉只覆盖首页 500 条，滚动加载的长列表依赖下一帧
  增量或手动刷新。
- gallery 进度推送为文件计数（个/总数），不带字节数；字节级进度仍只在
  gallery 详情轮询接口中。

（已完成的后续方向：视频 DAG 执行器事件驱动化、gallery 进度 SSE 推送接线，
见第三节。）
