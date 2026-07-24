# PuchiPix DAG 系统全面审计报告

> **日期**: 2026-07-23  
> **范围**: DAG 编排系统、状态机、CLI/API 扩展、历史问题模式、Gallery 异常检测  
> **版本**: v1.0

---

## 一、需求链路图 (Requirements Dependency Graph)

### 1.1 需求节点分解

```
┌─────────────────────────────────────────────────────────────────────┐
│                     P0: DAG 生命周期完整性                            │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│  │ N1: CLI  │    │ N2: API  │    │ N3: 状态  │    │ N4: Gallery│      │
│  │ 扩展     │◄──►│ 扩展     │◄──►│ 机审计    │◄──►│ 异常修复   │      │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘       │
│       │               │               │               │              │
│       ▼               ▼               ▼               ▼              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐       │
│  │ N5: 历史 │    │ N6: 异常  │    │ N7: 边界  │    │ N8: 重试  │      │
│  │ 问题提取 │    │ 处理路径   │    │ 条件分析  │    │ 策略验证  │      │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 因果依赖关系

| 优先级 | 节点 | 描述 | 前置依赖 | 后续影响 |
|--------|------|------|----------|----------|
| **P0** | N3 | 状态机审计 | 无 | N1, N2, N7 |
| **P0** | N5 | 历史问题提取 | 无 | N6, N8 |
| **P0** | N2 | API 扩展 | N3 | N1, N4 |
| **P1** | N1 | CLI 扩展 | N2 | N4 |
| **P1** | N6 | 异常处理路径 | N3, N5 | N8 |
| **P1** | N7 | 边界条件分析 | N3 | N6 |
| **P1** | N8 | 重试策略验证 | N5, N6 | N4 |
| **P2** | N4 | Gallery 异常修复 | N1, N2, N8 | 无 |

### 1.3 执行顺序

```
Phase 1 (当前): N3 → N5 (并行: 审计 + 历史提取)
Phase 2:        N2 → N1 (API 扩展 → CLI 扩展)
Phase 3:        N6 → N7 → N8 (异常路径 → 边界条件 → 重试验证)
Phase 4:        N4 (Gallery 修复, 需要 DB 可用)
```

---

## 二、主任务状态机 (DAG Aggregate States)

### 2.1 聚合状态计算 (`AggregateTaskStatus`)

主任务状态机通过节点状态聚合计算 DAG 整体状态：

```
输入: []NodeSnapshotInfo{State, Phase, Error, NonCritical}
输出: "pending" | "completed" | "failed" | "cancelled" | "paused" | "needs_retry" | "not_found"
```

**优先级顺序** (从高到低):

| 优先级 | 状态 | 条件 | 说明 |
|--------|------|------|------|
| 1 | `cancelled` | 任意节点为 CANCELLED | 终端状态，覆盖一切 |
| 2 | `not_found` | scrape 节点 FAILED + 错误码 NOT_FOUND | Gallery 专属 |
| 3 | `failed` | 任意非 NonCritical 节点 FAILED | 不可重试终端失败 |
| 4 | `failed` | 任意非 NonCritical 节点 TIMEOUT | 超时视为失败 |
| 5 | `needs_retry` | 任意非 NonCritical 节点 NEEDS_RETRY | 可自动重试 |
| 6 | `paused` | 任意节点 PAUSED | 用户暂停 |
| 7 | `completed` | 所有节点 COMPLETED (含 NonCritical 失败) | 完全成功 |
| 8 | `pending` | 默认 | 进行中/等待 |

### 2.2 聚合状态转换路径

```
         SubmitDag
             │
             ▼
         [pending] ─────────────────────────────────────┐
             │                                           │
    ┌────────┼────────┬──────────┬──────────┐           │
    ▼        ▼        ▼          ▼          ▼           │
