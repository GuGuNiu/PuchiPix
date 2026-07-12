# 开发日志 — 2026-07-11 — 功能九：反爬虫机制全面升级 — 100 UA + 浏览器指纹模拟 + Stealth 注入

## 功能九：反爬虫机制全面升级 — 100 UA + 浏览器指纹模拟 + Stealth 注入

### 9.1 背景问题

原有反爬虫模块 `anti-crawler.ts` 仅提供 5 个 User-Agent，且仅做 UA 轮换和简单延迟，存在以下不足：

| 问题 | 影响 |
|------|------|
| UA 池仅 5 个 | 高频爬取时 UA 重复率高，易被站点识别为爬虫 |
| 无浏览器指纹模拟 | UA 声称是 Chrome 但 `sec-ch-ua`、`navigator.platform`、`navigator.vendor` 等指纹不匹配，被高级反爬系统检测 |
| 无 Stealth 注入 | `navigator.webdriver = true`、无 `window.chrome` 对象、`navigator.plugins` 为空，Playwright 自动化特征明显 |
| 延迟为均匀分布 | `randomDelay(800, 1500)` 产生均匀分布的间隔，与人类操作的高斯分布模式不符 |
| 指数退避无抖动 | `baseDelay × 2^retry` 产生完美的几何级数，可被模式识别 |
| HTTP 请求头不完整 | 仅设置 UA 和 Accept-Language，缺少 `Accept`、`Accept-Encoding`、`sec-fetch-*` 等浏览器标准头 |

### 9.2 开源社区实践参考

本次升级参考了以下开源项目和社区的 anti-bot 最佳实践：

| 项目/实践 | 参考内容 |
|----------|---------|
| `fake-useragent` (Python) | 大规模真实 UA 池设计思路，按浏览器/平台分类 |
| `puppeteer-extra-stealth` | 12 项 navigator 属性覆盖技术 |
| `playwright-stealth` | `addInitScript` 注入时机和方式 |
| Cloudflare anti-bot bypass 社区讨论 | `sec-ch-ua` Client Hints 一致性要求 |
| `user-agents` (npm) | 浏览器 Profile 数据结构设计 |
| 各反爬虫论坛 (Stack Overflow, Reddit r/webscraping) | sec-fetch-* 头的一致性、WebGL 指纹检测 |

### 9.3 浏览器 Profile 系统

设计了 `BrowserProfile` 接口，每个 UA 搭配完整的浏览器指纹信息：

```typescript
interface BrowserProfile {
  ua: string;                    // User-Agent 字符串
  browser: BrowserType;          // chrome | firefox | safari | edge
  platform: Platform;            // windows | macos | linux | android | ios
  secChUa?: string;              // Chromium 系 Client Hints
  secChUaMobile: string;         // ?0 (桌面) | ?1 (移动)
  secChUaPlatform: string;       // "Windows" | "macOS" | ...
  accept: string;                // 浏览器特定 Accept 头
  acceptEncoding: string;        // 浏览器特定 Accept-Encoding
  viewport: { width, height };   // 匹配平台的视口尺寸
  hardwareConcurrency: number;   // CPU 核心数
  deviceMemory: number;          // 设备内存 (GB)
  navigatorPlatform: string;     // navigator.platform 值
  vendor: string;                // navigator.vendor 值
  maxTouchPoints: number;        // 触控点数 (桌面=0, 移动=5)
}
```

**关键设计决策**：

- 不同浏览器有不同的 `Accept` 和 `Accept-Encoding` 值（Chrome 支持 `zstd`，Firefox 不支持）
- `sec-ch-ua` 仅 Chromium 系浏览器发送，Firefox 和 Safari 不发送
- `navigator.platform` 必须与 UA 平台一致（Windows → `Win32`，macOS → `MacIntel`）
- `navigator.vendor` 按浏览器区分（Chrome → `Google Inc.`，Safari → `Apple Computer, Inc.`）
- 每个版本有独立的 `sec-ch-ua` brand 令牌（Chrome 120-126 各不同，基于真实浏览器抓包数据）

### 9.4 100 个 UA 分布

100 个 Profile 按浏览器和平台分布：

| 浏览器 | 平台 | 数量 | 版本范围 |
|--------|------|------|---------|
| Chrome | Windows | 10 | 120-126 |
| Chrome | macOS | 15 | 120-126 |
| Chrome | Linux | 10 | 120-126 |
| Chrome | Android | 15 | 120-126 (15 种设备) |
| Firefox | Windows | 12 | 121-127 |
| Firefox | macOS | 8 | 122-127 |
| Firefox | Linux | 7 | 121-127 |
| Safari | macOS | 8 | 17.0-17.5 |
| Safari | iOS | 7 | 17.0-17.5 |
| Edge | Windows | 8 | 122-126 |
| Edge | macOS | 5 | 122-126 |
| **合计** | | **100** | |

**Profile 差异化**：相同浏览器+平台的 Profile 通过不同版本号、视口尺寸（1920×1080, 2560×1440, 1366×768, 1440×900 等）、CPU 核心数（4/6/8/10/12）、设备内存（4/8/16GB）实现差异化，避免完全相同的指纹。

