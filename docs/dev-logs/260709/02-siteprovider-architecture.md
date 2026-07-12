# 开发日志 — 2026-07-09 — SiteProvider 站点提供者架构

## 架构变更 — SiteProvider 站点提供者

### 重构前

```
scraper.ts          ← 硬编码 kanav 标题清洗规则、播放按钮选择器、M3U8 排除关键词
search-engine.ts    ← 硬编码 SITE_BASE、SEARCH_URL_TEMPLATE、搜索结果选择器
```

所有站点特有逻辑散落在两个文件中，无法复用，也无法扩展新站点。

### 重构后

```
src/lib/sites/
├── types.ts                      # SiteProvider 接口定义
├── base-provider.ts              # BaseSiteProvider 抽象基类（通用爬取逻辑）
├── site-registry.ts              # 站点注册中心（单例，URL 路由）
├── index.ts                      # 统一导出
└── providers/
    └── kanav-provider.ts         # KanAV (kanav.ad) 站点提供者

src/lib/scraper/scraper.ts        # 委托 SiteProvider，无站点特有代码
src/lib/search/search-engine.ts   # 委托 SiteProvider，无站点特有代码
```

### 架构图

```
┌─────────────────────────────────────────────────────┐
│                   SiteRegistry                       │
│   (管理所有 Provider，根据 URL 路由到正确的 Provider)  │
└──────────────┬──────────────────────┬───────────────┘
               │                      │
       ┌───────▼────────┐   ┌────────▼────────┐
       │  KanavProvider   │   │  XxxProvider    │  ← 未来扩展
       │  (kanav.ad)      │   │  (其他站点)      │
       └───────┬──────────┘   └─────────────────┘
               │
       ┌───────▼───────────────────────────┐
       │        BaseSiteProvider            │
       │  通用逻辑：                         │
       │  - M3U8 网络请求拦截与过滤           │
       │  - 搜索结果页 DOM 解析               │
       │  - 视频标题提取（document.title/OG）  │
       │  - 标签提取（meta keywords/DOM）     │
       │  - 演员提取（JSON-LD/DOM/正则）       │
       │  - 播放按钮自动点击                  │
       │  - 页面 JS 内嵌 M3U8 扫描            │
       │  - M3U8 URL 去重与优先级排序          │
       └────────────────────────────────────┘
```

---


---

## 新增文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/lib/sites/types.ts` | 164 | `SiteProvider` 接口、`SiteConfig`、`SiteSearchResult`、`SiteInfo` 类型定义 |
| `src/lib/sites/base-provider.ts` | 502 | 抽象基类，封装所有通用爬取逻辑，子类只需覆写站点特有方法 |
| `src/lib/sites/providers/kanav-provider.ts` | 139 | KanAV 站点提供者，封装搜索 URL 构造、标题清洗、URL 匹配 |
| `src/lib/sites/site-registry.ts` | 157 | 注册中心单例，管理所有 Provider，支持按 URL/ID 查找 |
| `src/lib/sites/index.ts` | 18 | 统一导出 |
| `src/app/api/sites/route.ts` | 27 | `GET /api/sites` 返回所有已注册站点列表（供前端展示） |
| `src/components/search/video-card.tsx` | 256 | 视频卡片组件，支持封面图显示、hls.js 16x 悬浮预览、单卡爬取按钮 |
| `src/app/api/search/scrape/route.ts` | 52 | `POST /api/search/scrape` 视频爬取 API（支持单个/批量） |
| `public/vendor/hls.min.js` | — | hls.js 本地化文件（543KB），替代 npm 依赖 |
| `docs/dev-logs/2026-07-09.md` | — | 本开发日志 |

---


---

## 修改文件 — SiteProvider 重构

### `src/lib/scraper/scraper.ts`

- **移除**：`cleanTitle()` 函数、`M3U8_EXCLUDE_PATTERNS` 常量、`ACTOR_PATTERNS` 常量、所有站点特有 DOM 选择器、所有内联的标题/标签/演员提取逻辑、播放按钮点击逻辑、JS M3U8 扫描逻辑
- **新增**：`getProvider(url)` 方法，通过 `SiteRegistry.getProviderByUrl()` 自动匹配站点提供者，无匹配时回退到 `KanavProvider`
- **改动**：`scrape()` 方法简化为「打开页面 → 调用 `provider.scrapePage()`」，从 ~400 行缩减至 ~110 行

