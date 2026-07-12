# 开发日志 — 2026-07-10 — 倍速预览播放修复

## 倍速预览播放修复

### 问题背景

搜索页视频卡片悬浮预览在客户端路由导航后无法播放视频。首次加载页面正常，但从其他页面（如任务页）导航回搜索页后，HLS.js 不可用。

### 根因分析

`src/app/layout.tsx` 中 HLS.js 通过 `<script src="/vendor/hls.min.js" defer>` 加载。`defer` 脚本在页面首次加载时能保证 DOM 解析完成后执行，但 Next.js 客户端路由导航（`next/link` 或 `router.push`）不会重新加载 `<script>` 标签——`layout.tsx` 的 `<head>` 只在初始 HTML 加载时执行一次。

问题在于：如果用户在脚本加载完成前导航到搜索页，`window.Hls` 可能为 `undefined`，导致 `playM3U8` 直接进入错误分支。

### 修复方案

**两步修复：**

1. **`defer` → `async`**：在 `layout.tsx` 中将 HLS.js 脚本加载方式从 `defer` 改为 `async`，使其在下载完成后立即执行，不等待 DOM 解析完成，缩短可用时间窗口。

2. **`waitForHls` 轮询等待**：在 `video-card.tsx` 中新增 `waitForHls()` 函数，在 `playM3U8` 调用 HLS.js 之前轮询检查 `window.Hls` 是否可用（最多等待 3 秒，每 100ms 检查一次）。

```typescript
function waitForHls(): Promise<typeof window.Hls | null> {
  return new Promise((resolve) => {
    if (window.Hls) {
      resolve(window.Hls);
      return;
    }
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 100;
      if (window.Hls) {
        clearInterval(interval);
        resolve(window.Hls);
      } else if (elapsed >= 3000) {
        clearInterval(interval);
        resolve(null);
      }
    }, 100);
  });
}
```

`playM3U8` 改为 `async` 函数，在 HLS.js 分支中 `await waitForHls()` 后再检查 `isSupported()`。`handleMouseEnter` 中的防抖回调也改为 `async` 以 `await playM3U8()`。

3. **Google Fonts 优化**：添加 `preconnect` 和 `dns-prefetch` 提示，加速字体加载。

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/app/layout.tsx` | `defer` → `async`；新增 `preconnect` / `dns-prefetch` |
| `src/components/search/video-card.tsx` | 新增 `waitForHls()` 函数；`playM3U8` 改为 `async` + `await waitForHls()`；`handleMouseEnter` 改为 `async` |

---
