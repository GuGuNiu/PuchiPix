# 开发日志 — 2026-07-11 — 功能六：站点模块顶层配置 — 徽章配色 + 中英文名 + 站点类型

## 功能六：站点模块顶层配置 — 徽章配色 + 中英文名 + 站点类型

### 问题背景

爱妹子模块缺少模块级别的展示配置（如分类配色、中英文名、站点类型），Provider 类中硬编码了 `name`、`baseUrl` 等展示信息，且没有统一的徽章配色方案。各前端页面（搜索、任务列表）中站点来源标识不统一，KanAV 和爱妹子的徽章均使用默认样式，无法通过配色区分站点。

### 设计目标

创建一个专属顶层的模块配置文件，集中管理每个模块的：
- 中文名（如"爱妹子"）
- 英文名（如"Aimeizizi"）
- 站点 URL（如 `https://xx.knit.bid`）
- 显示徽章配色（渐变色 + 实色 + 文字色）
- 站点类型（写真站 / 视频站）

### 配色方案

| 站点 | 类型 | 渐变色 | 实色 | 文字色 |
|------|------|--------|------|--------|
| KanAV | 视频站 | `linear-gradient(135deg, #3b82f6, #2563eb)` | `#2563eb` | `#ffffff` |
| 爱妹子 | 写真站 | `linear-gradient(135deg, #e91e63, #f8bbd0)` | `#e91e63` | `#ffffff` |

- KanAV：蓝色系，与其视频站定位一致
- 爱妹子：玫红色 + 粉红色渐变，与其写真站定位一致

### 实现内容

#### 6.1 新建 `src/lib/sites/site-modules.ts`

顶层模块配置文件，集中管理所有站点的展示元信息：

```typescript
// 类型定义
export type SiteType = 'photo' | 'video';
export interface BadgeTheme { gradient, solidColor, textColor }
export interface SiteModuleConfig { id, nameCn, nameEn, baseUrl, type, badge, enabled }

// 站点注册表（使用 satisfies 确保类型安全）
export const SITE_MODULES = {
  kanav:     { ... type: 'video', badge: { gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)', ... } },
  aimeizizi: { ... type: 'photo', badge: { gradient: 'linear-gradient(135deg, #e91e63, #f8bbd0)', ... } },
} as const satisfies Record<string, SiteModuleConfig>;

// 辅助
export const ALL_SITE_MODULES     — 所有模块配置数组
export const ENABLED_SITE_MODULES — 已启用的模块配置数组
export function getSiteModule(id)  — 按 ID 获取配置
```

#### 6.2 扩展 `src/lib/sites/types.ts` 中的 `SiteInfo` 接口

新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `nameCn` | `string` | 中文名 |
| `nameEn` | `string` | 英文名 |
| `type` | `SiteType` | 站点类型：photo / video |
| `badge` | `BadgeTheme` | 徽章配色方案 |

保留 `name` 字段（等于 `nameCn`）向后兼容。

#### 6.3 更新 `src/lib/sites/site-registry.ts`

- `getSiteInfos()`：合并 Provider 运行时信息与 `site-modules.ts` 中的展示元信息
- `getEnabledSiteInfos()`：简化为 `getSiteInfos().filter(enabled)`
- `registerDefaultProviders()`：改为遍历 `ALL_SITE_MODULES` 注册，新增站点只需在 `site-modules.ts` 中添加配置

#### 6.4 更新 `src/lib/sites/index.ts`

导出 `SITE_MODULES`、`ALL_SITE_MODULES`、`ENABLED_SITE_MODULES`、`getSiteModule`、`SiteModuleConfig`、`SiteType`、`BadgeTheme`。

### 前端集成

#### 6.5 搜索页面（`src/app/search/page.tsx`）

- 站点选择 pill 选中时使用站点专属渐变色（`site.badge.gradient`）
- 最近搜索表格中站点名使用站点配色徽章
- 文案区分"图库"和"视频"

#### 6.6 任务列表页面（`src/app/tasks/page.tsx`）

