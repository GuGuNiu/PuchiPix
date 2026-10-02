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

## 八、M1 实施结果（2026-10-02）

### 落地结构

| 路径 | 职责 |
|---|---|
| `backend/internal/app` | 服务装配的唯一来源：DB、slot pool、DAG orchestrator、scheduler、governor、site registry、video download manager、executor 注册、崩溃恢复、关闭序列 |
| `backend/internal/webui` | `go:embed` 前端 dist + SPA fallback + 安全响应头 + assets 长缓存，行为对齐退役的 `nginx.conf` |
| `backend/cmd/server` | 退化为薄壳：加载配置 → `app.New` → 起 HTTP → 等信号 → `Shutdown` |
| `backend/cmd/desktop` | Wails 壳：动态端口、单实例锁、窗口直连后端 origin、优雅退出 |
| `scripts/sync-dist.mjs` | 把 `frontend/dist` 增量同步进 `backend/internal/webui/dist` |
| `scripts/build-desktop.mjs` | 前端构建 → dist 同步 → 带标签编译单 exe |

`config.Load` 未被改动：桌面壳通过 `cmd/desktop` 显式注入 `DATA_DIR` / `DB_PATH` 指向 `%APPDATA%\PuchiPix`，服务器模式的路径解析逻辑原样保留。

### 三个必须知道的构建事实

1. **`production` 构建标签是强制的。** 裸 `go build ./cmd/desktop` 会编译成功、不报任何错，但产物启动即退——Wails 在无标签时把 `CreateApp` 编译成一个弹「请使用 wails build」提示框后返回 nil 的桩实现。`scripts/build-desktop.mjs` 已固定传入 `-tags production`。
2. **Wails 自带的单实例锁生效太晚。** 它在 `wails.Run` 内部才取锁，此时数据库已打开、迁移已跑、调度器与背压监控已启动，第二实例会完整初始化一遍再被拒绝。桌面壳因此在 `main` 最开头自建 named mutex（`Global\PuchiPixDesktopStartupLock`），失败则先发 `WM_COPYDATA` 唤醒已有窗口再退出。
3. **`internal/app` 的 `Shutdown` 不含 HTTP 关闭。** HTTP server 的归属留给调用方（`cmd/server` 与 `cmd/desktop` 各自建、各自关），`app` 只负责其后的编排器/调度器/DB 序列。这让同一个 `App` 能同时服务于「自有 HTTP server」和「被 Wails 窗口直连的 HTTP server」两种形态。

### 同源与 SSE

窗口不指向 Wails asset server，而是被 302 重定向到后端 origin（`http://127.0.0.1:<动态端口>`）。asset server 在此只作跳板：首次导航离开 `wails://` scheme 之后，WebView 与 HTTP server 直连，中间没有反向代理。这既让前端全部相对 `/api` 调用天然同源（免掉 nginx 时代的 CORS 与 proxy 层），也保住了 SSE 的真流式语义——若改走 assetserver 反代，`EventSource` 会受响应缓冲影响，必须额外设置 flush 间隔才能恢复实时性。`WriteTimeout` 保持为 0。

### 实机验证

`go build` / `go vet` / `go test`（含新增 webui 与 mount 用例）全通过。单exe 28.8 MB。动态端口上 `/api/health` 返回 `database: ok`；index 与 SPA fallback 均 200，assets 带一年 immutable 缓存；`/api/tasks/stream` 立即返回 `event: initial`（无缓冲）；第二实例 1.5s 退出且数据库零接触；关窗后完整跑通关闭序列且 0 ERROR、端口释放；服务器模式回归正常。

## 九、根目录结构：已定稿的形态

### `test/` 已删除

原`test/` 并非临时目录，而是**第二个 pnpm workspace 包**（`frontend/pnpm-workspace.yaml` 里以 `"../test"` 声明，含自己的 `package.json` 与 axios/cheerio/playwright 依赖，271 个文件受git 跟踪，内容为各站点抓包素材与逆向报告）。该目录已由用户删除，连带需要清理三处悬挂引用：

