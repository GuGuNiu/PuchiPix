# PuchiPix Go 后端代码简洁性与轻量化审查报告

> 审查范围：`backend/` 全部 221 个 Go 文件、约 46,472 行
> 工具：`go build` / `go vet`（编译级检查）、`deadcode`（调用图可达性分析）、`staticcheck`（U1000 未使用检测）、人工 grep 交叉验证
> 日期：2026-08-02

## 总体结论

| 维度 | 结论 |
|---|---|
| 编译健康度 | ✅ 通过，无未使用导入/局部变量（Go 编译器强制） |
| 依赖轻量化 | ✅ 直接依赖仅 9 个，全部必要；无重型框架 |
| **冗余代码** | 🔴 **严重**，死代码约 3,200+ 行，占总量 ~7-8% |
| **重复实现** | 🔴 **较多**，至少 6 类功能被重复实现 2-5 次 |
| 过度设计 | 🟡 中等，存在未接线的抽象层与巨型装配文件 |

**最突出的三个问题**：
1. 14 个整块死代码文件（2,212 行 + 645 行配套测试）从未被任何入口调用；
2. `ReplaceDomain` 被实现 5 次、`uniqueStrings` 被实现 4 次；
3. `wire_executors.go`（1,052 行）名为依赖装配，实为巨型业务逻辑文件。

---

## 一、冗余代码识别（最严重）

### 1.1 整块死代码（14 个文件，2,212 行，另有 645 行死测试）

| 文件 | 行数 | 状态 |
|---|---|---|
| `internal/datarepo/seeder.go` | 516 | 整个包无任何生产/测试引用 |
| `internal/patrol/patrol.go` + `tables.go` | 404 | 完全无引用 |
| `internal/titleparser/variant.go` | 227 | 仅被死代码包 patrol 引用（死代码链） |
| `internal/archiver/archiver.go` | 201 | 仅测试引用 |
| `internal/orchestrator/task/queue.go` | 167 | 仅测试引用 |
| `internal/sites/sniffer.go` | 145 | 仅测试引用 |
| `internal/orchestrator/dag/snapshot.go` | 119 | 仅测试引用 |
| `internal/infra/handler_console.go` | 106 | 完全无引用 |
| `internal/infra/ratelimiter.go` | 98 | 完全无引用 |
| `internal/infra/handler_json.go` | 70 | 完全无引用 |
| `internal/orchestrator/executors/sniff_executor.go` | 67 | 完全无引用 |
| `internal/infra/handler_multi.go` | 63 | 完全无引用 |
| `internal/infra/handler_sink.go` | 29 | 完全无引用 |
| **合计** | **2,212** | 另有配套测试 645 行 |

**处置建议**：
- **直接删除**：`datarepo/`（整个包）、`patrol/`（整个包）、`infra/ratelimiter.go`、`infra/handler_*.go`、`executors/sniff_executor.go`。这些连测试都没有，是纯死代码。
- **删除并移除对应测试**：`archiver/`、`orchestrator/task/queue.go`、`orchestrator/dag/snapshot.go`、`sites/sniffer.go`——它们的测试在验证一个从未被生产使用的功能，属于"测试死代码"。
- **删除 `titleparser/variant.go`**：它唯一的引用方是死代码包 `patrol`。先删 patrol，variant.go 即无引用方。

### 1.2 散落的不可达函数（staticcheck U1000，17 项，100% 确认）

| 位置 | 内容 |
|---|---|
| `internal/api/response.go:30` | `writeConflict` 未使用 |
| `internal/api/handlers.go:59` | `Handlers.WithFactory` 未使用 |
| `internal/cli/commands/help.go:9` | `helpCommand` 类型及 4 个方法**从未注册**（help 功能缺失） |
| `internal/downloader/contentverifier.go:14` | 变量 `segmentIdxPattern` 未使用 |
| `internal/orchestrator/executors/executors.go:31` | 类型 `domainFallbackConfig` 未使用 |
| `internal/orchestrator/task/queue.go:16` | 字段 `mu` 未使用 |
| `internal/sites/sjs/actions.go:15` | 变量 `actionsLogger` 未使用 |
| `internal/sites/universal/constants.go:55` | 变量 `m3u8UrlPattern` 未使用 |
| `internal/sites/universal/provider.go:10` | 变量 `providerLogger` 未使用 |
| `internal/titleparser/matcher.go:56` | 变量 `pinyinArgs` 未使用 |
| `internal/titleparser/parser.go:82` | 字段 `gameRE` 未使用 |
| `internal/titleparser/parser.go:203` / `311` | `Parser.segment` / `Parser.matchModel` 未使用（被 `smartSegment` 取代的旧实现） |

