# PuchiPix CLI (`cli`)

基于自研 `Command` 接口 + `Registry` 模式的 DAG 任务调度与资源管理命令行工具。通过 HTTP 调用 Go 后端 REST API，支持 DAG 完整生命周期管理、视频任务管理、图库管理、系统监控和槽位调优。

## 快速开始

```bash
# 直接运行（推荐，无需构建 exe）
cd backend
go run -buildvcs=false ./cmd/cli --help

# 或构建到 .tmp/
go build -buildvcs=false -o .tmp/cli.exe ./cmd/cli
./.tmp/cli.exe --help

# 连接远程服务器
go run -buildvcs=false ./cmd/cli --host 192.168.1.100 --port 10540 status
```

## 命令总览 (24 个)

### 系统与监控

| 命令 | 别名 | 说明 |
|------|------|------|
| `health` | `ping` | 检查服务器健康状态和数据库连通性 |
| `system` | `sys`, `info` | 显示服务器运行时信息（版本、Goroutine、内存、运行时间） |
| `stats` | `summary` | 显示仪表盘聚合统计（图库、任务、下载历史、槽位使用率） |
| `sites` | — | 列出所有已注册的站点 Provider |

### DAG 监控与状态查询

| 命令 | 别名 | 说明 |
|------|------|------|
| `status` | — | 列出所有 DAG 及节点状态概览 |
| `dag` | — | 查看 DAG 详情（含节点状态历史） |
| `node` | — | 查看节点完整状态历史 |
| `events` | — | 查看 DAG 事件历史 |
| `watch` | — | 实时 SSE 事件流监控 |
| `logs` | — | 查看系统日志流 |
| `scheduler` | — | 调度器队列统计（按优先级/类型分组） |
| `slots` | `slot` | Slot 池使用率、持有者诊断与动态调优 |
| `worker` | `w` | Worker 进程管理（status / restart / logs） |
| `trace` | — | 链路追踪日志 |

### DAG 生命周期控制

| 命令 | 别名 | 说明 |
|------|------|------|
| `create` | `new`, `add` | 从 URL 创建下载任务（后端自动识别 gallery/video/sniff） |
| `link` | `dep`, `depend` | 添加运行时依赖边 |
| `trigger` | `run`, `start`, `activate` | 重新激活就绪节点 |
| `pause` | — | 暂停 DAG |
| `resume` | — | 恢复 DAG（可选节点） |
| `retry` | — | 重试 DAG（可选节点） |
| `cancel` | — | 取消 DAG |
| `delete` | `rm`, `remove` | 删除终端态 DAG |

### 任务与图库管理

| 命令 | 别名 | 说明 |
|------|------|------|
| `tasks` | `task` | 视频下载任务管理（list / detail / action / delete） |
| `galleries` | `gallery`, `gal` | 图库管理（list / detail / progress / retry / pause / resume / delete） |

## 全局选项

| 选项 | 默认值 | 环境变量 | 说明 |
|------|--------|----------|------|
| `--host <addr>` | `localhost` | `PUCHIPIX_HOST` | 服务端地址 |
| `--port <port>` | `10540` | `PUCHIPIX_PORT` | 服务端端口 |
| `--json` | `false` | — | 输出原始 JSON 替代格式化文本 |
| `-h, --help` | — | — | 显示帮助 |

## 命令详解

### 系统监控

```bash
# 检查服务器健康
cli health

# 查看运行时信息（版本、Goroutine、内存、CPU）
cli system

# 查看仪表盘统计
cli stats

# 列出支持的站点
cli sites
```

### `tasks` — 视频下载任务管理

```bash
# 列出任务（分页）
cli tasks list --limit=20 --offset=0

# 查看任务详情
cli tasks detail 42

# 执行任务操作（start / pause / resume / cancel / retry）
cli tasks action 42 start
cli tasks action 42 retry

# 删除任务
cli tasks delete 42
```

### `galleries` — 图库管理

```bash
# 列出图库（可按状态过滤）
cli galleries list --limit=20
cli galleries list --status=failed
cli galleries list --status=completed

# 查看图库详情
cli galleries detail 123

# 查看文件级下载进度
cli galleries progress 123

# 重试失败的图库下载
cli galleries retry 123

# 暂停 / 恢复图库
cli galleries pause 123
cli galleries resume 123

# 删除图库（包括关联的图片和视频）
cli galleries delete 123
```