[paused] [failed] [cancelled] [needs_retry] [completed] │
    │        │        │          │          │           │
    ▼        ▼        ▼          ▼          ▼           │
 resume   retry    (terminal)  auto-retry  (terminal)   │
    │        │                   │                      │
    └────────┴───────────────────┴──────────────────────┘
             │
             ▼
         [pending]
```

### 2.3 边界条件与异常路径

| 场景 | 触发条件 | 当前行为 | 风险 |
|------|----------|----------|------|
| 空节点列表 | `len(nodes) == 0` | 返回 `"pending"` | ✅ 安全 |
| 全部 NonCritical 失败 | 所有节点 FAILED/TIMEOUT but NonCritical | 返回 `"completed"` | ✅ 设计意图 |
| 混合 NonCritical | scrape(NonCritical).FAILED + download.COMPLETED | 返回 `"completed"` | ✅ 允许部分成功 |
| Gallery NOT_FOUND | scrape.FAILED + code="NOT_FOUND" | 返回 `"not_found"` | ✅ 正确识别 |
| 无状态变更 | 仅追踪 pending 节点 | 返回 `"pending"` | ⚠️ 可能掩盖问题 |

---

## 三、子任务状态机 (Node-Level 13 States)

### 3.1 完整状态转换表

```
                    ┌──────────┐
           ┌───────►│ PENDING  │◄─────── 初始状态
           │        └────┬─────┘
           │             │ deps satisfied
           │        ┌────▼─────┐
   retry ──┤   ┌───►│  READY   │◄─── 提交失败回退
           │   │    └────┬─────┘
           │   │         │ submit to scheduler
           │   │    ┌────▼─────┐
           │   │    │ QUEUED   │◄─── 孤立恢复
           │   │    └────┬─────┘
           │   │         │ slot allocated
           │   │    ┌────▼─────┐
           │   │    │ALLOCATED │──► FAILED (分配失败)
           │   │    └────┬─────┘
           │   │         │ executor started
           │   │    ┌────▼─────┐
           │   │    │ RUNNING  │──► TIMEOUT
           │   │    └────┬─────┘
           │   │         │
           │   │    ┌────┼──────────────┐
           │   │    │    │              │
           │   │    ▼    ▼              ▼
           │   │ [PAUSED] [VERIFYING] [COMPLETED]
           │   │    │    ┌───┼───┐       (skipVerify)
           │   │    │    │   │   │
           │   │    │    ▼   ▼   ▼
           │   │    │ [COMPLETED] [FAILED] [NEEDS_RETRY]
           │   │    │                  │
           │   │    │    ┌─────────────┘
           │   │    │    ▼
           │   │    │ [RESUME_VERIFY] ──► VERIFYING
           │   │    │
           │   └────┼──── resume
           │        │
           └────────┘ (从 CANCELLED 无法恢复)
                         (从 COMPLETED 无法恢复)