| 文件 | 处置 |
|---|---|
| `frontend/pnpm-workspace.yaml` | 移除 `"../test"` 成员声明，`packages` 只留 `"."` |
| `frontend/pnpm-lock.yaml` | 移除 `importers` 下的 `../test:` 段（axios / cheerio / playwright 三个依赖声明） |
| `.gitignore` | 移除重复的 `/test` 与 `/test` 两条规则 |

验证：`pnpm exec vite build` 通过（2218 modules transformed），产物与删除前逐字节一致（`sync-dist.mjs` 报告 `0 updated`）。CI 与 dependabot 从未引用 `test/`，无需改动。

### 剩下的结构问题：`data/` 与构建产物

根目录现存7 项：`frontend/` `backend/`（源码）、`data/`（服务器模式运行时数据，16467 文件）、`dist-desktop/`（桌面版产物）、`docs/` `scripts/` `start.bat`（仓库级）。根目录残留的 `.npm-cache/`（8851 文件）已确认为无引用的 npm 自身缓存并删除。

**尚未处理**：把 `data/` 与 `dist-desktop/` 收进 `var/` 之类的目录，使根目录只留源码与配置。迁移 `data/` 必须同步修`internal/db/dbconfig.computeDefaultDBPath()`——它按 `<cwd>/data` → `<cwd>/../data` → `<exeDir>/../data` 三级查找，目录一变就可能够不到库，静默开空库导致 API 全 404 而服务表面健康。`start.bat` 用 `%~dp0` 不受影响，但开发者裸跑会踩。

### 未采纳：`app/frontend` + `app/backend` 嵌套

曾评估把前后端一并下沉一层，结论是**不采纳**：Go 侧收益极小（`go.mod` 是 `module backend`，模块路径与磁盘目录无关，import 语句零改动），却要改 8 处引用（`ci.yml` 6、`cd.yml` 4、`dependabot.yml` 2、`start.bat` 3、两个构建脚本、`sse-contract-check.mjs`、`.gitignore`）并同样撞上库路径陷阱。既然 `test/` 已删除，根目录平级混放的问题已大幅缓解，不值得为「看起来整齐」付这笔代价。

若将来仍要下沉，需同步修改的引用清单：

| 文件 | 处数 | 内容 |
|---|---|---|
| `.github/workflows/ci.yml` | 6 | `working-directory: frontend` / `backend`（各 2）、`cache-dependency-path`、`path: frontend/dist` |
| `.github/workflows/cd.yml` | 4 | `working-directory`、`cache-dependency-path`、`context: ./frontend` |
| `.github/dependabot.yml` | 2 | `directory: /frontend`、`/backend` |
| `start.bat` | 3 | `FRONTEND_DIR` / `BACKEND_DIR` / `DATA_DIR` |
| `scripts/sync-dist.mjs`、`scripts/build-desktop.mjs` | 各 1 | `repoRoot` 解析 |
| `frontend/scripts/sse-contract-check.mjs` | 1 | `../backend/internal/api/task_stream.go` |
| `.gitignore` | 若干 | 锚定路径 |
| `backend/internal/db/dbconfig` | — | 库路径解析（需显式修法） |

## 十、自定义标题栏（2026-10-02）

### 决策：窗口控制走 HTTP，不引Wails 绑定

「前端零 Wails 绑定」是本项目的硬约束，窗口控制也不例外。因此没有用 `window.go.main.App.WindowMinimise()`，而是新增 `backend/cmd/desktop/window`，把四个操作暴露为同源 HTTP 端点，由 Go 侧调 Wails runtime：

