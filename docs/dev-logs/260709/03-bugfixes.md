# 开发日志 — 2026-07-09 — Bug 修复记录（Bug 1-6）

## Bug 修复记录

### Bug 1: `super` 在类字段初始化器中无效

**现象**：`/api/sites` 首次请求返回 500 错误，后续请求返回空数组 `[]`。

**根因**：`KanavProvider` 中使用了类字段初始化器访问 `super`：

```typescript
// 错误写法 — super 在字段初始化器中访问的是原型链，而非实例
readonly searchResultSelectors = [
  ...super.searchResultSelectors,  // ← 返回 undefined
];
```

TypeScript 类字段是**实例属性**，在字段初始化器中 `super.xxx` 访问的是原型链上的 getter/属性，而基类的 `searchResultSelectors` 也是实例属性（不在原型链上），因此返回 `undefined`，导致 `[...undefined]` 抛出 `TypeError`。

**修复**：移除 `KanavProvider` 中的 `searchResultSelectors` 覆写，直接使用基类默认值。如需添加站点特有选择器，在构造函数中操作。

### Bug 2: 单例模式缺陷

**现象**：即使修复 Bug 1，首次 500 错误后注册中心仍为空。

**根因**：`getSiteRegistry()` 原始实现：

```typescript
// 错误写法 — 先赋值单例，再注册
registryInstance = new SiteRegistry();
registerDefaultProviders(registryInstance);  // ← 如果此处出错，单例已是空的
```

注册过程中如果抛出异常，`registryInstance` 已被赋值为一个空的注册中心，后续调用直接返回这个空单例，永远不会重试注册。

**修复**：先完成注册，再赋值单例：

```typescript
const registry = new SiteRegistry();
registerDefaultProviders(registry);
registryInstance = registry;  // ← 注册成功后才赋值
```

### Bug 3: `setupM3U8Interceptor` 返回类型不匹配

**现象**：Linter 报错 `Type 'Promise<Disposable>' is not assignable to type 'Promise<void>'`。

**根因**：`page.route()` 返回 `Promise<Disposable>`，而方法声明返回 `Promise<void>`。

**修复**：将方法改为 `async` 并使用 `await`：

```typescript
async setupM3U8Interceptor(page: Page, captured: string[]): Promise<void> {
  await page.route('**/*', (route) => { ... });
}
```

### Bug 4: WebSocket 断连 — `connect()` 未被调用

**现象**：状态栏永远显示"后端未连接"，但后端 WebSocket 服务正常运行。

**根因**：`StatusBar` 组件读取了 `connected` 状态，但**没有任何组件调用 `socketStore.connect()`**，导致 Socket.IO 客户端从未初始化。

**初次修复**：在 `StatusBar` 组件的 `useEffect` 中调用 `connect()`，卸载时调用 `disconnect()`。

**遗留问题**：StatusBar 被移除后，连接初始化逻辑声称迁移至 `task-store.ts` 的 `subscribeToSocket()` 中，但 `subscribeToSocket()` 仅读取 `useSocketStore.getState().socket`（此时为 `null`），**从未调用 `connect()`**。该问题在第五轮迭代中彻底修复（见 [Bug 7](#bug-7-websocket-connect-从未被调用)）。

### Bug 5: WebSocket 无自动重连机制

**现象**：网络波动或服务器重启后，WebSocket 连接断开且永不重连。

**根因**：`socket-store.ts` 未配置 `reconnection` 参数，也未监听 `reconnect_attempt`、`reconnect_error`、`connect_error` 等事件。

**修复**：
- 配置 `reconnection: true`，重连间隔 1s → 5s 指数退避
- 监听所有重连事件，新增 `reconnecting` 状态
- 处理 `io server disconnect`（服务端主动断开）时手动重连
- 旧 socket 清理：重连前 `removeAllListeners()` + `disconnect()`

### Bug 6: 任务列表不接收实时进度

**现象**：下载任务进度条不实时更新，需手动刷新页面。

**根因**：`task-store.ts` 完全不监听 WebSocket `progress` 事件，服务端推送的下载进度无法到达前端。

**初次修复**：新增 `subscribeToSocket()` 方法，监听 `progress` 事件并实时更新对应任务的进度和状态。

**遗留问题**：服务端进度回调仅通过 `eventBus.emit('task:progress', ...)` 发射事件，经 Socket.IO 桥接后前端收到的事件名为 `'task:progress'`，但客户端监听的是 `'progress'`。已存在的 `broadcastProgress()` 函数（发出 `'progress'` 事件）**从未被调用**。该问题在第五轮迭代中彻底修复（见 [Bug 8](#bug-8-websocket-事件名称不匹配)）。

---
