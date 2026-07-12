# 开发日志 — 2026-07-12 — 反检测增强 + 多线程下载优化

## 1. 概述

基于 `01-ouo-io-download-e2e-test.md` 的测试结果，对下载链路进行了三个维度的优化：

| 维度 | 优化内容 | 效果 |
|------|---------|------|
| 反检测 | 人类行为模拟 + Chrome 反检测启动参数 + CDP 指纹覆盖 | Stealth 检测通过率 24/25 |
| 下载速度 | HTTP Range 多线程分块下载器（4 线程并行） | 预期 3-5x 加速 |
| 模块逻辑 | ouo.io URL 缓存 + 智能重试避免重复访问 | 避免 IP 限速触发 |

---

## 2. 浏览器池升级（`browser-pool.ts`）

### 2.1 问题

原浏览器池使用 `headless: true` 且无反检测启动参数，Chrome 的 `--enable-automation` 标志和 Blink 自动化特征容易被 Cloudflare/ouo.io 识别。

### 2.2 修复

新增 14 个 Chrome 反检测启动参数：

| 参数 | 作用 |
|------|------|
| `--disable-blink-features=AutomationControlled` | 移除 CDP 自动化标志（最关键） |
| `--disable-features=IsolateOrigins,site-per-process` | 降低站点隔离指纹 |
| `--disable-infobars` | 隐藏 "Chrome is being controlled by automated software" 提示 |
| `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` | 防止 WebRTC IP 泄漏 |
| `--disable-ipc-flooding-protection` | 避免 IPC 限流影响自动化操作时序 |
| 其他 9 个 | 禁用扩展、首次运行提示、后台网络等 |

新增环境变量 `STEALTH_HEADLESS`：
- `"false"` 或 `"0"`：使用非 headless 模式（最强反检测，需要桌面环境）
- 默认：`true`（Playwright 1.60+ 已使用新版 headless）

---

## 3. 人类行为模拟（`anti-crawler.ts` v2.0 新增）

### 3.1 问题

原有代码使用 `page.click()` 直接点击元素，没有鼠标移动轨迹和点击时序模拟。真实用户的点击行为是：鼠标移动 → 停顿 → 按下 → 停顿 → 释放，而自动化工具的点击是瞬时的。

### 3.2 新增函数

#### `humanMouseMove(page, selector)`

模拟人类鼠标移动轨迹：
1. 获取目标元素的 boundingBox
2. 从随机起点出发，分 3-5 段移动到目标中心附近
3. 每段使用线性插值 + 随机抖动（±20px）
4. 每段间隔 50-150ms（高斯分布）

#### `humanClick(page, selector)`

模拟人类点击时序：
1. 先调用 `humanMouseMove` 移动鼠标到目标
2. 等待 50-200ms（高斯分布）
3. 精确定位到元素中心（带随机偏移）
4. `mouse.down()` → 等待 20-80ms → `mouse.up()`
5. 总耗时 200-800ms

#### `humanWait()`

高斯分布随机等待，均值 2000ms，标准差 800ms（范围约 1000-4000ms）。

#### `humanScroll(page, scrolls)`

模拟人类页面滚动：
- 每次滚动 100-400px
- 滚动间隔 300-700ms（高斯分布）

### 3.3 应用场景

在 `zip-downloader.ts` 的 ouo.io 解析流程中：
- 页面加载后 `humanWait()` + `humanScroll()` 模拟浏览
- 每步点击前 `humanWait()` + `humanScroll()` 模拟阅读
- 所有 `page.click()` 替换为 `humanClick()`
- MediaFire 页面也应用同样的行为模拟

---

## 4. CDP 指纹覆盖

### 4.1 问题

`addInitScript` 注入的反检测脚本在某些场景下会被绕过（如检测 `window.outerHeight === 0` 或使用 CDP 协议级别的检测）。

### 4.2 修复

在 `applyStealthToPage` 中新增 CDP 会话操作：
- `Page.setWebLifecycleState` → `active`：确保页面处于活跃状态
- `Emulation.setDeviceMetricsOverride`：通过 CDP 层面设置设备参数，与 init script 形成双重覆盖

---

## 5. 多线程分块下载器（`parallel-downloader.ts` 新建）

### 5.1 问题

MediaFire 免费用户单连接限速约 170 KB/s，261MB 文件需要约 25 分钟。

### 5.2 实现原理