### `src/lib/search/search-engine.ts`

- **移除**：`SITE_BASE` 常量、`SEARCH_URL_TEMPLATE` 常量、`cleanTitle()` 函数、`scrapeVideoPage()` 中的所有站点特有逻辑（标题/标签/演员提取、播放按钮点击、JS 扫描、M3U8 排序）
- **新增**：`getProvider(siteId?)` 方法，根据站点 ID 获取提供者
- **改动**：
  - `search()` 方法新增 `siteId` 参数
  - `executeSearch()` 接收 `provider` 参数，通过 `provider.buildSearchUrl()` 构造搜索 URL，通过 `provider.extractSearchResults()` 提取搜索结果
  - `scrapeVideoPage()` 接收 `provider` 参数，通过 `provider.scrapePage()` 完成爬取，从 ~160 行缩减至 ~30 行

### `src/app/api/search/route.ts`

- **改动**：POST 请求从请求体中解析 `siteId` 参数并传递给 `engine.search(keywords, siteId)`

### `src/types/index.ts`

- **新增**：`SearchJob` 接口增加 `siteId: string` 字段

---


---

## 接口设计 — SiteProvider

### SiteProvider 接口

```typescript
interface SiteProvider extends SiteConfig {
  // 搜索
  buildSearchUrl(keyword: string): string;
  extractSearchResults(page: Page): Promise<SiteSearchResult[]>;

  // 爬取
  extractMetadata(page: Page): Promise<{ title: string; tags: string[]; actors: string[] }>;
  cleanTitle(rawTitle: string): string;
  scrapePage(page: Page, pageUrl: string): Promise<ScrapeResult>;

  // 配置
  readonly playButtonSelectors: string[];
  readonly m3u8ExcludePatterns: string[];

  // 匹配
  matchesUrl(url: string): boolean;
}
```

### BaseSiteProvider 抽象基类

提供以下通用方法的完整实现：

| 方法 | 说明 |
|---|---|
| `extractSearchResults(page)` | 使用通用 MacCMS 选择器遍历 DOM，过滤出视频详情页链接 |
| `extractMetadata(page)` | 提取标题（document.title / OG title）、标签（meta keywords / DOM）、演员（JSON-LD / DOM / 正则） |
| `clickPlayButton(page)` | 遍历播放按钮选择器，点击第一个可见的按钮 |
| `scanJsForM3U8(page)` | 扫描页面 `<script>` 标签中的 M3U8 URL |
| `selectBestM3U8(urls)` | 去重并按高分辨率优先排序 |
| `setupM3U8Interceptor(page, captured)` | 设置网络请求拦截器，捕获 .m3u8 请求 |
| `scrapePage(page, pageUrl)` | 完整爬取流程编排（拦截器 → 元信息 → 点击 → 扫描 → 选优） |

子类只需实现 3 个抽象方法：`buildSearchUrl()`、`cleanTitle()`、`matchesUrl()`。

---


---

## 未来扩展指南

### 添加新站点

添加新站点只需 3 步：

```typescript
// 1. 创建 Provider 类（继承 BaseSiteProvider）
// src/lib/sites/providers/xxx-provider.ts
import { BaseSiteProvider } from '../base-provider';

export class XxxProvider extends BaseSiteProvider {
  readonly id = 'xxx';
  readonly name = 'XXX';
  readonly baseUrl = 'https://xxx.com';
  readonly enabled = true;

  buildSearchUrl(keyword: string): string {
    return `${this.baseUrl}/search?q=${encodeURIComponent(keyword)}`;
  }

  cleanTitle(rawTitle: string): string {
    // 站点特有标题清洗逻辑
    return rawTitle.trim();
  }

  matchesUrl(url: string): boolean {
    try {
      return new URL(url).hostname.includes('xxx.com');
    } catch {
      return false;
    }
  }
}

// 2. 在 site-registry.ts 中注册
import { XxxProvider } from './providers/xxx-provider';
function registerDefaultProviders(registry: SiteRegistry): void {
  registry.register(new KanavProvider());
  registry.register(new XxxProvider());  // ← 新增
}

// 3. 完成！前端站点选择器自动显示新站点
```

---
