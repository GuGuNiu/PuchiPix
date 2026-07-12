# 开发日志 — 2026-07-11 — 功能二：图包本地下载系统

## 功能二：图包本地下载系统

### 目录结构设计

```
data/
├── puchipix.db              — SQLite 数据库
├── videos/                  — 视频下载（已有）
├── segments/                — TS 分片（已有）
└── galleries/               — 图包存储（新增）
    ├── 可可小白兔 - 電車上の女高中生 (1)/
    │   ├── images/
    │   │   ├── 001.jpg
    │   │   ├── 002.jpg
    │   │   └── ...
    │   └── videos/
    │       └── (空，此图库无视频)
    └── 九言 - 教室JK少女 (2)/
        ├── images/
        │   ├── 001.jpg
        │   ├── 002.jpg
        │   └── ...
        └── videos/
            └── video_1.mp4
```

**命名规则**：
- 子文件夹名：`{主角名} - {描述} ({galleryId})`
- 图片文件名：`{3位序号}.{扩展名}`（如 `001.jpg`）
- 视频文件名：`video_{序号}.{扩展名}`（如 `video_1.mp4`）
- 文件名安全处理：过滤 `\ / * ? : " < > |` 等非法字符

**环境变量**：
```env
GALLERY_PATH="./data/galleries"
```

**.gitignore 配置**：
```gitignore
/data/galleries/
!/data/galleries/.gitkeep
```

### GalleryDownloader 实现

文件：`src/lib/downloader/gallery-downloader.ts`

```
GalleryDownloader
├── downloadGallery(galleryId, concurrency=4)
│   │
│   ├── 1. 从数据库读取图库 + 关联图片/视频
│   ├── 2. 构建子文件夹路径
│   │   └── data/galleries/{主角} - {描述} ({id})/
│   ├── 3. 创建 images/ 和 videos/ 子目录
│   ├── 4. 更新 gallery.savePath
│   │
│   ├── 5. 并发下载图片（4 线程）
│   │   ├── 断点续传：status=downloaded 且文件存在 → 跳过
│   │   ├── 自动重试：最多 3 次，指数退避（1s → 2s → 4s）
│   │   ├── 下载头：Referer = 源页面 URL（绕过防盗链）
│   │   └── 更新 DB：localPath, fileName, status
│   │
│   ├── 6. 逐个下载视频
│   │   ├── M3U8 视频：记录 URL，标记 pending（交给 M3U8 下载器处理）
│   │   └── 非 M3U8 视频：直接下载
│   │
│   └── 7. 返回 { success, failed, skipped, savePath }
│
└── runConcurrent(tasks, concurrency) — 并发任务池
```

### 下载策略

| 策略 | 实现 |
|------|------|
| 并发控制 | 图片 4 线程并发，视频逐个下载（避免 M3U8 冲突） |
| 断点续传 | 文件已存在且 size > 0 → 跳过；DB status=downloaded → 跳过 |
| 自动重试 | 最多 3 次，指数退避（1s → 2s → 4s） |
| 防盗链 | 请求头携带 `Referer: {源页面 URL}` |
| 超时控制 | 30 秒超时，超时后销毁请求 |
| 重定向 | 自动跟随 3xx 重定向（相对路径转绝对路径） |
| M3U8 视频 | 暂记录 URL 和文件名，标记为 pending（由现有 M3U8 下载器处理） |

### API 集成

爬取完成后自动触发下载（异步，不阻塞 API 响应）：

```typescript
// src/app/api/gallery/route.ts — POST
// 爬取完成后异步触发下载
getGalleryDownloader()
  .downloadGallery(gallery.id)
  .then((result) => {
    console.log(`图库 #${gallery.id} 下载完成: 成功 ${result.success}...`);
  })
  .catch((err) => {
    console.error(`图库 #${gallery.id} 下载失败:`, err);
  });
```

---