| 端点 | 方法 | 作用 |
|---|---|---|
| `/api/window/state` | GET | 返回 `{"maximised":bool}`，供标题栏对齐最大化图标 |
| `/api/window/minimise` | POST | 最小化 |
| `/api/window/toggle-maximise` | POST | 最大化 / 还原 |
| `/api/window/close` | POST | 走 `runtime.Quit`，与系统关闭同一路径 |

变更类端点一律 POST，避免预取或误链接触发关闭。端点只在桌面壳挂载，服务器模式下 404——标题栏靠探测 `/api/window/state` 是否可用决定渲染，**同一份前端文档在两种形态下都成立**，服务器模式的布局完全不受影响。

Wails 没有内置窗口状态事件，故最大化图标采用「乐观翻转+ focus/resize 时复询 `/api/window/state`」的组合：用户自己触发的操作立即反馈，系统级最大化（Win+↑、贴边）会在下一次 focus/resize 时自愈。

### 视觉与交互

按项目既有 token 体系实现，未引入新配色或新字体族：

- 高度 `32px`（与Windows 标题栏同高），按钮 `46px` 宽 —— 取平台尺寸而非 4px 间距栅格；`44×44` 触控目标那条建议在此处有意放宽，窗口边框由指针操作，不适用触控语境。
- 背景 `--bg-sidebar` + `--glass-blur`，与侧边栏同材质；底边 `--glass-border`，最大化时透明。
- 三按钮均为内联 SVG 描边图标（1px），最大化态切换为「双层方框」还原图标；还原图标内填充用 `--title-bar-restore-bg` token，以便在亮/暗主题下都与标题栏背景同色。
- 关闭按钮 hover 才变红（`--danger`），是整条栏里唯一的红色强调。
- 交互态齐备：hover / active / focus-visible；`focus-visible` 给 2px `--accent` 描边，保证键盘可达。`prefers-reduced-motion: reduce` 下关闭过渡。
- 双击标题栏切换最大化，与系统行为一致。

### 实测发现并修掉的缺陷

**SSE 连接导致关闭窗口卡满 10 秒。** 原关闭序列给 `srv.Shutdown` 10 秒超时，但 WebView 持有的 SSE 长连接（`/api/tasks/stream` 等）按设计永不自行结束，`Shutdown` 会一直等到超时。表现为点关闭按钮后进程滞留 10 秒、日志一条 ERROR。

修法：宽限期压到 2 秒（足够在途普通请求收尾），超时后调`srv.Close()` 强制断开剩余连接。退出延迟从 10 秒降到 2 秒以内，且不再产生 ERROR。

### 验证

实机确认：`/api/window/state` 返回正确；`GET` 打到 `close` 返回 405；`toggle-maximise` 使窗口从 1440×900 变为 1936×1048 且 state 翻转为 `true`；`close` 触发完整关闭序列（dm.Stop → flowCtrl → backpressure → dagOrch → sched → DB）后进程退出、端口释放。DOM 层面确认标题栏 32px、拖拽属性 `drag`、按钮 `--wails-draggable: no-drag`、三键 46px、亮暗双主题取色正确。`tsc --noEmit` 与 `eslint` 均通过。

### 事故备忘：删除守卫会误伤无关文件

