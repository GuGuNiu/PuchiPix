# 历史转折点：从 Web 服务到 Windows 桌面软件

> 2026-10-02 定稿并执行。本文是 PuchiPix 分发形态转折的正式记录：Web 服务时代在此画上句点并冻结于 `web-mode` 分支，`main` 分支自此转向 Wails 桌面壳。若未来需要考古"转折前的完整架构"，以本文与 `web-mode` 分支为入口。

## 一、转折前的架构（冻结快照）

转折时点（本文档所在提交，tag `web-mode-freeze`）的完整形态：

| 层 | 组件 | 说明 |
|---|---|---|
| 后端 | Go（module `backend`），入口 `cmd/server` | 监听 `:10541`，SQLite（`data/puchipix.db`），SSE 实时进度，调度器 + 下载器常驻 |
| 前端 | React 19 + Vite 6 + Tailwind 4 | 监听 `:10540`，全部走相对路径 `/api`，由 Vite dev/preview 或 nginx 伺服 |
| 开发流 | `start.bat` | 拉起后端 `go run` 与前端 `pnpm dev` 双进程，浏览器访问 `http://localhost:10540` |
| 部署 | `Dockerfile` + `frontend/nginx.conf` | 容器部署线，转折后进入废弃流程 |
| 运维 | `backend/cmd/cli` | TUI 运维台，独立于桌面化，继续存活 |

冻结快照同时包含转折前积累的最后一批功能工作（约 320 个文件）：taskstate 状态权威与 SSE 进度重放、DAG 僵尸节点恢复与槽位上限、下载器速率统计接线、stealth 域名准入与 CDN 头、API 鉴权中间件、前端样式与类型刷新。

## 二、为什么转折

两个确定性约束在 2026-10-02 被明确：

1. **未来不会有 Docker 部署**——容器线（`Dockerfile`、`nginx.conf`、docker scripts）失去存在意义；
2. **产品形态定位为 Windows 桌面软件**——用户预期是"双击即用"，而不是"启动服务后打开浏览器"。

原有形态与目标的差距集中在体验层：双进程拉起、端口占用手工处理、依赖 Go/pnpm 环境、依赖浏览器。桌面壳是消除这些差距的直接手段。

## 三、方案评估与选择

对"桌面壳"评估了三个候选：

- **A. Wails（选定）**：Go 同栈，后端以库形态嵌进主进程，单 exe，WebView2 渲染，体积/内存最小，业务代码零改动。代价是无官方自动更新、托盘需自行接入。
- **B. Tauri 2**：壳最轻、自动更新/托盘/通知插件最全，Go 后端作 sidecar。因需引入 Rust 工具链与 sidecar 生命周期管理而未选。
- **C. Electron**：最成熟、生态最全。因 ~100MB 包体、最高内存占用、为包一个窗口引入整套 Node/Chromium 运行时而被放弃。

决定性因素：后端本来就是 Go 长驻服务，Wails 让"桌面化"退化为"给现有服务包一个窗口"，而不是引入第二种壳语言。

## 四、桌面版关键设计决策

1. **单 exe**：前端 dist 以 `go:embed` 打进二进制，约 20–25MB。
2. **同源架构**：前端全部走相对 `/api`，桌面版把 dist 与 API 放在同一源下，前端零改动。
3. **UI 由后端自伺服**，窗口直连 `http://127.0.0.1:<动态端口>`——不走 Wails assetserver，以保持 SSE 真流式语义与现有 nginx 行为一致；若改走反代则必须设 `FlushInterval: -1`。
4. **动态端口 + 单实例锁**：`127.0.0.1:0` 探测空闲端口注入配置，Windows named mutex 防双开。
5. **数据目录**：`%APPDATA%\PuchiPix`，由 `cmd/desktop` 壳层显式注入，`config.go` 保持不动，服务器模式行为不受影响。
6. **优雅退出**：窗口关闭 → cancel root ctx → 复用现有"HTTP Shutdown → dagOrch.Shutdown → sched.Stop → DB 最后关"序列。
7. **服务器模式共存**：`cmd/server` 与 `start.bat` 原样保留，桌面化是增量而非替换。

## 五、存续与退役

- **存续**：`cmd/server`（服务器模式）、`start.bat`（开发流）、`backend/cmd/cli`（运维台）。
- **废弃流程**：`Dockerfile`、`nginx.conf`、`docker:build`/`docker:run` scripts——先标记废弃，桌面版（M2 产物）稳定运行后从 main 删除。

## 六、里程碑

| 阶段 | 内容 | 量级 |
|---|---|---|
| M1 | `internal/app` 抽取 + `cmd/desktop` 跑通：窗口内完整可用，动态端口、单实例、优雅退出 | ~1 天 |
| M2 | 图标/版本信息/NSIS 安装器 + CI windows 打包 job | ~半天 |
| M3（可选） | 托盘最小化、自动更新、文件关联 | 按需 |

## 七、如何回到旧形态

```bash
git switch web-mode         # 转折点完整快照（含本文档）
git tag -l "web-mode-freeze" # 对应的冻结 tag
```

`main` 上的服务器模式在桌面版稳定前仍然可用：`start.bat` → 浏览器访问 `http://localhost:10540`。