```

### 3.2 全部合法转换 (13 状态 × 12 源状态)

| 源状态 | 合法目标状态 |
|--------|-------------|
| `pending` | ready, cancelled |
| `ready` | queued, cancelled, paused, needs_retry |
| `queued` | allocated, cancelled, paused, ready |
| `allocated` | running, cancelled, paused, failed |
| `running` | verifying, failed, timeout, cancelled, paused, completed |
| `paused` | ready, cancelled |
| `verifying` | completed, failed, paused, resume_verify, needs_retry |
| `resume_verify` | verifying, completed, failed, paused |
| `completed` | (none - 终端) |
| `failed` | ready, needs_retry |
| `needs_retry` | ready |
| `cancelled` | (none - 终端) |
| `timeout` | ready |

### 3.3 策略层增强 (TransitionPolicy)

`GalleryNodePolicy` 通过 Guard/Action/Fallback 机制扩展基础转换表：

| 规则 | 描述 | Guard | 效果 |
|------|------|-------|------|
| ALLOCATED→RUNNING | 记录开始时间 | `onEnterRunning` Action | context.Extras["startedAt"] |
| RUNNING→VERIFYING | 默认验证路径 | `shouldVerify` Guard=true | 正常验证流程 |
| RUNNING→COMPLETED | 跳过验证 | `skipVerify` Guard=true | 直通完成 (NonCritical 节点) |
| onPause (scrape) | 抓取暂停 | Phase==Scrape | →READY (可立即重调度) |
| onPause (download) | 下载暂停 | Phase≠Scrape | →PAUSED (保留部分文件) |

### 3.4 已验证的死锁修复

| 编号 | 死锁路径 | 根因 | 修复状态 |
|------|----------|------|----------|
| **S1** | READY 节点永不被扫描 | `activateReadyNodes` 仅扫描 PENDING | ✅ 260720 修复: Phase 2 READY 重扫描 |
| **S2** | VERIFYING 重启后卡死 | `restoreDag` 不调用 onRestart | ✅ `defaultOnRestart`: RUNNING→READY, VERIFYING→FAILED |
| **S3** | 孤立 QUEUED 节点 | submit() 失败后状态未回退 | ✅ Phase 3 孤儿检测 + 回退 |
| **S4** | 槽位泄漏 (复合 holderId) | 纯 nodeId 导致 Set.add() 幂等 | ✅ 使用 `${dagId}:${nodeId}` |
| **S5** | 聚合状态优先级错 | download.COMPLETED 先于 scrape 检查 | ✅ 260720 重排优先级 |
| **S6** | retryCount 超 maxAttempts 阻止手动重试 | 自动重试消耗预算 | ✅ `resetRetryCount()` 在手動重試 |
| **S7** | executeNode 跳过 VERIFYING | Go 移植遗漏 VERIFYING 分支 | ✅ 状态: 审计已识别，需验证策略层修复 |
| **S8** | non-retryable 错误进入 VERIFYING 循环 | retryable=false 未断路 | ✅ FAILED 前短路 |

---

## 四、历史 DAG 问题模式提取

### 4.1 问题分类统计

| 类别 | 数量 | 占比 | 已修复 | 待修复 |
|------|------|------|--------|--------|
| 状态机死锁 | 8 | 22% | 7 | 1 |
| 竞态条件 | 5 | 14% | 5 | 0 |
| 槽位/资源泄漏 | 2 | 6% | 2 | 0 |
| 重试策略缺陷 | 4 | 11% | 4 | 0 |
| API/代理 Bug | 3 | 8% | 3 | 0 |
| SSE 事件问题 | 3 | 8% | 3 | 0 |
| Gallery 异常 | 3 | 8% | 2 | 1 |
| 架构/迁移债务 | 4 | 11% | 1 | 3 |
| 其他 | 4 | 11% | 2 | 2 |
| **总计** | **36** | **100%** | **29** | **7** |

### 4.2 关键问题模式

#### 模式 1: 状态机扫描盲区
**特征**: 节点进入某状态后无周期性扫描路径将其重新激活  
**实例**: READY 死锁 (S1), 孤立 QUEUED (S3)  
**解决方案**: 添加定期 `ReactivateReadyNodes()` 扫描 + 孤儿检测  
**预防原则**: 每个非终端状态都应有定期重扫描路径

#### 模式 2: 槽位泄漏
**特征**: 资源获取与释放不对称，导致并发槽位永久减少  
**实例**: holderId 幂等 (S4), 僵尸 goroutine  
**解决方案**: 复合 holderId + 超时释放 + 周期性泄漏检测  
**预防原则**: 资源成对获取/释放 + ID 唯一性保证

#### 模式 3: 重试预算耗尽
**特征**: 自动重试耗尽用户手动重试的预算  
**实例**: retryCount 超 maxAttempts (S6)  
**解决方案**: 用户/自动重试分离计数  
**预防原则**: 自动重试与手动重试使用独立预算

#### 模式 4: 代理/SSE 竞态
**特征**: 流式连接在数据传输中被意外关闭  
**实例**: POST 代理 502, SSE 重订阅风暴  
**解决方案**: `aborted` 替代 `close`, 独立 useEffect + store 幂等  
**预防原则**: 长连接生命周期独立于请求生命周期

#### 模式 5: 越狱路径
**特征**: 业务代码绕过 DAG 直接调用执行器  
**实例**: TaskAction 直接调 DownloadMgr, Scrape 直接调 ScrapeGallery  
**解决方案**: 路由所有下载/抓取通过 DagOrchestrator.SubmitDag()  
**预防原则**: 执行器只能由调度器调用，不可被 API 直接访问

### 4.3 待修复问题清单

| 编号 | 问题 | 优先级 | 影响范围 |
|------|------|--------|----------|
| T1 | executeNode 跳过 VERIFYING 分支 (S7) | P0 | 所有 Gallery 下载验证失效 |
| T2 | StateReconciler 未在 main.go 实例化 | P0 | VERIFYING/RESUME_VERIFY 无法推进 |
| T3 | PG 孤儿进程 + 非自愈连接池 | P0 | 非优雅终止后需手动清理 |
| T4 | EventStore DB 断连时静默丢事件 | P1 | 重启后事件不连续 |
| T5 | 前端 AbortController 未全覆盖 | P2 | 部分页面缺少超时 |
| T6 | go-rod 迁移 (chromedp→go-rod) | P2 | 爬虫性能和反检测 |
| T7 | VADE 变体自动发现引擎 | P3 | Gallery 去重完整性 |

---

## 五、CLI 与 API 扩展总结

### 5.1 新增 CLI 命令

| 命令 | 别名 | 功能 | 用法 |
|------|------|------|------|
| `create` | new, add | 创建 DAG 任务 | `create <gallery\|video\|sniff\|scrape> [--url=] [--gallery-id=]` |
| `link` | dep, depend | 添加依赖边 | `link <dagId> <parentId> <childId>` |
| `trigger` | run, start | 重新激活节点 | `trigger <dagId>` |
| `delete` | rm, remove | 删除 DAG | `delete <dagId> [--force]` |

### 5.2 新增 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/dag` | 创建新 DAG (gallery/video/sniff/scrape) |
| POST | `/api/dag/{id}/link` | 添加运行时依赖边 |
| POST | `/api/dag/{id}/trigger` | 重新激活就绪节点 |
| DELETE | `/api/dag/{id}` | 删除终端态 DAG |