本项目的工作区删除守卫会把删除重定向到回收站（`E:\$Recycle.Bin\<SID>\`），且**会把脚本根本没打算删的文件一并移走**。本日累计四次：`start.bat` 三次（`git status` 显示 ` D`）、`docs/` 整目录一次（`docs/ missing`）。四次均以 `git checkout --` 完整恢复。

此外该守卫还会打断构建：Vite 的 `emptyOutDir` 清空 `frontend/dist` 时，守卫二进制 `genie-trash.exe` 超时（`ETIMEDOUT`）导致构建失败。绕法是 `pnpm exec vite build --emptyOutDir false`；注意此时旧产物不会被清掉，需自行确认输出目录状态。

**因此本项目所有批量文件操作必须执行这条纪律**：动手前 `git ls-files -z | xargs -0 md5sum` 快照全部跟踪文件，改完再全量比对一次，确认零差异才收工。不能只看脚本自己的输出。

## 十一、M2 桌面打包

**结论：资源注入绕开 Wails CLI，改用 windres。** Wails 的打包链（`pkg/commands/build`、`internal/s`）在本机 module cache 缺失，`wails build` 跑不起来；而运行时包是齐备的。图标与版本信息本质是 PE 资源，与 Wails 无关，因此完全可以用 `windres` 编译 `.rc` → `.syso` 解决，Go 会自动把同包目录下的 `.syso` 链进产物。

| 路径 | 职责 |
|---|---|
| `build/windows/make-icon.py` | Pillow 生成 7 尺寸 ico，配色取自 `--accent-shimmer` |
| `build/windows/PuchiPix.rc` | ICON + VERSIONINFO |
| `build/windows/app.manifest` | asInvoker、per-monitor DPI、longPathAware、UTF-8、Common-Controls v6 |
| `build/windows/installer.nsi` | NSIS 安装/卸载、快捷方式、注册表、文件关联 |
| `scripts/build-resources.mjs` | 调windres，输出 `backend/cmd/desktop/PuchiPix.syso` |

原 favicon 是通用黑色播放三角占位图，不足以当应用图标，故重画：圆角方形用项目自己的 periwinkle 渐变，三角做光学居中。`icon.ico` 作为源码资产入库（CI 无需 Python 即可打包），`.syso` 与预览图忽略。

### 三个 windres 的坑

1. **必须显式 `--target=pe-x86-64`。** 默认按 i386 生成，资源虽被链进 `.rsrc`，但系统读不到。判据是 PE 数据目录 `IMAGE_DIRECTORY_ENTRY_RESOURCE` 的 rva/size 与 `.rsrc` 节是否一致——两者一致才说明真的生效。
2. **`-D` 宏在字符串字面量内不展开。** 写 `VALUE "FileVersion", "VERSION_MAJOR.VERSION_MINOR..."` 会把宏名原样写进 exe。需用 stringize：`#define STR_(x) #x` / `#define STR(x) STR_(x)` 再拼出 `VERSION_STRING`。
3. **不解析 `winnt.h`。** `VOS_NT_WINDOWS32` 之类常量不识别，会报语法错误，须改用字面量 `0x40004` / `0x1` / `0x0`。

### 顺带修掉的构建脚本 bug

`run()` 统一用 `shell: true`，导致 `go` 收到的 argv 被重新切分，`"-s -w"` 变成 `-s` 和 `-w`，报 `flag provided but not defined: -w`。此前一直直接用 shell 调 `go build`，没走过这个脚本，所以一直没暴露。现给 `go`/`windres` 这类原生 exe 传 `shell: false`，只有 `pnpm`（`.cmd`）保留 shell。

安装包在本机是可选步骤（未装 NSIS），CI 传 `--require-installer` 使其失败即断，避免 `.nsi` 写错漏到发布。

### 验证

自写三个检查脚本入库（`inspect-pe.py` 节表与数据目录、`inspect-rsrc.py` 资源树、`inspect-version.py` 直解 `VS_VERSION_INFO`）。确认：`.rsrc` 正确链接；`RT_ICON`×7 + `RT_GROUP_ICON` + `RT_VERSION` + `RT_MANIFEST` 齐全；`VS_FIXEDFILEINFO` 签名 `0xFEEF04BD`、binary version `0.3.0.0`、`FileVersion` 字符串 `0.3.0.0`；实机启动运行正常、零 ERROR。

注意：本机沙箱内 `version.dll` 的 `GetFileVersionInfoSizeW` 与 `ExtractIconExW` 均不可用（返回 0 / 函数不存在），属环境限制而非产物问题，故验证改走自写 PE 解析器；CI 在正常的 windows-latest 上用 PowerShell `VersionInfo` 复核。