**修复前**：来源列硬编码 `if (srcUrl.includes("kanav")) sourceName = "KanAV"`，爱妹子显示"—"

**修复后**：通过 URL hostname 匹配站点配置，渲染站点专属配色徽章

#### 6.7 批量搜索面板（`src/components/tasks/batch-search-panel.tsx`）

同步 `SiteInfo` 接口，站点下拉选项显示中文名。

### Bug 修复：Runtime TypeError + 徽章不显示

#### 问题 1：`Cannot read properties of undefined (reading 'gradient')`

**原因**：Next.js dev 模式下 `globalThis.__siteRegistryInstance__` 是旧代码创建的单例，热重载不会清除它，导致 `/api/sites` 返回的数据缺少 `badge`、`nameCn` 等新字段。

**修复**：加防御性检查 `site?.badge`。

#### 问题 2：KanAV 和爱妹子徽章都不显示

**原因**：API 返回的 `sites` 数据始终缺少 `badge` 字段（dev 单例缓存问题），防御性检查导致所有站点都走 `—` 分支。

**最终方案**：三个客户端组件不再通过 `/api/sites` 获取站点信息，而是直接导入 `@/lib/sites/site-modules` 中的 `ENABLED_SITE_MODULES`（纯配置文件，无 playwright 等服务端依赖），在编译时就拿到完整的徽章配色信息。

```typescript
// 修复前 — 运行时从 API 获取（dev 模式下可能拿到旧格式数据）
const [sites, setSites] = useState<SiteInfo[]>([]);
useEffect(() => {
  fetch("/api/sites").then(r => r.json()).then(setSites);
}, []);

// 修复后 — 编译时直接导入纯配置
import { ENABLED_SITE_MODULES } from "@/lib/sites/site-modules";
const SITES = ENABLED_SITE_MODULES.map((m) => ({
  ...m,
  name: m.nameCn,
  gallery: m.type === 'photo',
}));
```

### 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/sites/site-modules.ts` | 新增 | 顶层模块配置文件，管理所有站点的展示元信息 |
| `src/lib/sites/types.ts` | 修改 | `SiteInfo` 新增 `nameCn`、`nameEn`、`type`、`badge` 字段；新增 `SiteType`、`BadgeTheme` 类型 |
| `src/lib/sites/site-registry.ts` | 修改 | `getSiteInfos` 合并展示配置；`registerDefaultProviders` 遍历 `ALL_SITE_MODULES` |
| `src/lib/sites/index.ts` | 修改 | 导出新模块和类型 |
| `src/app/search/page.tsx` | 修改 | 站点 pill 使用渐变色；最近搜索徽章使用站点配色；改为直接导入配置 |
| `src/app/tasks/page.tsx` | 修改 | 来源列从硬编码改为动态匹配站点配色；改为直接导入配置 |
| `src/components/tasks/batch-search-panel.tsx` | 修改 | 同步接口；改为直接导入配置 |

### 验证结果

- TypeScript 编译：0 错误
- ESLint：0 错误

### 架构图（修复后）

```
                    site-modules.ts (顶层配置)
                    ┌──────────────────────────┐
                    │ SITE_MODULES              │
                    │  ├── kanav     (video)    │
                    │  │   badge: 蓝色渐变       │
                    │  └── aimeizizi (photo)    │
                    │      badge: 玫红+粉色渐变  │
                    └───────────┬──────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
              ▼                 ▼                  ▼
     site-registry.ts    search/page.tsx    tasks/page.tsx
     (服务端：合并         (客户端：直接       (客户端：直接
      Provider + 配置)     导入配置)           导入配置)
              │                 │                  │
              ▼                 ▼                  ▼
        /api/sites         站点 pill 渐变     来源列徽章渐变
        (含 badge 字段)     最近搜索徽章
```

### 新增站点流程

新增站点时只需两步：

1. 在 `site-modules.ts` 中添加一条 `SITE_MODULES` 记录（中英文名、URL、类型、配色）
2. 在 `site-registry.ts` 的 `registerDefaultProviders` 中注册对应 Provider

前端展示信息自动从配置中获取，无需修改任何前端代码。

---