### 1.3 调用链死代码（deadcode 报告，经人工验证）

- **API 层（仅测试使用）**：`LogsQuery`（logs.go:39）、`queryString`（response.go:68）、`SSEStream.SendData`（sse.go:60）、`GetLocale`（middleware/locale.go:25）、`GetRequestID`（middleware/requestid.go:29）
- **infra 层**：`CreateLogger`（logger.go:402）、`RunWithTraceContext`（logger.go:416）、`GetTraceID`（logger.go:429）——均为"镜像 TypeScript"遗留入口，生产用 `NewLogger` 即可；`DefaultHeaders`（httpclient.go:50）
- **sjs 站点**：`HTTPLogin` + `md5Hash` + `getRandomString` + `extract*`（auth.go:118-311）、`PerformCheckin`/`CheckinAllAccounts`/`BuyThread`（actions.go）——整个"登录/签到/买帖"功能链未接线
- **orchestrator**：`ResolveRequirements`（resolve_requirements.go:31）、`OuoOrchestrator.ResolveBatch`（ouo.go:72）、`ShouldRetryWithChromedp`（strategy.go:91）、`MapNodeStateToDBStatus`（state_machine.go:339）、`AggregateTaskStatusWithRegistry`（task_type_registry.go:93）、`DownloadWithDomainFallback`/`ReplaceDomain`/`indexOf`（executors/executors.go:257-310）
- **downloader**：`DetectDownloadSource`（contentverifier.go:159）、`SetFFmpegPath`/`CheckFFmpeg`（transcoder.go:19-25）、`IsSegmentDownloaded`/`GenerateAllTSIDs`（segmentdownloader.go:124-151）
- **stealth**：`GaussianDelay`/`BackoffDelay`（anticrawler.go:35-47）、`GetAllProfiles`（browserprofiles.go:259）、`DomainHealthTracker` 的 6 个方法（domainhealth.go）
- **urlutil**：`domain_clean.go` 整个文件（200 行，6 个函数全部不可达）
- **sites**：`MatchesSjsUrl`、`MatchesExhentaiURL`/`IsExURL`、`MatchesXsnvshenURL`、`FetchEligibilityAPI`（aimeizizi/scraperhttp.go:360）、`ParseExtMetadata`（aimeizizi/htmlparser.go:178）、`GetNextPageUrl`（sjs/pageextractors.go:337）、`ReplaceDomain`（xsnvshen/constants.go:139）
- **i18n**：`GetDict`/`SupportedLocales`/`IsSupported`/`AllKeys`（locales.go:66-92）
- **CLI**：`ExtractFlag`（config.go:61）、`SSEClient.SetTimeout`（dagclient/sse.go:121）、`NodeStateI18nKey`（statelabels.go:5）

> ⚠️ 注意：以上 1.3 中"仅测试使用"的项，删除后需同步移除对应测试引用。其中 `titleparser.NormalizeDirectoryName`（parser.go:675）有 3 处生产引用，**是活跃代码**，不要误删。

---

## 二、重复造轮子检测

### 2.1 手写实现替代标准库（明确建议替换）

| 位置 | 手写实现 | 应改用 |
|---|---|---|
| `orchestrator/executors/executors.go:304` | `indexOf`（10 行手写查找） | `strings.Index` |
| `sjs/pageextractors.go:389` | `containsStr` | `slices.Contains`（Go 1.21+） |
| `aimeizizi/htmlparser.go:379` | `contains` | `slices.Contains` |
| `downloader/video/m3u8parser.go:42-76` | `resolveURI`（30 行手写相对 URL 解析） | `url.ResolveReference` |
| `infra/ratelimiter.go` | 手写令牌桶（98 行） | `golang.org/x/time/rate` 或 `x/sync/semaphore`（项目已有 x/sync 依赖）——且该文件本身是死代码 |
| `datarepo/seeder.go:500` vs `titleparser/parser.go:611` | `collapseSpaces` 两处逐字相同 | 提取为公共函数（且 datarepo 版本随死代码删除） |

