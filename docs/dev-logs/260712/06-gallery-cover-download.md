# 图库封面下载 — 本地存储 + API 服务 + 前端回退

## 概述

修复爱妹子模块图包封面图未下载到本地的问题。此前封面 URL 仅存储在数据库 `coverUrl` 字段中，前端直接引用远程 URL 展示封面，存在防盗链失败、远程站点不可用等风险。

本次修改在图包下载流程中新增封面下载步骤，将封面图保存到图包文件夹的 `cover/` 子目录，通过新增的 API 端点提供给前端展示，前端优先使用本地封面、失败时回退到远程 URL。

## 问题分析

### 现状

- `AimeiziziProvider.scrapeGallery` 从页面提取第一张图片 URL 作为 `coverUrl`，存入数据库
- `GalleryDownloader._doDownload` 仅下载图片和视频，未处理封面
- `ZipDownloader` 同样未下载封面
- 前端 `gallery/page.tsx` 直接使用 `gallery.CoverURL`（远程 URL）展示封面

### 风险

| 风险 | 影响 |
|------|------|
| 远程站点防盗链 | 封面 403/404，前端显示空白 |
| 站点迁移或下线 | 封面永久不可用 |
| IP 限速 | 频繁请求远程图片触发站点 WAF |
| 本地图包已下载但封面缺失 | 图包架展示不一致 |

## 修改内容

### 1. 数据库模型 — 新增 `coverLocalPath` 字段

`prisma/schema.prisma` Gallery 模型新增：

```prisma
// 封面图本地路径（下载后存于图包文件夹的 cover/ 子目录）
coverLocalPath String      @default("") @map("cover_local_path")
```

已执行 `prisma db push` 和 `prisma generate` 同步数据库和 Prisma Client。

### 2. 类型定义 — `GalleryData` 新增 `CoverLocalPath`

`src/types/index.ts`：

```typescript
export interface GalleryData {
  // ...
  CoverURL: string;
  /** 封面图本地路径（下载后存于 cover/ 子目录） */
  CoverLocalPath: string;
  // ...
}
```

### 3. 图包下载器 — 新增封面下载步骤

`src/lib/downloader/gallery-downloader.ts` 的 `_doDownload` 方法中，在图片下载之前新增步骤 0：

```
目录结构：
  data/galleries/
  ├── {主角名} - {描述} (galleryId)/
  │   ├── cover/
  │   │   └── cover.jpg     ← 新增
  │   ├── 1.jpg
  │   ├── 2.jpg
  │   ├── ...
  │   └── video.mp4
  └── ...
```

封面下载逻辑：

- 封面 URL 从 `gallery.coverUrl` 获取
- 保存路径为 `{galleryPath}/cover/cover{ext}`
- 使用与图片下载相同的 `downloadFile` 函数（含防盗链 Referer 头）
- 最多重试 3 次，指数退避（1s → 2s → 4s）
- 断点续传：文件已存在且 size > 0 → 跳过，仅更新数据库路径
- 下载成功后更新 `gallery.coverLocalPath`

### 4. ZIP 下载器 — 解压后补充下载封面

`src/lib/downloader/zip-downloader.ts` 在 ZIP 解压和内容校验完成后（阶段 5），补充下载封面：

- 仅当 `gallery.coverUrl` 存在且 `gallery.coverLocalPath` 为空时触发
- 使用独立实现的 `downloadCoverImage` 函数（携带 `sec-fetch-dest: image` 头和同域 Referer）
- 保存路径与爬虫下载一致：`{galleryPath}/cover/cover{ext}`
- 确保仅通过 ZIP 下载的图包也有封面供图包架展示

### 5. 新增 API 端点 — 封面图服务

新建 `src/app/api/gallery/[id]/cover/route.ts`：

```
GET /api/gallery/[id]/cover
```

- 从数据库读取 `coverLocalPath`
- 读取本地文件并返回图片二进制流
- 根据 扩展名 自动设置 `Content-Type`（jpg/png/gif/webp/bmp）
- `Cache-Control: public, max-age=3600`（1 小时缓存）
- 文件不存在时返回 404

### 6. API 响应映射 — 新增 `CoverLocalPath`

两个 API 路由的 `mapGallery` 函数均新增 `coverLocalPath` 字段映射：

- `src/app/api/gallery/route.ts` — `mapGallery`
- `src/app/api/gallery/[id]/route.ts` — `mapGalleryWithRelations`

### 7. 前端展示 — 优先本地、回退远程

`src/app/gallery/page.tsx` 封面图展示逻辑：

```typescript
src={gallery.CoverLocalPath ? `/api/gallery/${gallery.ID}/cover` : gallery.CoverURL}
```

- `CoverLocalPath` 非空 → 请求 `/api/gallery/{ID}/cover`（本地封面）
- `CoverLocalPath` 为空 → 直接使用 `CoverURL`（远程 URL）
- 本地封面加载失败 → 自动回退到 `CoverURL`
- 两者均无 → 显示占位图标

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `prisma/schema.prisma` | 修改 | Gallery 新增 `coverLocalPath` 字段 |
| `src/types/index.ts` | 修改 | `GalleryData` 新增 `CoverLocalPath` |
| `src/lib/downloader/gallery-downloader.ts` | 修改 | `_doDownload` 新增封面下载步骤；目录结构注释更新 |
| `src/lib/downloader/zip-downloader.ts` | 修改 | 新增 `downloadCoverImage` 函数；解压后补充下载封面 |
| `src/app/api/gallery/route.ts` | 修改 | `mapGallery` 和类型定义新增 `coverLocalPath` |
| `src/app/api/gallery/[id]/route.ts` | 修改 | `mapGalleryWithRelations` 和类型定义新增 `coverLocalPath` |
| `src/app/api/gallery/[id]/cover/route.ts` | 新建 | 封面图服务端点 |
| `src/app/gallery/page.tsx` | 修改 | 封面图优先使用本地路径，失败回退远程 URL |

## 验证结果

| 验证项 | 状态 | 备注 |
|--------|------|------|
| Prisma db push | ✅ 通过 | 数据库已同步 `cover_local_path` 列 |
| Prisma generate | ✅ 通过 | Prisma Client 已更新 |
| TypeScript 编译 | ✅ 通过 | 无类型错误 |
| Lint 检查 | ✅ 通过 | 无 lint 错误 |

---

*作者: PuchiPix Team*
*日期: 2026-07-12*
