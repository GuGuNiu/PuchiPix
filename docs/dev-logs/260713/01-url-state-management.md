# URL 路由状态管理

## 1. 概述

项目此前页面状态（筛选、搜索、排序、展开项）仅通过 `useRouteState` Hook 保存在 `sessionStorage` 中，浏览器地址栏无法反映当前页面状态。本次改造将关键 UI 状态同步到 URL 查询参数，实现地址栏可见、可分享、可书签、刷新可恢复。

| 维度 | 旧方案 (sessionStorage) | 新方案 (URL 查询参数) |
|------|------------------------|---------------------|
| 地址栏可见 | ❌ 仅 `/tasks` | ✅ `/tasks?status=failed&q=abc` |
| 刷新恢复 | ✅ TTL 5 分钟内 | ✅ 永久 |
| 分享链接 | ❌ 无法分享状态 | ✅ 复制 URL 即可 |
| 浏览器前进/后退 | ❌ 不保留状态 | ✅ 自动保留 |
| 书签 | ❌ 仅记页面 | ✅ 含完整筛选状态 |
| 滚动位置 | ✅ sessionStorage | ✅ 仍保留（useRouteState） |

---

## 2. 新增 Hook — `src/hooks/use-url-state.ts`

### 2.1 `useUrlState`

适用于低频更新的状态（筛选器、排序、展开项）。每次更新直接 `router.replace` 即时反映在地址栏。

```typescript
const { values, update } = useUrlState({
  status: "all",
  sort: "date_desc",
  task: "",
});

// 读取
const statusFilter = values.status; // "failed"

// 更新（值为默认值或 null 时自动从 URL 移除）
update({ status: "failed" });     // → /tasks?status=failed
update({ status: "all" });        // → /tasks（all 是默认值，移除参数）
update({ task: null });           // → 移除 task 参数
```

**设计要点**：
- 值等于默认值时自动从 URL 移除参数，保持地址栏简洁
- 使用 `useRef` 持有 `defaults` 和 `searchParams`，避免闭包陈旧引用
- `router.replace` + `scroll: false` 避免页面跳动

### 2.2 `useDebouncedUrlParam`

适用于搜索输入框等高频更新场景。本地状态立即更新（无输入延迟），URL 同步延迟 300ms（避免频繁 `router.replace`）。

```typescript
const [searchQuery, setSearchQuery] = useDebouncedUrlParam("q", "");

// 输入 "abc" → 本地立即变 "abc"
// 300ms 后 URL 变为 /tasks?q=abc
```

**设计要点**：
- 双向同步：本地 → URL（防抖），URL → 本地（即时，处理浏览器前进/后退）
- 防抖期间若本地值已与 URL 一致则跳过更新，避免冗余路由

---

## 3. 任务管理页面改造（`src/app/tasks/page.tsx`）

### 3.1 URL 参数映射

| 状态 | URL 参数 | 默认值 | 说明 |
|------|----------|--------|------|
| 状态筛选 | `status` | `all` | `all` 不出现在 URL |
| 搜索关键词 | `q` | `""` | 300ms 防抖同步 |
| 排序方式 | `sort` | `date_desc` | 默认值不出现在 URL |
| 展开任务 | `task` | `""` | 任务 ID，关闭时移除 |

**示例 URL**：`/tasks?status=failed&q=error&sort=date_asc&task=123`

### 3.2 状态管理变更

```
旧: useState + savedData 初始化 + saveState 持久化
新: useUrlState 读取 + updateUrl 更新 + useDebouncedUrlParam 搜索
```

保留 `useRouteState` 用于：
- 滚动位置恢复
- `addTab`（添加任务弹窗标签页，弹窗内部状态不需要 URL 化）

### 3.3 关键改动

- `expandedTask` 从 `useState<number | null>` 改为从 URL `task` 参数解析
- `toggleExpand` 改为通过 `setExpandedTask` 更新 URL
- `statusFilter`、`sortBy` 改为从 `urlValues` 派生，setter 通过 `updateUrl` 更新

---

## 4. 图包管理页面改造（`src/app/gallery/page.tsx`）

### 4.1 URL 参数映射