### `slots` — Slot 池管理与调优

```bash
# 查看所有 Slot 使用概览
cli slots

# 查看活跃持有者（用于诊断 Slot 泄漏）
cli slots holders

# 查看单个 Slot 类型详情
cli slots detail download

# 动态调整 Slot 最大并发数
cli slots update download 5
```

### DAG 生命周期完整示例

```bash
# 1. 创建下载任务（后端自动识别 gallery/video/sniff）
cli create https://example.com/gallery/123

# 2. 查看任务状态
cli status
cli dag gallery-123

# 3. 添加/修改依赖边
cli link gallery-123 sc-123 ex-123

# 4. 触发执行（依赖修改后重新激活）
cli trigger gallery-123

# 5. 控制执行
cli pause gallery-123       # 暂停
cli resume gallery-123      # 恢复
cli retry gallery-123       # 重试失败节点
cli cancel gallery-123      # 终止

# 6. 清理
cli delete gallery-123      # 删除终端态任务
cli delete gallery-123 --force  # 强制删除（先取消）
```

### `create` — 创建下载任务

```bash
cli create <url> [--format=mp4] [--priority=1]

# 图库 URL（后端自动识别并创建 gallery DAG 管道）
cli create https://example.com/gallery/123

# 视频 URL
cli create https://example.com/video/456

# 指定格式和优先级
cli create https://example.com/video/456 --format=mp4 --priority=2
```

### 监控命令

```bash
# 实时 SSE 事件流
cli watch                    # 所有 DAG
cli watch --dag=gallery-123  # 指定 DAG

# 系统日志
cli logs                     # 全部日志
cli logs --dag=gallery-123   # 按 DAG 过滤
cli logs --module=DagOrchestrator --level=error

# Slot 使用率
cli slots                    # 所有 slot 类型
cli slots holders            # 活跃持有者诊断
cli slots detail download    # 单类型详情

# 调度器队列
cli scheduler

# Worker 管理
cli worker status
cli worker restart
cli worker logs --lines=100

# 链路追踪
cli trace <traceId>
cli trace <traceId> --follow
```

## 架构

### 代码结构

```
internal/cli/
├── config.go              # 全局选项解析 (--host/--port/--json)
├── vt100_windows.go       # Windows VT100 终端支持
├── vt100_other.go         # 其他平台 VT100
├── dagclient/             # HTTP API 客户端 SDK
│   ├── client.go          # REST 客户端 (get/post/put/delete + 业务方法)
│   ├── types.go           # 请求/响应类型 + 状态枚举
│   ├── sse.go             # SSE 流消费者
│   ├── error.go           # 错误分类 (DagClientError)
│   └── statelabels.go     # 状态 i18n 映射
├── commands/              # 命令实现 (Command 接口)
│   ├── types.go           # Command 接口 + CommandContext
│   ├── registry.go        # 命令注册表 (24 命令)
│   ├── help.go            # 分组帮助文本
│   ├── health.go          # 健康检查
│   ├── system.go          # 系统信息
│   ├── stats.go           # 仪表盘统计
│   ├── sites.go           # 站点列表
│   ├── status.go          # status 命令
│   ├── dag.go / node.go   # DAG/节点详情
│   ├── watch.go           # SSE 监控
│   ├── logs.go / logs_cmd.go  # 日志查看
│   ├── events.go          # 事件历史
│   ├── slots.go           # Slot 池管理 (overview/holders/update/detail)
│   ├── scheduler.go       # 资源统计
│   ├── worker.go          # Worker 管理
│   ├── trace.go           # 链路追踪
│   ├── control.go         # pause/resume/retry/cancel
│   ├── create.go          # DAG 创建
│   ├── link.go            # 依赖边
│   ├── trigger.go         # 节点激活
│   ├── delete_dag.go      # DAG 删除
│   ├── tasks.go           # 视频任务管理 (list/detail/action/delete)
│   └── galleries.go       # 图库管理 (list/detail/progress/retry/pause/resume/delete)
└── ui/                    # 终端 UI 组件
    ├── colors.go          # ANSI 颜色定义
    ├── components.go      # UI 组件 (进度条/状态标签)
    └── format.go          # 格式化工具
```

### 设计原则

