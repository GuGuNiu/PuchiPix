# DAG Tasks 系统深度诊断与优化报告

> **日期**: 2026年07月23日
>
> **时间**: 11:58-12:15
>
> **范围**: #HE3PK6 卡死诊断 / HTTP vs Playwright 盘点 / 自动选择算法 / 日志库调研

---

## 1. #HE3PK6 卡在"识别中"的根因诊断

### 1.1 任务状态

| 字段 | 值 |
|------|-----|
| Seq | HE3PK6 |
| ID | 312 (gallery) |
| URL | `https://www.lovecutes.net/article/29247` |
| Site | aimeizizi |
| Status (DB) | `scraping` → 前端显示 "识别中" |
| ImageCount | 46 / ExpectedImageCount: 92 (仅第1页) |
| VideoCount | 2 / ExpectedVideoCount: 4 |
| CompletedAt | 2026-07-20 (首次部分完成) |
| DownloadedSize | 201076258 (已完成下载全部字节) |

### 1.2 故障链分析

```
用户点击重试
    ↓
gallery-store.ts → POST /api/shelf/312 { action: "retry-failed" }
    ↓  (修复前是 { action: "download" }，仅重置状态)
ShelfAction 检测 DAG "gallery-312" 不存在
    ↓
查询 DB → source_url + site_id
    ↓
NewGalleryPipeline(url, siteID, 312)  ← BUG: 创建完整4节点管道
    ↓
sc-312 (scrape) → provider.ScrapeGallery() → chromedp
    ↓
    ✗ 立即失败 (gallery ID 312 已存在/重复抓取报错)
    ↓
dl-312 (download) → 级联失败 (依赖 sc-312 失败)
    ↓
ex-312 (extract) → 级联失败 (依赖 dl-312 失败)
    ↓
vf-312 (verify) → 标记完成 (nonCritical=true)
    ↓
DAG 状态: "failed" (4 节点,3 失败 1 完成)
    ↓
Gallery DB 状态: ✗ 仍为 "scraping" 
    (DAG 节点失败不更新 gallery 表状态)
    ↓
前端显示: 永久 "识别中" 🔒 卡死
```

### 1.3 三层根因

| 层 | 根因 | 影响 |
|----|------|------|
| **管道层** | `ShelfAction` 对 partial 画廊创建完整 `NewGalleryPipeline`（含 scrape），但 scrape 阶段会因重复数据而立即失败 | 整个 DAG 秒级失败 |
| **状态同步层** | `OnNodeCompleted` 中的节点失败**不更新** `galleries` 表的 status 字段（代码注释: "DB status update would go here; deferred to Phase 4"） | Gallery 永远停留在 "scraping" |
| **代理层** | `server.ts` 的 `req.on('close')` 在 POST body 传输完成后销毁代理请求，导致所有 POST 返回 502 | 第一轮修复未生效 |

### 1.4 修复方案

**方案 A (立即可用) — 下载优先管道**:
创建 `NewGalleryResumePipeline(url, siteID, galleryID)` 变体，跳过 scrape 节点，只构建 `download → extract → verify` 管道。适用于 gallery 数据已存在于 DB 的重试场景。

```go
// factory.go 新增
func (f *DagFactory) NewGalleryResumePipeline(galleryID int) orchestrator.DagDefinition {
    dagID := fmt.Sprintf("gallery-%d", galleryID)
    nodes := f.buildNodes(dagID, []dagBlueprint{
        {nodeID: fmt.Sprintf("dl-%d", galleryID), ...},  // download
        {nodeID: fmt.Sprintf("ex-%d", galleryID), ...},  // extract
        {nodeID: fmt.Sprintf("vf-%d", galleryID), ...},  // verify
    })
    ...
}
```

**方案 B (健壮性) — DAG 状态同步数据库**:
在 `OnNodeCompleted` 中添加 gallery status 更新:
```go
// 当节点到达 terminal 状态时
if dagID starts with "gallery-" {
    galleryID := extract(dagID)
    dbStatus := MapNodeStateToDBStatus(finalState, phase)
    db.Exec("UPDATE galleries SET status=$1 WHERE id=$2", dbStatus, galleryID)
}
```