### 2.2 重复造轮子（手写自研组件，评估后决定）

| 位置 | 说明 | 建议 |
|---|---|---|
| `infra/logger.go`（435 行）+ LogSink + 4 个 handler 文件 | 从 TypeScript 迁移的自研日志框架 | 标准库 `log/slog`（Go 1.21+）可覆盖 90% 需求。若需保持 API/CLI 消费的 JSON 格式，可保留 `StructuredLogEntry` 序列化，但 **handler_*.go 抽象层完全未接线**（`log()` 直接写 os.Stdout/os.Stderr），应删除。 |
| `downloader/video/m3u8parser.go` | 手写 M3U8 解析 | 社区有 `grafov/m3u8`。**活跃代码，暂不建议替换**——当前实现自洽且有测试，替换收益有限、风险大。 |
| `stealth/anticrawler.go:35-47` | `GaussianDelay`/`BackoffDelay` 随机延迟 | 本身就是死代码。若将来需要，直接基于 `math/rand` 实现，无需专门函数。 |

---

## 三、轻量化评估

### 3.1 过度设计点

1. **`internal/orchestrator/wire_executors.go`（1,052 行）——最大的结构问题**
   名为"装配"（DI 注入），实际塞入完整业务逻辑：`downloadGalleryVideo`（629 行起，约 100+ 行视频下载）、`mergeSegmentsToMP4`（737 行）、`tryDownloadGalleryZip`（776 行）、`verifyGallery`（983 行）、`sanitizeFileName`（912 行）、`detectDownloadSource`（893 行）。
   **建议**：装配文件只保留 `WireExecutors` + 各 `newXxxExecutor` 构造函数；下载/合并/验证逻辑下沉到 `internal/downloader/` 包，文件名清洗移到公共工具包。

2. **`internal/orchestrator/dag/orchestrator.go`（1,746 行）**
   单文件承载 DAG 全部生命周期逻辑（提交、激活、完成传播、验证、暂停/取消/恢复/重试、快照）。**建议按职责拆分**：`lifecycle.go`（提交/取消/暂停/恢复/重试）、`scheduling.go`（激活/传播）、`verification.go`、`snapshot.go`。

3. **`internal/orchestrator/dag/orchestrator.go:1258` `RestoreDagForTest`**
   名字即"为测试而建"，却放在生产文件中。应移到 `_test.go`。

4. **`infra/handler_*.go`（4 个文件 268 行）**
   设计了 Handler 接口体系（console/json/multi/sink），但 `logger.log()` 内部直接 fmt 输出，从未使用该抽象。属于"设计了但没接线"的抽象层，应删除。

5. **`titleparser/segmenter.go` 双模式并存**
   `smartSegment`（segmenter.go:26）内保留 `segmentLegacy`（正则分割）与 `segmentPaired`（成对分隔符感知）两套算法，运行时按 `containsPairedDelim` 切换；而 `parser.go:203` 还有第三个旧实现 `segment`（已确认未使用）。**建议**：删除 `segment`；评估 legacy 路径是否仍有存在价值（若有合理场景，保留并写明原因；否则删除）。另注意 `segmentLegacy` 用 `interface{ Split(string, int) []string }` 抽象参数，直接传 `*regexp.Regexp` 即可。

6. **`Makefile` 的 `lint` 仅 `go vet`**
   这是 U1000 类死代码长期积累的原因。**建议**：接入 `staticcheck`（`go run honnef.co/go/tools/cmd/staticcheck@latest ./...`）或 golangci-lint，CI 强制 U1000=0。

### 3.2 合理的模块划分（无需改动）

- `internal/sites/{aimeizizi,sjs,xsnvshen,exhentai,universal}` 按站点分包，职责清晰，符合"站点适配器"模式；
- `internal/db`、`internal/api`（含 middleware 子包）、`internal/orchestrator`（含 dag/scheduler/executors/policies/slot/task 子包）分层合理；
- 依赖层面：direct 依赖 9 个（chi/cors/websocket/chromedp/goquery/graph/sqlite/testify/x-sys）全部必要且轻量，`go-json-experiment` 是 chromedp 的传递依赖（`go mod why` 确认），无需处理。