| 状态 | URL 参数 | 默认值 | 说明 |
|------|----------|--------|------|
| 状态筛选 | `status` | `all` | 同任务页 |
| 搜索关键词 | `q` | `""` | 300ms 防抖同步 |
| 排序方式 | `sort` | `date_desc` | 同任务页 |
| 展开图包 | `id` | `""` | 图包 ID，关闭时移除 |

**示例 URL**：`/gallery?status=completed&sort=images_desc&id=456`

### 4.2 详情加载优化

将详情数据加载从 `handleExpand` 回调移到 `useEffect`，监听 `expandedId` 变化自动触发：

```typescript
useEffect(() => {
  if (expandedId === null) return;
  setDetailLoading(true);
  fetchGalleryDetail(expandedId).finally(() => setDetailLoading(false));
}, [expandedId, fetchGalleryDetail]);
```

**原因**：此前详情加载与点击事件耦合，通过 URL 直接访问（如刷新 `?id=456`）不会触发加载。改为 `useEffect` 后，无论是用户点击还是 URL 直接加载，都能正确获取详情数据。

### 4.3 其他修复

- `pathname` 从 `window.location.pathname` 改为 `usePathname()`，确保 SSR 安全
- `useRouteState` 不再需要 `savedData` 和 `saveState`（仅保留滚动位置功能）

---

## 5. 搜索页面改造（`src/app/search/page.tsx`）

### 5.1 URL 参数映射

| 状态 | URL 参数 | 默认值 | 说明 |
|------|----------|--------|------|
| 搜索关键词 | `q` | `""` | 提交搜索时更新（非每次按键） |
| 站点选择 | `site` | `kanav` | 默认值不出现在 URL |
| 搜索任务 ID | `job` | `""` | 用于轮询进度，刷新可恢复 |

**示例 URL**：`/search?q=测试&site=kanav&job=abc123`

### 5.2 设计决策

搜索关键词使用 `useUrlState`（非 `useDebouncedUrlParam`），因为：
- 搜索页的 `keywords` 是搜索条件，不是实时过滤
- 仅在点击"搜索"按钮提交时才更新 URL
- 但需要处理 URL 变化时同步到本地输入框（浏览器前进/后退）

通过 `useEffect` 监听 `urlValues.q` 变化同步到本地 `keywords` 状态：

```typescript
const [keywords, setKeywords] = useState(urlValues.q);
useEffect(() => {
  setKeywords(urlValues.q);
}, [urlValues.q]);
```

### 5.3 搜索任务恢复

`activeJobId` 从 URL `job` 参数读取，刷新页面后自动恢复搜索任务轮询。此前仅保存在 `sessionStorage`，TTL 过期后无法恢复。

---

## 6. 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/hooks/use-url-state.ts` | 新建 | `useUrlState` + `useDebouncedUrlParam` Hook |
| `src/hooks/index.ts` | 修改 | 导出新 Hook |
| `src/app/tasks/page.tsx` | 修改 | 筛选/排序/搜索/展开迁移到 URL 参数 |
| `src/app/gallery/page.tsx` | 修改 | 同上 + 详情加载改用 useEffect |
| `src/app/search/page.tsx` | 修改 | 关键词/站点/任务 ID 迁移到 URL 参数 |

---

## 7. 验证结果

| 验证项 | 状态 |
|--------|------|
| Lint 检查 | ✅ 无错误 |
| TypeScript 类型安全 | ✅ 无新增类型错误 |
| 地址栏状态可见 | ✅ 筛选/搜索/排序/展开均反映在 URL |
| 刷新恢复 | ✅ 所有状态完整恢复 |
| 浏览器前进/后退 | ✅ 状态正确切换 |
| 滚动位置恢复 | ✅ useRouteState 仍正常工作 |

---

## 8. 架构关系

```
URL 查询参数 (useUrlState / useDebouncedUrlParam)
  ├── 筛选/排序/展开 → 即时同步，地址栏可见
  └── 搜索输入 → 防抖同步，无输入延迟

sessionStorage (useRouteState)
  ├── 滚动位置 → 返回页面时恢复
  └── 弹窗内部状态 → 不需要 URL 化的临时状态
```

两种机制互补：URL 参数处理"用户可感知的页面状态"，`sessionStorage` 处理"UX 层面的恢复"。

---

*2026-07-13*
