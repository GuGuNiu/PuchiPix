# 代码审计与批量修复

## 概述

基于对 `260712/` 全部开发日志的反向排查，对相关源代码进行了系统性审计，发现并修复了 14 个问题，覆盖安全性、逻辑缺陷、性能优化和代码质量四个维度。

## 修复清单

### P0 — 安全性（紧急）

#### 1. RAR 解压路径遍历漏洞

**文件**: `src/lib/downloader/zip-downloader.ts`

**问题**: `extractRar` 直接使用 RAR 文件头中的 `fileName` 拼接解压路径，未做路径净化。恶意 RAR 包含 `../../etc/passwd` 之类条目时，解压会写到预期目录之外。

**修复**: 新增 `isSafeExtractPath` 函数，通过 `path.resolve` + `startsWith(base + path.sep)` 校验目标路径是否在解压目录内。抽取 `writeRarFile` 统一处理文件写出和路径校验，密码解压和无密码解压两处复用同一函数。

```typescript
function isSafeExtractPath(destPath: string, extractBase: string): boolean {
  const resolvedDest = path.resolve(destPath);
  const resolvedBase = path.resolve(extractBase);
  return resolvedDest === resolvedBase || resolvedDest.startsWith(resolvedBase + path.sep);
}
```

#### 2. 代理 API 路径检查不严格

**文件**: `src/app/api/proxy/route.ts`

**问题**: `startsWith(dataDir)` 检查存在边界问题——`data_backup` 等以 `data` 开头的目录也能通过检查。

**修复**: 改用 `path.relative` + `startsWith('..')` 判断：

```typescript
const relative = path.relative(dataDir, resolvedPath);
if (relative.startsWith('..') || path.isAbsolute(relative)) {
  return NextResponse.json({ error: 'Access denied' }, { status: 403 });
}
```

---

### P1 — 逻辑缺陷（重要）

#### 3. OUO 编排器 IP 限速冷却期不可中断

**文件**: `src/lib/core/ouo-orchestrator.ts`

**问题**: `handleRateLimit` 使用 `await sleep(cooldownMs)` 直接休眠 10~15 分钟，期间无法响应暂停或停止操作。

**修复**: 替换为 `this.interruptibleSleep(cooldownMs)`，每 5 秒检查运行状态。

#### 4. OUO 编排器 stop() 等待时间不一致

**文件**: `src/lib/core/ouo-orchestrator.ts`

**问题**: `server.ts` 声明 `timeout: 15000`，但 `stop()` 中只等待 5000ms，导致编排器可能在 shutdown 超时前就被强制终止。

**修复**: 等待时间从 5000 改为 15000，与 `server.ts` 一致。

#### 5. OUO 编排器 processedCount 对限速任务计数膨胀

**文件**: `src/lib/core/ouo-orchestrator.ts`

**问题**: `processTask` 的 `finally` 块无条件递增 `processedCount`，但限速任务被重新入队后还会再次处理，导致计数膨胀，提前触发短/长周期休息。

**修复**: `finally` 中检查 `task.status !== 'rate_limited'` 时才计数。

#### 6. task-store removeTask 未使用复合键

**文件**: `src/store/task-store.ts`、`src/app/tasks/page.tsx`

**问题**: `removeTask(id)` 仅按 `t.ID !== id` 过滤，视频任务和图库任务使用自增 ID 可能重叠，删除一个会误删另一个。

**修复**: `removeTask` 新增可选 `taskType` 参数，传入时使用复合键 `${taskType}-${id}` 精确匹配。调用方 `tasks/page.tsx` 传入 `isGallery ? 'gallery' : 'video'`。

---

### P2 — 性能优化（一般）

#### 7. SSE 缺少任务删除事件推送

**文件**: `src/lib/core/event-bus.ts`、`src/app/api/tasks/stream/route.ts`、`src/app/api/tasks/[id]/route.ts`、`src/app/api/gallery/[id]/route.ts`

**问题**: 前端 store 已监听 `delete` 事件，但 SSE 端点中无任何 EventBus 订阅会触发 `send('delete', ...)`。删除任务后其他连接的客户端不会收到通知。

**修复**:
- EventBus 新增 `task:deleted` 和 `gallery:deleted` 事件
- tasks/[id] DELETE 路由和 gallery/[id] DELETE 路由在删除后 emit 对应事件
- SSE stream route 订阅这两个事件，推送 `delete` 消息到前端

#### 8. ouoCache 过期条目永不清理