```
探测阶段（HEAD 请求）
    ├── 获取 Content-Length（文件总大小）
    ├── 检查 Accept-Ranges: bytes（是否支持 Range）
    └── 提取 Content-Disposition 文件名
    │
    ├── HEAD 失败（403/405/网络错误）→ 降级为 GET Range: bytes=0-0
    │   └── 从 Content-Range 头解析总大小
    │
    ▼
分块阶段
    ├── 文件 > 5MB 且支持 Range → 多线程
    │   ├── 预分配文件空间（fs.ftruncateSync）
    │   ├── 分成 N 块（默认 4，最大 8）
    │   └── 每块独立 HTTP GET Range 请求，并行下载
    │       └── 使用 fs.writeSync(fd, data, 0, len, offset) 定位写入
    │
    └── 文件 < 5MB 或不支持 Range → 单线程降级
```

### 5.3 关键设计

| 特性 | 说明 |
|------|------|
| HEAD 降级 | HEAD 返回 403/405 时自动降级为 GET Range: bytes=0-0 探测 |
| 网络错误降级 | HEAD 网络错误（socket hang up 等）也降级为 GET Range |
| 分块重试 | 每块最多 3 次重试，指数退避 2s→4s→8s + 随机抖动 |
| 文件验证 | 下载完成后验证文件大小是否匹配 Content-Length |
| 进度报告 | 每 5MB 输出一次进度，含百分比和速度 |
| 预分配空间 | 使用 `fs.ftruncateSync` 预分配文件空间，避免文件大小不匹配 |

### 5.4 测试结果

使用 OVH 测试文件（`https://proof.ovh.net/files/10Mb.dat`）：

```
文件大小: 10,485,760 bytes (10.0 MB)
Range 支持: true
使用并行: 4 线程
成功: true
```

✅ 4 线程并行下载验证通过，文件大小校验正确。

### 5.5 性能预期

| 场景 | 单线程 | 4 线程 | 加速比 |
|------|--------|--------|--------|
| MediaFire 170 KB/s 限速 | ~25 分钟 | ~7 分钟 | 3.5x |
| 无限速 CDN | ~5 分钟 | ~2 分钟 | 2.5x |

> 注：实际加速比受 CDN 总带宽限制，超过 8 线程后边际收益递减。

---

## 6. ouo.io URL 缓存

### 6.1 问题

下载重试时，`resolveDirectDownloadUrl` 会重新访问 ouo.io 链接，触发 IP 限速（重定向到 `/shorten` 页面）。

### 6.2 实现

```typescript
const ouoCache = new Map<string, { directUrl: string; filename: string; expires: number }>();
const OUO_CACHE_TTL = 10 * 60 * 1000; // 10 分钟
```

- ouo.io 解析成功后，将 `{ directUrl, filename, expires }` 存入缓存
- 下次解析同一 ouo.io URL 时，直接返回缓存结果
- 缓存有效期 10 分钟（与 ouo.io 的 IP 限速冷却时间匹配）
- 下载重试时不再访问 ouo.io，仅重试文件下载阶段

### 6.3 效果

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 下载失败重试 | 重新访问 ouo.io → 可能触发 IP 限速 | 使用缓存直链 → 仅重试下载 |
| ouo.io 冷却期间 | 无法重试 | 可继续重试下载（直链仍有效） |

---

## 7. Stealth 模式验证结果

使用 `https://bot.sannysoft.com/` 检测页面验证：

| 检测项 | 结果 | 期望 |
|--------|------|------|
| navigator.webdriver | `false` ✅ | false |
| navigator.languages | `["zh-CN","zh","en-US","en"]` ✅ | 非空数组 |
| navigator.plugins.length | `5` ✅ | > 0 |
| navigator.platform | `Win32` ✅ | 桌面平台 |
| navigator.hardwareConcurrency | `4` ✅ | > 0 |
| window.chrome 存在 | `true` ✅ | true（Chromium 系） |
| WebGL Vendor | `Google Inc. (Intel)` ✅ | 已覆盖 |
| WebGL Renderer | `ANGLE (Intel, Intel(R) UHD...)` ✅ | 已覆盖 |
| 通过检测数 | 24/25 ✅ | — |
| 唯一失败项 | `WebDriver (New): present` ⚠️ | CDP 级检测，headless 模式下的已知限制 |

> 唯一未通过的 `WebDriver (New)` 检测是 CDP 协议级别的检测，在 headless 模式下无法完全消除。使用 `STEALTH_HEADLESS=false` 环境变量可完全绕过此检测。

---

## 8. 人类行为模拟验证结果

| 函数 | 耗时 | 期望范围 | 结果 |
|------|------|---------|------|
| `humanWait()` | 3258ms | 1000-4000ms | ✅ |
| `humanScroll(page, 3)` | ~1500ms | 900-2100ms | ✅ |
| `humanClick(page, 'a')` | 686ms | 200-800ms | ✅ |