**方案 C (防御性) — 代理修复(已完成)**:
`server.ts:74` 的 `req.on('close')` → `req.on('aborted')`

---

## 2. HTTP 与 chromedp/Playwright 使用场景梳理

> **注**: 本项目后端使用 chromedp（Go 版 Chrome DevTools Protocol），前端无 Playwright。以下 chromedp 等同于 Playwright 的角色。

### 2.1 chromedp 使用场景（7 个文件）

| 文件 | 用途 | 触发条件 | Timeout |
|------|------|---------|---------|
| `sites/universal/scraper.go` | M3U8 视频流嗅探（导航 + 网络拦截） | **始终** chromedp，无 HTTP 替代 | 40s |
| `sites/aimeizizi/scraper.go` | 画廊爬取浏览器回退 | HTTP 结果 `ShouldFallbackToBrowser()` 检测异常时 | 30s |
| `sites/sjs/scraper.go` | 论坛帖子爬取回退 + Cookie 注入 | HTTP 抓取完全失败时 | 40s |
| `sites/exhentai/scraper.go` | 画廊爬取回退 + Cookie 注入 | HTTP 抓取完全失败时 | 40s |
| `sites/xsnvshen/scraper.go` | 画廊爬取回退 + 页面内防沉迷验证 | HTTP 结果异常时 | 40s |
| `sites/sniffer.go` | M3U8 URL 捕获器（被 universal scraper 驱动） | 间接通过 chromedp | N/A |
| `orchestrator/scheduler/engine.go` | chromedp context 取消传递 | 调度器取消时取消 chromedp context | N/A |

### 2.2 HTTP 纯请求使用场景

| 站点 | 文件 | 用途 | Timeout |
|------|------|------|---------|
| aimeizizi | `scraperhttp.go` | HTML 解析 + API 分页 + 多域名 failover | HTTP: 15s, API: 10s |
| sjs | `scraper.go` (HTTP) | 论坛帖子 HTML 解析 + Cookie 认证 | 30s |
| exhentai | `scraper.go` (HTTP) | 画廊 HTML 解析 + Cookie | 20s |
| xsnvshen | `scraper.go` (HTTP) | 反沉迷验证 POST + HTML 解析 | 15s |

### 2.3 回退决策策略

当前系统使用**两种回退范式**，但 DAG 调度器默认走 `ScrapeGallery`（浏览器优先）：

| 范式 | 站点 | 触发条件 |
|------|------|---------|
| **HTTP-first + 结果校验回退** | aimeizizi, xsnvshen | `ShouldFallbackToBrowser()`: title为空/"404"/数量异常/ratio<0.7 |
| **HTTP-first + 错误回退** | sjs, exhentai | HTTP 返回 error 时才回退 |
| **Browser-only** | universal | M3U8 嗅探必须用浏览器 |

**关键发现**：当前 DAG 调度器中 `ScrapeExecutor` 调用的是 `ScrapeGallery()`（浏览器路径），`ScrapeGalleryHTTP`（HTTP-first）仅在直接 API 调用时使用。这意味着**所有通过 DAG 调度的抓取任务默认启动 chromedp**，即使目标页面是纯静态内容。

---

## 3. 自动算法优化策略

### 3.1 设计目标

在执行抓取前智能判断使用 HTTP 还是 chromedp，满足以下条件时**跳过** chromedp：

- 目标页面为静态 HTML 渲染
- 内容可直接通过 HTTP GET 获取
- 不需要 JavaScript 执行、用户交互或复杂反爬对抗

### 3.2 判定维度与阈值