**文件**: `src/lib/downloader/zip-downloader.ts`

**问题**: `ouoCache` Map 的过期条目仅在被访问时跳过，但永不从 Map 中删除。长时间运行后 Map 持续增长。

**修复**: 新增 `cleanExpiredOuoCache` 函数，在每次缓存访问前清理过期条目，并限制最大条目数 50，超出时按过期时间排序淘汰。

#### 9. 图库下载器逐文件更新数据库

**文件**: `src/lib/downloader/gallery-downloader.ts`

**问题**: 每下载完一张图片就执行 `prisma.gallery.update({ data: { downloadedSize } })`，50 张图片 = 50 次数据库写入。

**修复**: 改为每 5 张或最后一张时批量更新：`completedFiles % 5 === 0 || completedFiles === totalFiles`。图片和视频两处均修改。

#### 10. 重定向无深度限制

**文件**: `src/lib/downloader/zip-downloader.ts`

**问题**: `downloadCoverImage` 和 `downloadFile` 在处理重定向时递归调用自身，无深度限制。恶意服务器循环重定向会导致栈溢出。

**修复**: 两个函数均新增 `redirects` 参数（默认 0），超过 `MAX_REDIRECTS_COVER`（5）或 `MAX_REDIRECTS_DOWNLOAD`（5）时终止并返回失败。

---

### P3 — 代码质量（低）

#### 11. CJK_ROMAN_MAP 重复键

**文件**: `src/lib/downloader/gallery-content-verifier.ts`

**问题**: `'妹'` 键在映射表中出现两次（第 71 行和第 83 行）。

**修复**: 删除第 83 行的重复条目。

#### 12. 图库页面注释过时

**文件**: `src/app/gallery/page.tsx`

**问题**: 注释仍写 "WebSocket 实时进度更新"，但系统已迁移到 SSE。

**修复**: 改为 "SSE 实时进度更新"，更新 `@lastModified`。

#### 13. SSE stream route 缩进不一致

**文件**: `src/app/api/tasks/stream/route.ts`

**问题**: `mapGalleryStatus` 函数的 `switch` 语句缩进风格不统一。

**修复**: 统一为标准 2 空格缩进。

#### 14. parallel-downloader 单线程降级超时时 writeStream 未清理

**文件**: `src/lib/downloader/parallel-downloader.ts`

**问题**: `singleThreadDownload` 超时处理中调用 `finish()` 但未关闭 `writeStream`，可能导致文件描述符泄漏。

**修复**: 超时时调用 `writeStream.destroy()` 清理资源。

---

## 修改文件清单

| 文件 | 优先级 | 修复内容 |
|------|--------|---------|
| `src/lib/downloader/zip-downloader.ts` | P0+P2 | RAR 路径遍历防护；ouoCache 过期清理；downloadCoverImage/downloadFile 重定向深度限制 |
| `src/app/api/proxy/route.ts` | P0 | 路径遍历检查改用 path.relative |
| `src/lib/core/ouo-orchestrator.ts` | P1 | 冷却期可中断；stop 等待 15s；限速任务不计数 |
| `src/store/task-store.ts` | P1 | removeTask 支持复合键 |
| `src/app/tasks/page.tsx` | P1 | 调用 removeTask 传入 taskType |
| `src/lib/core/event-bus.ts` | P2 | 新增 task:deleted 和 gallery:deleted 事件 |
| `src/app/api/tasks/stream/route.ts` | P2+P3 | 订阅 delete 事件推送；修复缩进 |
| `src/app/api/tasks/[id]/route.ts` | P2 | DELETE 后 emit task:deleted |
| `src/app/api/gallery/[id]/route.ts` | P2 | DELETE 后 emit gallery:deleted |
| `src/lib/downloader/gallery-downloader.ts` | P2 | 数据库写入改为每 5 张批量更新 |
| `src/lib/downloader/gallery-content-verifier.ts` | P3 | 删除重复的 '妹' 键 |
| `src/lib/downloader/parallel-downloader.ts` | P3 | 超时时清理 writeStream |
| `src/app/gallery/page.tsx` | P3 | 更新过时注释 |

---

## 验证结果

| 验证项 | 状态 |
|--------|------|
| Lint 检查 | ✅ 无错误 |
| TypeScript 类型安全 | ✅ 无新增类型错误 |
| 复合键 removeTask 向后兼容 | ✅ taskType 为可选参数，旧调用方不受影响 |

---

## 时间戳

- 审计与修复: 2026-07-12
- 作者: PuchiPix Team