---

## 9. 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/core/browser-pool.ts` | 修改 | 新增 14 个 Chrome 反检测启动参数；支持 `STEALTH_HEADLESS` 环境变量配置 headless 模式 |
| `src/lib/core/anti-crawler.ts` | 修改 | 新增 `humanMouseMove`、`humanClick`、`humanWait`、`humanScroll` 4 个人类行为模拟函数；`applyStealthToPage` 新增 CDP 指纹覆盖 |
| `src/lib/downloader/parallel-downloader.ts` | 新建 | 多线程分块下载器：HEAD/GET Range 探测、4 线程并行下载、分块重试、文件验证 |
| `src/lib/downloader/zip-downloader.ts` | 修改 | ouo.io URL 缓存（10 分钟 TTL）；所有 `page.click()` 替换为 `humanClick()`；下载阶段替换为 `parallelDownload`；MediaFire 解析增加人类行为模拟 |
| `test/e2e-v2-anti-detect-test.ts` | 新建 | v2.0 端到端测试：Stealth 检测、人类行为模拟、完整下载链路 |
| `test/test-parallel-downloader.ts` | 新建 | 多线程下载器独立测试 |

---

## 10. 架构图（v2.0 完整链路）

```
图库详情页 (lovecutes.com/article/xxx)
    │
    ├── extractZipDownloadInfo()
    │   └── eligibility API → ouo.io 短链接
    │
    ▼
downloadAndExtractZip(galleryId)
    │
    ├── [跳过检查] 扫描 zipDir 是否已有 .zip/.rar 文件
    │
    ├── [阶段 1] resolveDirectDownloadUrl(ouo.io URL)
    │   │
    │   ├── resolveOuoIo()
    │   │   ├── 检查 ouoCache（10 分钟 TTL）→ 命中则直接返回
    │   │   ├── createStealthPage（反检测启动参数 + init scripts + CDP）
    │   │   ├── 导航到 ouo.io → humanWait() + humanScroll()
    │   │   ├── 第一步: humanClick("I'm a human") → /go/{id}
    │   │   ├── humanWait() + humanScroll()
    │   │   ├── 第二步: 设置 response 监听器 → humanClick("Get Link")
    │   │   └── 缓存结果到 ouoCache
    │   │
    │   ├── resolveMediaFire()
    │   │   ├── humanWait() + humanScroll()
    │   │   ├── 检查 #downloadButton href
    │   │   └── humanClick() → 等待倒计时 → 直链提取
    │   │
    │   └── 返回 { directUrl, filename, sourceUrl }
    │
    ├── [阶段 2] parallelDownload(directUrl, filePath, { chunkCount: 4 })
    │   ├── probeUrl (HEAD) → 失败降级 probeUrlWithGet (GET Range: bytes=0-0)
    │   ├── 文件 > 5MB 且支持 Range → 4 线程并行
    │   │   ├── 预分配文件空间 (fs.ftruncateSync)
    │   │   ├── 4 个 downloadChunk 并行 (各自 Range 请求)
    │   │   └── 每块 3 次重试 + 指数退避
    │   └── 文件 < 5MB 或不支持 Range → 单线程降级
    │
    └── [阶段 3] extractArchive(zipPath, extractDir, password)
        ├── .rar → extractRar() → node-unrar-js (WASM)
        └── .zip → extractZipFile() → adm-zip
```

---

## 11. 使用方式

### 11.1 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `STEALTH_HEADLESS` | `true` | `"false"` 或 `"0"` 使用非 headless 模式（最强反检测） |
| `GALLERY_ZIP_PATH` | `./data/gallery_zips` | ZIP 文件保存根目录 |

### 11.2 测试命令

```bash
# Stealth 模式验证
npx tsx test/e2e-v2-anti-detect-test.ts 10 3

# 人类行为模拟验证
npx tsx test/e2e-v2-anti-detect-test.ts 10 4

# 多线程下载器测试
npx tsx test/test-parallel-downloader.ts

# 完整端到端测试
npx tsx test/e2e-v2-anti-detect-test.ts 10 all

# 使用非 headless 模式（最强反检测，需要桌面环境）
$env:STEALTH_HEADLESS="false"; npx tsx test/e2e-v2-anti-detect-test.ts 10 all
```

---

## 12. 修订记录

| 日期 | 修订内容 |
|------|---------|
| 2026-07-12 | 初始版本：浏览器池反检测升级、人类行为模拟、多线程分块下载器、ouo.io URL 缓存 |
