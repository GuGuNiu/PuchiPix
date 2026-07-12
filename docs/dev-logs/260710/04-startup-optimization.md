# 开发日志 — 2026-07-10 — 项目启动速度优化

## 项目启动速度优化

### 问题背景

项目启动时所有初始化任务串行执行，且 `DownloadManager` 在启动时即被同步导入和初始化，阻塞了 HTTP 服务器的监听。

### 优化措施

1. **延迟导入 DownloadManager**：在 `server.ts` 的 init hook 中使用 `await import('./src/lib/api-helpers')` 动态导入，避免在模块加载阶段就拉入下载管理器的全部依赖。

2. **init hooks 并行化**：Socket.IO 初始化、DownloadManager 初始化、EventBus 桥接三个 init hook 独立注册，由 `LifecycleManager` 管理执行顺序。Socket.IO 不依赖 DownloadManager，EventBus 桥接不依赖前两者。

3. **路由预热**：服务启动后，使用 `Promise.all` 并行预编译 9 个常用路由（`/api/health`、`/api/stats`、`/api/sites`、`/api/tasks`、`/api/history`、`/`、`/tasks`、`/search`、`/history`），避免用户首次访问时的编译延迟。

### 修改文件

| 文件 | 变更 |
|------|------|
| `server.ts` | `download-manager` init hook 使用 `await import()` 延迟加载；路由预热使用 `Promise.all` 并行化 |

---
