# 开发日志 — 2026-07-10 — 路由状态保持修复

## 路由状态保持修复

### 问题背景

在搜索页和任务页之间切换时，之前保存的页面状态（筛选条件、搜索关键词、展开的任务详情等）丢失，每次返回页面都回到初始状态。

### 根因分析

`src/lib/core/route-state.ts` 中的 `useRouteState` Hook 在组件卸载时的 cleanup 函数中调用了：

```typescript
routeStateInstance.save(routeKey, {}, scrollRef.current);
```

第二个参数传入了空对象 `{}`，直接覆盖了之前通过 `saveState()` 保存的所有数据。这意味着每次离开页面时，之前保存的筛选条件、搜索关键词等全部被清空。

### 修复方案

修改 cleanup 逻辑，先读取已有的状态数据，仅更新滚动位置，保留已有数据：

```typescript
// 修改前（覆盖数据）
routeStateInstance.save(routeKey, {}, scrollRef.current);

// 修改后（保留数据，仅更新滚动位置）
const existing = routeStateInstance.load(routeKey, ttl);
routeStateInstance.save(routeKey, existing?.data ?? {}, scrollRef.current);
```

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/lib/core/route-state.ts` | cleanup 函数中先 `load` 已有数据再 `save`，避免覆盖 |

---