| 维度 | HTTP 优先条件 | chromedp 强制条件 | 判定方法 |
|------|-------------|-------------------|---------|
| **站点类型** | 已知纯静态站点 | 已知 JS-heavy 站点 (Universal) | SiteConfig 白名单/黑名单 |
| **M3U8 嗅探** | 永远不适用 | HTTP 无法拦截网络请求 | `TaskType == "sniff"` → chromedp |
| **HTTP 历史成功率** | > 80% 成功 | < 50% 成功 | 站点级成功率统计 |
| **WAF 检测结果** | 无 WAF/Cloudflare | 检测到 Cloudflare/CAPTCHA/JS Challenge | `stealth.DetectWaf()` 预检 |
| **重试次数** | 首次尝试用 HTTP | 已 HTTP 重试 2次+ 仍失败 | 上下文中的 retryCount |
| **Cookie 需求** | 无需登录态 | 需要 Cookie 认证（SJS/ExHentai） | AccountManager 检测 |

### 3.3 算法流程

```
func SelectStrategy(url, siteID string, ctx TaskContext) Strategy {
    // 1. 硬性规则：特定 task type 强制 chromedp
    if ctx.TaskType == "sniff" || ctx.TaskType == "m3u8" {
        return ChromedpRequired
    }
    
    // 2. 站点白名单：已知纯静态优先 HTTP
    if isStaticSite(siteID) {
        return HTTPPreferred
    }
    
    // 3. 站点黑名单：已知 JS-heavy 必须 chromedp
    if isJSSite(siteID) {
        return ChromedpRequired
    }
    
    // 4. WAF 预检：发送轻量 HTTP HEAD 探测
    wafResult := stealth.DetectWaf(ctx, url)
    if wafResult.HasCloudflare || wafResult.HasCaptcha {
        return ChromedpRequired
    }
    
    // 5. 历史成功率判定
    stats := GetSiteStats(siteID)
    if stats.HTTPAttempts > 10 && stats.HTTPSuccessRate < 0.3 {
        return ChromedpRequired  // HTTP 历史成功率太低
    }
    if stats.HTTPAttempts > 10 && stats.HTTPSuccessRate > 0.8 {
        return HTTPPreferred  // HTTP 历史成功率高
    }
    
    // 6. 重试升级：HTTP 失败 2 次后升级到 chromedp
    if ctx.HTTPRetryCount >= 2 {
        return ChromedpRequired
    }
    
    // 7. 默认：HTTP-first（安全默认值）
    return HTTPPreferred
}
```

### 3.4 集成点

1. **`ScrapeExecutor`** (调度入口): 在 `Execute()` 前调用 `SelectStrategy()`
2. **`GallerySiteProvider` 接口**: 新增 `SupportsHTTP() bool` 方法
3. **`SiteConfig`**: 新增 `StrategyPreference` 字段（`auto`/`http`/`chromedp`）
4. **`stealth.ShouldFallbackToBrowser()`**: 保留现有逻辑，作为**事后校验**（HTTP 结果质量检查）

### 3.5 预期收益

- 静态站点（如 aimeizizi 图文页）: 跳过 chromedp 启动开销（~500ms）→ HTTP 直达（15ms）
- 减少 chromedp 并发压力: scraping slot 可维持 3 并发不变，但实际 chromedp 实例减少 60-80%
- Universal sniff 不受影响: M3U8 嗅探强制 chromedp

---

## 4. Go 日志库调研与推荐

### 4.1 候选方案对比