**Android 设备多样性**：15 个 Chrome on Android Profile 覆盖了 Pixel 8/7/6、Samsung Galaxy S24/S23/S22、OnePlus 12/11、Xiaomi 14/13、Huawei Mate 60 Pro、Oppo Find X7、Vivo X100 Pro、Honor Magic 6 Pro 等真实设备型号。

### 9.5 Playwright Stealth 注入

实现了 12 项反自动化检测注入，通过 `page.addInitScript()` 在页面脚本执行前生效：

| # | 检测向量 | 注入方式 | 说明 |
|---|---------|---------|------|
| 1 | `navigator.webdriver` | `Object.defineProperty → false` | 最基本的自动化标志位 |
| 2 | `window.chrome` | 注入完整 chrome 对象 | 含 `app`、`runtime`、`csi`、`loadTimes` |
| 3 | `navigator.plugins` | 注入 5 个 PDF 插件 | 含 `namedItem`、`refresh`、`item` 方法 |
| 4 | `navigator.languages` | `['zh-CN', 'zh', 'en-US', 'en']` | 匹配 Accept-Language 头 |
| 5 | `navigator.platform` | 匹配 Profile | Win32 / MacIntel / Linux x86_64 / Linux armv8l / iPhone |
| 6 | `navigator.hardwareConcurrency` | 匹配 Profile | 4/6/8/10/12 |
| 7 | `navigator.deviceMemory` | 匹配 Profile | 4/8/16（仅 Chromium 系） |
| 8 | `navigator.vendor` | 匹配浏览器 | Google Inc. / Apple Computer, Inc. / 空字符串 |
| 9 | `navigator.maxTouchPoints` | 匹配设备 | 桌面=0, 移动=5 |
| 10 | WebGL 渲染器指纹 | 覆盖 `getParameter` | 返回 Intel UHD Graphics 630 |
| 11 | `navigator.permissions.query` | 覆盖 notifications 查询 | 返回 `Notification.permission` |
| 12 | `window.outerWidth/outerHeight` | 修复 headless 下的 0 值 | 匹配视口尺寸 |

**两种应用方式**：

```typescript
// 方式一：applyStealthToPage — 在已有 Page 上注入（向后兼容）
const page = await browser.newPage();
await applyStealthToPage(page, undefined, referer);

// 方式二：createStealthPage — 创建 Context + Page 全套注入（推荐）
const { page, context, profile } = await createStealthPage(browser, undefined, referer);
// ... 使用 page ...
await context.close(); // 自动清理
```

`createStealthPage` 在 `BrowserContext` 级别设置 `userAgent` 和 `viewport`，确保 `navigator.userAgent` 和 HTTP `User-Agent` 头一致，比 `setExtraHTTPHeaders` 更可靠。

### 9.6 高斯分布延迟

新增 `gaussianDelay(mean, stddev)` 函数，使用 Box-Muller 变换生成正态分布随机数：

```typescript
function gaussianDelay(mean: number, stddev: number): number {
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mean + z * stddev));
}
```

**人类行为模拟**：真实用户操作间隔服从正态分布（大量操作集中在均值附近，极端快/慢较少），而非均匀分布（每个间隔概率相等）。`gaussianDelay((800+1500)/2, 200)` 产生均值 1150ms、标准差 200ms 的延迟，比 `randomDelay(800, 1500)` 更接近人类模式。

已在 `search-engine.ts` 的批量爬取间隔中使用 `gaussianDelay`。

### 9.7 指数退避优化

原 `backoffDelay` 产生完美的几何级数（1s → 2s → 4s），可被模式识别。升级后加入 ±20% 随机抖动：

```typescript
function backoffDelay(retryCount, baseDelay = 2000, maxDelay = 16000): number {
  const raw = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
  const jitter = raw * 0.2 * (Math.random() * 2 - 1); // ±20% 抖动
  return Math.max(0, Math.round(raw + jitter));
}
```

| 重试次数 | 原延迟 | 升级后延迟范围 |
|---------|--------|-------------|
| 0 | 2000ms | 1600~2400ms |
| 1 | 4000ms | 3200~4800ms |
| 2 | 8000ms | 6400~9600ms |
| 3 | 16000ms | 12800~19200ms (cap 16000) |

### 9.8 消费方升级

#### 9.8.1 `gallery/route.ts`

```typescript
// 修改前
const page = await browser.newPage();
await page.setExtraHTTPHeaders({
  'User-Agent': randomUA(),
  'Accept-Language': DEFAULT_ACCEPT_LANGUAGE,
  Referer: provider.baseUrl,
});

// 修改后
const { page, context } = await createStealthPage(browser, undefined, provider.baseUrl);
```

#### 9.8.2 `tasks/route.ts`

同上，使用 `createStealthPage` 替代手动 `newPage` + `setExtraHTTPHeaders`。

#### 9.8.3 `gallery-downloader.ts`

