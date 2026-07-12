# 开发日志 — 2026-07-11 — 功能七：图库前端适配 — 图库页面 + 任务管理 + 历史记录 + 侧边栏

## 功能七：图库前端适配 — 图库页面 + 任务管理 + 历史记录 + 侧边栏

### 问题背景

功能五修复了爱妹子模块的后端下载算法（图片 URL 解析、M3U8 视频下载、任务路由），但前端完全未适配图库模块的特殊性：

1. **任务管理页面**：表格列（分片、文件大小）和详情面板（M3U8 链接、视频标题、演员、导演）完全以 M3U8 视频为中心，无法展示图库的图片/视频数量、主角、描述等信息。
2. **无图库页面**：后端已有完整的图库 API（`GET/POST /api/gallery`、`GET/DELETE /api/gallery/[id]`、`POST /api/gallery/[id]/download`），但前端无对应页面消费这些 API。
3. **任务创建反馈缺失**：`POST /api/tasks` 对图库 URL 返回 `{ type: 'gallery', galleryId, ... }` 格式，但 `handleAdd` 直接当作 `DownloadTask` 处理，不解析 `type` 字段，用户无法得知图库已创建。
4. **历史页面**：仅展示 `DownloadTask` 记录，图库下载记录完全不可见。
5. **侧边栏**：无图库导航入口。

### 解决方案

#### 7.1 新建 `src/store/gallery-store.ts` — 图库状态管理

使用 Zustand 创建图库 Store，管理图库列表数据和 WebSocket 实时进度：

```typescript
interface GalleryStore {
  galleries: GalleryData[];
  loading: boolean;
  progressMap: Record<number, GalleryProgress>; // galleryId → 实时进度
  fetchGalleries: () => Promise<void>;
  fetchGalleryDetail: (id: number) => Promise<GalleryData | null>;
  deleteGallery: (id: number) => Promise<boolean>;
  retryDownload: (id: number) => Promise<boolean>;
  subscribeToSocket: () => () => void;  // 监听 gallery:* 事件
}
```

WebSocket 事件订阅（通过 EventBus 桥接自动到达前端）：

| 事件 | 处理逻辑 |
|------|---------|
| `gallery:scrapeCompleted` | 触发列表刷新 |
| `gallery:scrapeFailed` | 更新图库状态为 `failed` |
| `gallery:downloadStarted` | 设置进度为 0/total，状态改为 `downloading` |
| `gallery:downloadProgress` | 更新 `progressMap[galleryId]` |
| `gallery:downloadCompleted` | 触发列表刷新 |
| `gallery:downloadFailed` | 更新图库状态为 `failed` |

#### 7.2 新建 `src/app/gallery/page.tsx` — 图库管理页面

采用卡片式网格布局，与任务管理页面的表格风格区分：

**卡片信息层**：
- 封面图（`CoverURL`）+ 状态角标
- 标题、主角名
- 数量徽章：`50P`（图片数）、`1V`（视频数）、`3页`（分页数）
- 实时进度条（下载中/爬取中状态时显示 `completed/total`）

**详情展开面板**（点击卡片后展开为全宽面板）：
- 基本信息：源链接（可复制）、描述、标签、分类、保存路径
- 信息栏：图片数量、视频数量、页数、进度、创建时间
- **图片缩略图网格**：最多展示 50 张缩略图，每张带下载状态指示点（绿色=已下载/红色=失败/灰色=等待）
- **视频列表**：文件名 + 下载状态徽章

**筛选与搜索**：
- 状态筛选：全部 / 爬取中 / 下载中 / 已完成 / 失败
- 关键词搜索：标题、主角、描述、源链接
- 排序：最新优先 / 最早优先 / 图片最多

**操作**：
- 重新下载（仅 `failed` / `partial` 状态可用）
- 删除图库

#### 7.3 修改 `src/components/layout/sidebar.tsx` — 添加图库导航

在侧边栏导航中新增「图库」入口：

```typescript
import { Images } from "lucide-react";

const navItems = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/tasks", label: "任务", icon: Download },
  { href: "/gallery", label: "图库", icon: Images },  // 新增
  { href: "/search", label: "搜索", icon: Radar },
  // ...
];
```

移动端底部导航栏自动调整：前 4 项为 `仪表盘 / 任务 / 图库 / 搜索`，后 3 项归入「更多」菜单。

#### 7.4 修改 `src/app/tasks/page.tsx` — 图库响应识别

`handleAdd` 方法增加 `type` 字段检测：

```typescript
const data = await res.json();

if (data?.type === "gallery") {
  // 图库任务：提示图片/视频数量，引导用户到图库页面查看
  const parts: string[] = [];
  if (data.imageCount) parts.push(`${data.imageCount} 张图片`);
  if (data.videoCount) parts.push(`${data.videoCount} 个视频`);
  toast.success(`图库已创建${parts.length ? `（${parts.join(" + ")}）` : ""}，请在图库页面查看进度`);
} else {
  // 视频任务：原有逻辑
  toast.success("任务已创建");
  fetchTasks();
}
```

