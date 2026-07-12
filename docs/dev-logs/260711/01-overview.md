# 开发日志 — 2026-07-11 — 概述、验证结果、修改文件清单与架构图

## 概述

本次开发将历史 Python 项目中的「爱妹子」爬虫功能并入当前 Next.js 项目，作为子模块功能之一。主要工作包括：

1. **从 Git 历史恢复旧代码**：挖掘 `f07e8fd` 提交中的 `aimeizizi_scraper.py` 和 `base_scraper.py`，提取站点选择器和爬取逻辑。
2. **页面结构实测**：使用浏览器访问两个测试 URL，分析 DOM 结构、懒加载机制、分页导航和视频嵌入方式。
3. **数据库模型设计**：新增 `Gallery`、`GalleryImage`、`GalleryVideo` 三个 Prisma 模型，支持主角定位、分类、标签。
4. **Provider 实现**：创建 `AimeiziziProvider`，实现 `SiteProvider` + `GallerySiteProvider` 双接口。
5. **图包下载系统**：创建 `GalleryDownloader` 模块，支持并发下载、断点续传、自动重试。
6. **本地目录结构**：在 `data/galleries/` 下为每个图库创建独立子文件夹，图片和视频分目录存储。

---


---

## 修改文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/sites/providers/aimeizizi-provider.ts` | 爱妹子站点 Provider（670 行） |
| `src/lib/downloader/gallery-downloader.ts` | 图包下载器模块（280 行） |
| `src/app/api/gallery/route.ts` | 图库列表/爬取 API |
| `src/app/api/gallery/[id]/route.ts` | 图库详情/删除 API |
| `src/app/api/gallery/[id]/download/route.ts` | 图库下载 API |
| `data/galleries/.gitkeep` | 目录占位文件 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `prisma/schema.prisma` | 新增 Gallery / GalleryImage / GalleryVideo 模型 |
| `src/types/index.ts` | 新增 Gallery 相关类型定义 |
| `src/lib/sites/types.ts` | 新增 GallerySiteProvider 接口 |
| `src/lib/sites/index.ts` | 导出 AimeiziziProvider 和新类型 |
| `src/lib/sites/site-registry.ts` | 注册 AimeiziziProvider |
| `src/lib/search/search-engine.ts` | 修复 scrapeVideoPage 返回类型（ScrapeResult） |
| `.env` | 新增 GALLERY_PATH 环境变量 |
| `.gitignore` | 新增 /data/galleries/ 忽略规则 |

---


---

## 验证结果

### TypeScript 编译

```
npx tsc --noEmit → 0 errors ✓
```

### Lint 检查

```
read_lints → No linter errors found ✓
```

### Prisma 迁移

```
npx prisma db push  → Database synced ✓
npx prisma generate → Client generated ✓
```

### 数据库验证

新增三个表已创建：
- `galleries` — 图库主表
- `gallery_images` — 图片表
- `gallery_videos` — 视频表

---


---

## 架构图

```
                          ┌─────────────────────────┐
                          │     SiteRegistry         │
                          │  (站点注册中心)            │
                          └────┬────────────┬────────┘
                               │            │
                  ┌────────────▼──┐  ┌─────▼──────────────┐
                  │ KanavProvider  │  │ AimeiziziProvider   │
                  │ (kanav.ad)     │  │ (xx.knit.bid)       │
                  │ MacCMS 视频    │  │ WordPress 图库      │
                  └───────────────┘  └────────┬───────────┘
                                             │
                                    scrapeGallery()
                                             │
                                             ▼
                          ┌──────────────────────────────────┐
                          │       GalleryScrapeResult         │
                          │  title, protagonist, description  │
                          │  images[], videos[], tags[]       │
                          └──────────────┬───────────────────┘
                                         │
                                    保存到数据库
                                         │
                          ┌──────────────▼───────────────────┐
                          │         Prisma (SQLite)           │
                          │  Gallery → GalleryImage[]         │
                          │          → GalleryVideo[]         │
                          └──────────────┬───────────────────┘
                                         │
                                异步触发下载
                                         │
                          ┌──────────────▼───────────────────┐
                          │       GalleryDownloader           │
                          │  并发下载图片 (4线程)              │
                          │  逐个下载视频                     │
                          │  断点续传 + 自动重试              │
                          └──────────────┬───────────────────┘
                                         │
                          ┌──────────────▼───────────────────┐
                          │     data/galleries/               │
                          │  ├── {主角} - {描述} (id)/        │
                          │  │   ├── images/                  │
                          │  │   │   ├── 001.jpg              │
                          │  │   │   └── ...                  │
                          │  │   └── videos/                  │
                          │  │       └── video_1.mp4          │
                          │  └── ...                          │
                          └──────────────────────────────────┘
```

---