**自研 CLI 框架**（未使用 cobra/urfave）：
- `Command` 接口：`Name() / Description() / Usage() / Aliases() / Execute(CommandContext)`
- `Registry` 注册表：按名称/别名 O(n) 查找
- `CommandContext`：携带 `*dagclient.Client` + `Args` + `JSON` 标志 + `context.Context`
- 命令分组：`help.go` 中 `commandGroups` 控制帮助输出的分组和排序

**HTTP 客户端** (`dagclient.Client`)：
- 统一 `get/post/put/delete` 辅助方法
- 10 秒超时
- 错误分类：`DagClientError` 支持 `IsNetworkError()` / `IsNotFound()` / `IsServerError()`
- SSE 支持：`SSEClient` 流消费者

**终端 UI**：
- ANSI 颜色（跨平台 VT100）
- 状态标签组件（`StatePill` / `StateLabel`）
- 进度条组件（`RenderProgressBar`）
- JSON 输出模式（`--json`）

### 添加新命令

1. 在 `commands/` 下创建文件，实现 `Command` 接口
2. 在 `registry.go` 的 `NewRegistry()` 中注册
3. 在 `help.go` 的 `commandGroups` 中添加到合适的分组
4. 如需新 API，在 `dagclient/client.go` 添加方法，在 `types.go` 添加类型

```go
type myCommand struct{}

func (c myCommand) Name() string        { return "mycmd" }
func (c myCommand) Description() string { return "My custom command" }
func (c myCommand) Usage() string       { return "cli mycmd <arg>" }
func (c myCommand) Aliases() []string   { return []string{"mc"} }

func (c myCommand) Execute(ctx CommandContext) error {
    // 使用 ctx.Client 调用 API
    result, err := ctx.Client.GetAllDags()
    // ...
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PUCHIPIX_HOST` | `localhost` | 服务端地址 |
| `PUCHIPIX_PORT` | `10540` | 服务端端口 |

## API 端点映射

| CLI 命令 | HTTP 方法 | API 端点 |
|----------|-----------|----------|
| `health` | GET | `/api/health` |
| `system` | GET | `/api/system` |
| `stats` | GET | `/api/stats` |
| `sites` | GET | `/api/sites` |
| `status` | GET | `/api/dag` |
| `dag <id>` | GET | `/api/dag/{id}` |
| `events <id>` | GET | `/api/dag/{id}/events` |
| `watch` | SSE | `/api/dag/stream` |
| `logs` | SSE/GET | `/api/logs` `/api/logs/history` |
| `scheduler` | GET | `/api/dag/scheduler` |
| `slots` | GET | `/api/dag/slots` |
| `slots holders` | GET | `/api/slots/holders` |
| `slots detail <type>` | GET | `/api/slots/{type}` |
| `slots update <type> <max>` | PUT | `/api/slots/{type}` |
| `worker` | GET/POST | `/api/worker/status` `/api/worker/restart` |
| `create` | POST | `/api/tasks` |
| `tasks list` | GET | `/api/tasks` |
| `tasks detail <id>` | GET | `/api/tasks/{id}` |
| `tasks action <id> <action>` | POST | `/api/tasks/{id}` |
| `tasks delete <id>` | DELETE | `/api/tasks/{id}` |
| `galleries list` | GET | `/api/shelf` |
| `galleries detail <id>` | GET | `/api/shelf/{id}` |
| `galleries progress <id>` | GET | `/api/shelf/{id}/files/progress` |
| `galleries retry/pause/resume <id>` | POST | `/api/shelf/{id}` |
| `galleries delete <id>` | DELETE | `/api/shelf/{id}` |
| `link` | POST | `/api/dag/{id}/link` |
| `trigger` | POST | `/api/dag/{id}/trigger` |
| `pause` | POST | `/api/dag/{id}/control` |
| `resume` | POST | `/api/dag/{id}/control` |
| `retry` | POST | `/api/dag/{id}/control` |
| `cancel` | POST | `/api/dag/{id}/control` |
| `delete` | DELETE | `/api/dag/{id}` |

## 相关文件

- 后端 API: `internal/api/router.go` (路由定义)
- 后端 Handlers: `internal/api/` (dag.go / tasks.go / gallery.go / slots.go / basic.go)
- DAG 编排器: `internal/orchestrator/dag/orchestrator.go`
- DAG 客户端: `internal/cli/dagclient/client.go`
- 入口: `cmd/cli/main.go`