```typescript
// 修改前
headers: { 'User-Agent': randomUA(), ...headers }

// 修改后
headers: { ...buildStealthHeaders(randomProfile()), ...headers }
```

`buildStealthHeaders` 生成完整请求头（Accept、Accept-Encoding、sec-ch-ua、sec-fetch-* 等），比仅 UA 大幅降低被 CDN WAF 拦截的概率。

#### 9.8.4 `search-engine.ts`

搜索页面和爬取页面均改用 `applyStealthToPage`：
- `executeSearch`：搜索结果页注入 stealth
- `executeBatchSearch`：批量搜索页注入 stealth
- `scrapeVideoPage`：视频详情页注入 stealth + Referer
- 批量爬取间隔改用 `gaussianDelay`

### 9.9 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/core/anti-crawler.ts` | 重写 | 100 个 BrowserProfile、Stealth 注入、高斯延迟、增强退避 |
| `src/lib/core/index.ts` | 修改 | 导出新接口：`BROWSER_PROFILES`、`randomProfile`、`buildStealthHeaders`、`buildPageHeaders`、`getStealthScripts`、`applyStealthToPage`、`createStealthPage`、`gaussianDelay`、`BrowserType`、`Platform`、`BrowserProfile` |
| `src/app/api/gallery/route.ts` | 修改 | 改用 `createStealthPage` 创建页面 |
| `src/app/api/tasks/route.ts` | 修改 | 改用 `createStealthPage` 创建页面 |
| `src/lib/downloader/gallery-downloader.ts` | 修改 | 下载请求改用 `buildStealthHeaders(randomProfile())` |
| `src/lib/search/search-engine.ts` | 修改 | 搜索/爬取页面改用 `applyStealthToPage`，批量间隔改用 `gaussianDelay` |

### 9.10 验证结果

- TypeScript 编译：0 错误（新增和修改文件）
- ESLint：0 错误（新增和修改文件）
- 向后兼容：`USER_AGENTS`、`randomUA()`、`buildAntiCrawlerHeaders()`、`sleep()`、`randomDelay()`、`backoffDelay()` 等原有接口保持不变

### 9.11 架构图

```
                          ┌──────────────────────────────┐
                          │     anti-crawler.ts v2.0      │
                          │                              │
                          │  ┌────────────────────────┐  │
                          │  │  100 BrowserProfiles   │  │
                          │  │  Chrome × Win/Mac/     │  │
                          │  │  Linux/Android         │  │
                          │  │  Firefox × Win/Mac/    │  │
                          │  │  Linux                 │  │
                          │  │  Safari × macOS/iOS    │  │
                          │  │  Edge × Win/macOS      │  │
                          │  └───────────┬────────────┘  │
                          │              │               │
                          │  ┌───────────▼────────────┐  │
                          │  │  randomProfile()       │  │
                          │  └───┬───────┬───────┬────┘  │
                          │      │       │       │       │
                          │  ┌───▼──┐ ┌──▼──┐ ┌──▼────┐ │
                          │  │Headers│ │Stealth│ │Delay  │ │
                          │  │Builder│ │Scripts│ │Algo   │ │
                          │  └──┬───┘ └──┬───┘ └──┬────┘ │
                          └─────┼────────┼────────┼──────┘
                                │        │        │
              ┌─────────────────┼────────┼────────┼─────────┐
              │                 │        │        │         │
              ▼                 ▼        ▼        ▼         ▼
     gallery/route.ts    tasks/route.ts  search-engine.ts  gallery-downloader.ts
     createStealthPage   createStealthPage  applyStealthToPage  buildStealthHeaders
              │                 │        │        │         │
              ▼                 ▼        ▼        ▼         ▼
         BrowserContext    BrowserContext  Page     Page    HTTP Request
         + Stealth          + Stealth    + Stealth         + Full Headers
         + Profile UA       + Profile UA  + Profile UA     + Profile UA
         + Viewport         + Viewport    + Viewport       + sec-ch-ua
         + sec-ch-ua        + sec-ch-ua   + sec-ch-ua      + sec-fetch-*
         + 12 injections    + 12 inj.     + 12 injections  + Accept
```

### 升级前后对比

| 维度 | 升级前 | 升级后 |
|------|--------|--------|
| UA 数量 | 5 | 100 |
| 浏览器类型 | Chrome + Firefox + Safari | Chrome + Firefox + Safari + Edge |
| 平台覆盖 | Windows + macOS | Windows + macOS + Linux + Android + iOS |
| 浏览器指纹 | 无 | sec-ch-ua + viewport + hardwareConcurrency + deviceMemory + platform + vendor + maxTouchPoints |
| Stealth 注入 | 无 | 12 项反检测 |
| 延迟算法 | 均匀分布 | 均匀分布 + 高斯分布 |
| 退避抖动 | 无 | ±20% 随机抖动 |
| HTTP 请求头 | UA + Accept-Language | 完整请求头（Accept + Accept-Encoding + sec-ch-ua + sec-fetch-* + Referer） |
| Playwright 集成 | setExtraHTTPHeaders | createStealthPage（Context 级 UA + Viewport + Stealth） |

---