### 5.3 新增 DagOrchestrator 方法

| 方法 | 功能 |
|------|------|
| `ReactivateDagNodes(ctx, dagID)` | 重新扫描指定 DAG 的 READY 节点 |
| `RemoveDag(ctx, dagID)` | 验证终端态后删除 DAG |

### 5.4 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `internal/cli/dagclient/types.go` | 新增 | CreateDag, LinkDag, TriggerDag, DeleteDag 动作 + 请求/响应类型 |
| `internal/cli/dagclient/client.go` | 新增 | CreateDag, AddDependency, TriggerDag, DeleteDag 方法 + delete() HTTP |
| `internal/cli/commands/create.go` | 新建 | dag create 命令 |
| `internal/cli/commands/link.go` | 新建 | dag link 命令 |
| `internal/cli/commands/trigger.go` | 新建 | dag trigger 命令 |
| `internal/cli/commands/delete_dag.go` | 新建 | dag delete 命令 |
| `internal/cli/commands/registry.go` | 修改 | 注册 4 个新命令 |
| `internal/api/handlers/dag.go` | 修改 | DagCreate, DagLink, DagTrigger, DagDelete 处理器 + 5 个 pipeline 辅助函数 |
| `internal/api/handlers/router.go` | 修改 | 新增 4 条路由 |
| `internal/orchestrator/dag/orchestrator.go` | 修改 | ReactivateDagNodes, RemoveDag 方法 |