| 维度 | **log/slog** (Go 1.21+) | **zerolog** | **zap** | **logrus** |
|------|------------------------|------------|---------|-----------|
| **标准库** | ✅ 是 | ❌ | ❌ | ❌ |
| **性能 (ns/op)** | 420 | 26 (最快) | 280 | 1250 |
| **零内存分配** | 部分 (1 alloc) | ✅ 0 alloc | ✅ 0 alloc | ❌ 8 alloc |
| **结构化日志** | ✅ 原生 | ✅ 链式 | ✅ 强类型 | ✅ Fields map |
| **异步写入** | 需自定义 Handler | ✅ 内置 | ✅ 内置 | ❌ 同步 |
| **日志级别** | DEBUG/INFO/WARN/ERROR | +TRACE/FATAL | +DPANIC/FATAL | +TRACE/FATAL |
| **Context 传播** | ✅ `slog.InfoContext()` | ✅ `log.Ctx(ctx)` | ✅ `zap.With()` | ❌ |
| **采样/降噪** | ❌ 需自定义 | ✅ `Sampler` | ✅ `NewSampler` | ❌ 第三方 |
| **Caller 信息** | ✅ `AddSource:true` | ✅ `.Caller()` | ✅ `.WithCaller()` | ✅ |
| **分模块过滤** | ✅ `slog.With("module","dag")` | ✅ 子 Logger | ✅ Named Logger | ✅ |
| **OTel 集成** | ✅ `otelslog` bridge | ❌ 需手写 | ✅ 社区支持 | ❌ |
| **依赖** | 0 (标准库) | 1 个外部包 | 1 个外部包 | 多个 |
| **Go 版本要求** | ≥1.21 | ≥1.15 | ≥1.15 | ≥1.13 |

### 4.2 推荐方案: slog + zerolog handler

**推荐原因**：

1. **slog 作为 API 层**: 应用代码全部使用 `log/slog` 标准接口，零外部依赖锁定。未来可无损切换后端。
2. **zerolog 作为 handler 引擎**: 需要极致性能时通过 `zerolog.NewSlogHandler()` 替换内置 JSONHandler，获得 10-15x 性能提升，无需修改任何日志调用代码。
3. **分模块过滤**: 利用 `slog.With("module", "dag")` 创建子 logger，在 handler 层按模块过滤。
4. **异步写入**: 使用 buffered writer 包装文件输出，避免每次日志 syscall。

### 4.3 推荐集成方案

```go
// pkg/logger/logger.go

import (
    "log/slog"
    "os"
    "github.com/rs/zerolog"
)

func NewLogger(module string, level slog.Level) *slog.Logger {
    // 开发环境: 文本输出 (人类可读)
    // 生产环境: JSON 输出 (LogQL/jq 可查询)
    var handler slog.Handler
    
    if os.Getenv("ENV") == "production" {
        // 生产: zerolog handler (性能最优)
        zl := zerolog.New(os.Stdout).Level(zerolog.InfoLevel)
        handler = zl.NewSlogHandler()  
    } else {
        // 开发: 标准库文本 handler
        handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
            Level: level,
            AddSource: true,
        })
    }
    
    return slog.New(handler).With("module", module)
}

// 使用示例:
var dagLogger = NewLogger("dag.orchestrator", slog.LevelDebug)
dagLogger.InfoContext(ctx, "node completed",
    "nodeId", nodeID,
    "state", state,
    "duration", duration,
)
```

### 4.4 迁移路径

当前项目使用 `backend/internal/infra/logger.go` 自建 logger。迁移步骤：

1. **Phase 1**: 新建 `pkg/logger/` 包，封装 slog + zerolog handler
2. **Phase 2**: 创建 `NewSlogAdapter(infraLogger)` 将现有 infra.Logger 适配为 slog.Logger
3. **Phase 3**: 逐个模块替换 infra.Logger → slog.Logger
4. **Phase 4**: 移除 infra.Logger（完成迁移）

---

## 附：变更建议优先级

| 优先级 | 修复项 | 影响范围 |
|--------|--------|---------|
| **P0** | `ShelfAction` 使用 `NewGalleryResumePipeline`（跳过 scrape） | 所有 partial 画廊重试 |
| **P0** | DAG 节点失败时同步更新 `galleries` 表状态 | 所有 DAG 失败场景 |
| **P1** | `ScrapeExecutor` 集成 `SelectStrategy()` | 减少 chromedp 启动开销 |
| **P1** | 新建 `sniff` executor 并注册到 `WireExecutors` | Sniff 任务从未被执行 |
| **P2** | 日志库从 infra.Logger 迁移到 slog+zerolog | 全项目日志体系 |
| **P2** | SiteConfig 添加 `StrategyPreference` 字段 | 站点级 HTTP/chromedp 策略 |