同时更新空状态提示文案，从「在右侧输入 M3U8 链接即可开始下载」改为「输入 M3U8 链接或网站地址即可开始下载」。

#### 7.5 重写 `src/app/history/page.tsx` — 增加 Tab 切换

重构历史页面为双 Tab 模式：

```
┌──────────────────────────────────────┐
│  [视频历史]  [图库历史]               │  ← Tab 切换
├──────────────────────────────────────┤
│  筛选 | 搜索 | 排序 | 操作            │  ← 工具栏
├──────────────────────────────────────┤
│  表格内容                             │
└──────────────────────────────────────┘
```

**视频历史 Tab**：保留原有逻辑不变（`DownloadTask` 列表 + 状态筛选 + 重新下载/删除）。

**图库历史 Tab**（新增）：
- 表格列：编号、标题、主角、图片数（`50P`）、视频数（`1V`）、状态、完成时间、操作
- 状态筛选：全部 / 已完成 / 失败
- 搜索：标题、主角、源链接
- 操作：重新下载（`failed`/`partial` 状态）、删除
- WebSocket 实时刷新（通过 `gallery-store` 的 `subscribeToSocket`）

### 新增文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/store/gallery-store.ts` | ~190 | 图库状态管理 Store（Zustand），含 WebSocket 事件订阅 |
| `src/app/gallery/page.tsx` | ~500 | 图库管理页面，卡片式网格布局 + 详情展开面板 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/components/layout/sidebar.tsx` | 导入 `Images` 图标；`navItems` 新增 `{ href: "/gallery", label: "图库", icon: Images }` |
| `src/app/tasks/page.tsx` | `handleAdd` 增加 `data.type === "gallery"` 分支，解析图库响应并给出正确反馈；空状态文案更新 |
| `src/app/history/page.tsx` | 完全重写为双 Tab 模式（视频历史 / 图库历史），新增 `GalleryHistoryTab` 组件 |

### 验证结果

- ESLint：新增和修改文件 0 错误
- TypeScript 编译：新增和修改文件 0 错误（`batch-search-panel.tsx` 的 5 个错误为 pre-existing，非本次引入）

### 数据流全链路

```
用户在任务页面输入爱妹子 URL
    │
    ▼
POST /api/tasks → getGalleryProvider(url) 匹配
    │
    ├──→ handleGalleryUrl() → scrapeGallery() 翻页爬取
    │     │
    │     ├──→ prisma.gallery.create / update
    │     ├──→ prisma.galleryImage.createMany
    │     ├──→ prisma.galleryVideo.createMany
    │     │
    │     └──→ getGalleryDownloader().downloadGallery(id)  [异步]
    │           │
    │           ├──→ eventBus.emit('gallery:downloadProgress')
    │           │     │
    │           │     └──→ Socket.IO 桥接 → io.emit('gallery:downloadProgress')
    │           │           │
    │           │           └──→ 前端 gallery-store.subscribeToSocket()
    │           │                 │
    │           │                 └──→ setProgress() → 图库页面进度条实时更新
    │           │
    │           └──→ eventBus.emit('gallery:downloadCompleted')
    │                 │
    │                 └──→ 前端 scheduleRefetch() → fetchGalleries() 刷新列表
    │
    └──→ 返回 { type: 'gallery', galleryId, imageCount, videoCount }
          │
          └──→ tasks/page.tsx handleAdd 检测 type === 'gallery'
                │
                └──→ toast.success("图库已创建（50 张图片 + 1 个视频），请在图库页面查看进度")

用户点击侧边栏「图库」
    │
    ▼
/gallery 页面 → useGalleryStore.fetchGalleries()
    │
    ├──→ GET /api/gallery?limit=100 → 返回 GalleryData[]
    │
    └──→ 渲染卡片网格（封面、标题、主角、数量徽章、进度条）
          │
          └──→ 点击卡片 → fetchGalleryDetail(id)
                │
                └──→ GET /api/gallery/[id] → 返回含 Images[] 和 Videos[] 的完整数据
                      │
                      └──→ 展示图片缩略图网格 + 视频列表
```

### UI 设计要点

1. **卡片 vs 表格**：图库页面使用卡片网格（`grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`），因为图库内容以视觉为主（封面图、缩略图），卡片比表格更适合展示视觉信息。

2. **进度指示**：
   - 卡片层面：下载中/爬取中状态时显示进度条 + `completed/total` 文字
   - 图片层面：每张缩略图右下角的小圆点指示下载状态（绿/红/灰）

3. **详情展开**：点击卡片后在卡片网格中插入全宽详情面板（`grid-column: 1 / -1`），而非弹窗，保持上下文连续性。

4. **历史页面 Tab**：使用与任务页面批量导入相同的 `.tasks-tab` 样式，保持视觉一致性。

---