---

## 四、代码复用性

### 4.1 必须合并的重复实现（按优先级）

| 重复项 | 位置 | 建议 |
|---|---|---|
| **`ReplaceDomain` ×5** | `orchestrator/executors/executors.go:291`（死）、`sjs/constants.go:94`、`xsnvshen/constants.go:139`（与 sjs **逐字相同**）、`aimeizizi/constants.go:68`、`universal/scraper.go:746`（`buildURLForDomain`） | 统一收编进 **`internal/urlutil`**（该包已存在且活跃），各站点只保留各自的域名列表常量 |
| **`uniqueStrings` ×4** | `aimeizizi/scraperhttp.go:413`、`universal/scraper.go:462`、`xsnvshen/scraper.go:486`、`titleparser/parser.go:650` | 提取到公共工具包（如 `internal/xutil`） |
| **下载源检测 ×2** | `wire_executors.go:893`（字符串匹配版）vs `contentverifier.go:159`（url.Parse 版） | 保留一个（建议 contentverifier 版，语义更严谨），wire_executors 引用之 |
| **文件计数 ×2** | `wire_executors.go:874` `countFilesInDir` vs `taskprogress/engine.go:443` `CountFilesOnDisk` | 保留后者 |
| **`collapseSpaces` ×2** | `titleparser/parser.go:611`、`datarepo/seeder.go:500` | titleparser 版本保留（活跃），seeder 版本随死代码删除 |
| **`ParseExtMetadata` ×2** | `aimeizizi/htmlparser.go:178`、`xsnvshen/pageextractors.go:104` | 两者签名不同（一处带 placeholder），评估后视情况统一；至少对齐命名与结构 |
| **`contains`/`containsStr` ×2** | `aimeizizi/htmlparser.go:379`、`sjs/pageextractors.go:389` | 直接用 `slices.Contains` |

### 4.2 值得保留的"看似重复"

- 各站点 `ExtractSearchResults`/`ExtractExtendedMetadata`：虽然函数名相同，但每个站点 HTML 结构差异大，属于站点适配器模式下的合理重复，**不建议强行抽象**（强行抽象会增加比重复更糟的耦合）。

---

## 五、整改优先级清单

| 优先级 | 行动 | 预期收益 |
|---|---|---|
| **P0** | 删除 14 个整块死代码文件（含 645 行死测试）：`datarepo/`、`patrol/`、`archiver/`、`orchestrator/task/`、`orchestrator/dag/snapshot.go`、`sites/sniffer.go`、`infra/ratelimiter.go`、`infra/handler_*.go`、`executors/sniff_executor.go`、`titleparser/variant.go` | 删 ~2,850 行，占后端 ~6% |
| **P0** | 清理 17 项 staticcheck U1000 未使用项 | 消除全部包内冗余 |
| **P0** | 合并 5 处 `ReplaceDomain` 到 `internal/urlutil` | 消除最大重复 |
| **P1** | 统一 `uniqueStrings`/`contains`/`collapseSpaces`/下载源检测/文件计数等重复实现 | 单一事实来源 |
| **P1** | 拆分 `wire_executors.go`（1,052 行）：业务逻辑下沉 downloader 包 | 装配文件回归职责 |
| **P1** | 拆分 `orchestrator.go`（1,746 行）为生命周期/调度/验证/快照多文件 | 可维护性 |
| **P2** | `RestoreDagForTest` 移入测试文件；删除 `handler_*` 抽象层；评估 segmenter 双模式去留 | 结构轻量化 |
| **P2** | `Makefile.lint` 接入 staticcheck，CI 拦截 U1000 | 防止死代码再积累 |
| **P3** | 评估手写日志框架 → `log/slog`；`resolveURI` → `url.ResolveReference` | 进一步轻量化 |

> 参考：`go vet ./...` 与 `go build ./...` 均零告警，项目编译级健康度良好；上述问题全部是**可删除/可合并的结构性冗余**，不涉及运行行为修正，整改风险低。