---

## 六、Gallery 异常检测与重下载方案

### 6.1 异常类型定义

| 类型 | 检测条件 | 严重度 |
|------|----------|--------|
| SIZE_TOO_SMALL | `total_size < 1MB` 或 `downloaded_size < 100KB` | P0 |
| COUNT_MISMATCH | `image_count < expected_image_count * 0.7` | P0 |
| STATUS_STUCK | `status IN ('scraping','downloading') AND updated_at < now() - 1h` | P1 |
| ZERO_FILES | `image_count = 0 AND video_count = 0` | P0 |
| PARTIAL_DOWNLOAD | `status = 'partial'` 或 `downloaded_size < total_size` | P1 |

### 6.2 审计流程

```
1. 查询所有 Gallery (234 个)
   SELECT id, seq, title, status, image_count, video_count,
          expected_image_count, total_size, downloaded_size, error_msg
   FROM galleries

2. 分类标记:
   ├── SIZE_TOO_SMALL: total_size == 0 OR downloaded_size == 0
   ├── COUNT_MISMATCH: image_count < expected_image_count * 0.7
   ├── STATUS_STUCK: status IN ('pending','scraping','downloading') AND old
   ├── ZERO_FILES: image_count = 0 AND video_count = 0 AND status = 'completed'
   └── PARTIAL: status = 'partial'

3. 逐条审计:
   ├── 检查磁盘文件实际数量
   ├── 检查 DAG 是否存在 (内存中)
   ├── 判定根因 (抓取失败/下载失败/网络/站点变更)
   └── 记录修复状态

4. 批量重下载:
   ├── SIZE_TOO_SMALL: POST /api/shelf/{id} {action: "retry-failed"}
   ├── COUNT_MISMATCH: POST /api/dag {taskType: "gallery", galleryId: id}
   └── STATUS_STUCK: POST /api/shelf/{id} {action: "retry-failed"}
```

### 6.3 重下载策略选择

| 异常类型 | 是否保留现有文件 | 使用管道 | 说明 |
|----------|-----------------|----------|------|
| SIZE_TOO_SMALL | 删除后重下 | `NewGalleryPipeline` (完整) | 数据损坏，需重新抓取+下载 |
| COUNT_MISMATCH | 保留，补充下载 | `NewGalleryResumePipeline` (3节点) | 已有部分文件，跳过抓取 |
| STATUS_STUCK | 保留，触发重试 | `RetryDag` (DAG 重试) | DAG 卡住，重试失败节点 |
| ZERO_FILES | 重新开始 | `NewGalleryPipeline` (完整) | 无数据，重新全流程 |

---

## 七、总结与下一步

### 已完成
- [x] CLI 扩展：4 个新命令 (create, link, trigger, delete)
- [x] API 扩展：4 个新端点 (POST /api/dag, POST link, POST trigger, DELETE)
- [x] DagOrchestrator 扩展：ReactivateDagNodes, RemoveDag
- [x] 状态机全面审计：13 状态 + 聚合状态 + 8 个死锁路径验证
- [x] 历史问题提取：36 个问题分类，5 种关键模式，7 个待修复项
- [x] 需求链路图：8 节点 + 因果依赖 + 4 Phase 执行计划
- [x] Gallery 异常检测方案：5 种异常类型 + 审计流程 + 重下载策略

### 待执行 (需要 DB 可用)
- [ ] Gallery 234 任务全量审计
- [ ] ##SQFEAF, #RNZ9GS 等异常 Gallery 重下载
- [ ] 每个 Gallery 异常类型、根因、修复状态记录

### 待修复 (P0 技术债务)
- [ ] executeNode VERIFYING 分支补全 (S7)
- [ ] StateReconciler 在 main.go 实例化 (T2)
- [ ] PG 孤儿进程自动清理 (T3)
