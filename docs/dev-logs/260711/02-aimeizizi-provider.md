# 开发日志 — 2026-07-11 — 功能一：爱妹子站点 Provider 集成

## 功能一：爱妹子站点 Provider 集成

### Git 历史挖掘

从提交 `f07e8fd` 恢复了旧的 Python 代码：

```
git show f07e8fd:old/scrapers/aimeizizi_scraper.py
git show f07e8fd:old/scrapers/base_scraper.py
```

关键信息提取：

| 属性 | 值 |
|------|-----|
| 站点域名 | `https://xx.knit.bid` |
| URL 模式 | `/article/{id}/` |
| 分页 URL | `/article/{id}/page/{n}/` |
| 标题选择器 | `h1.focusbox-title` |
| 图片选择器 | `article.article-content img[data-src]` |
| 视频选择器 | `video > source[src*=".m3u8"]` |
| 占位图 | `/static/zde/timg.gif`（懒加载占位 GIF） |

### 页面结构实测分析

使用 Playwright 浏览器访问两个测试 URL：

#### URL 1: `/article/27571/`

| 属性 | 值 |
|------|-----|
| 页面标题 | `可可小白兔 - 電車上の女高中生 - cosplay - 爱妹子` |
| H1 标题 | `可可小白兔 - 電車上の女高中生` |
| 类型 | 纯图片图库 |
| 总页数 | 7 页 |
| 每页图片 | ~10 张 |
| 视频 | 无 |
| 标签 | cosplay, 高中生, 双马尾, 白丝, 可可小白兔, jk制服 |
| 面包屑分类 | Cosplay |

**图片懒加载机制**：
- `src` = `/static/zde/timg.gif`（占位 GIF）
- `data-src` = 真实图片 URL（如 `/static/images/2024/04/11/.../xxx.jpg`）
- 第一张图片 `loading="eager"`，其余 `loading="lazy"`

#### URL 2: `/article/28798/`

| 属性 | 值 |
|------|-----|
| 页面标题 | `九言 - 教室JK少女 21P1V - 爱妹子` |
| H1 标题 | `九言 - 教室JK少女 21P1V` |
| 类型 | 图片 + 视频 |
| 总页数 | 3 页 |
| 视频 | `https://media.knit.bid/play/575cfac63d9bb667.m3u8` |
| 视频元素 | `<video><source src="..." type="application/vnd.apple.mpegurl"></video>` |
| 标签 | 九言, 教室, jk制服, 少女, 美胸 |

**标题命名规律**：
- 格式：`{主角名} - {描述} {数量}P{数量}V`
- `P` = 图片数量，`V` = 视频数量
- 示例：`九言 - 教室JK少女 21P1V` → 21 张图片 + 1 个视频

### 数据库模型设计

在 `prisma/schema.prisma` 中新增三个模型：

```
Gallery (图库主表)
├── id              Int @id
├── sourceUrl       String @unique  — 源页面 URL
├── siteId          String          — 站点 ID（aimeizizi）
├── title           String          — 完整标题
├── protagonist     String          — 主角名（从标题提取）
├── description     String          — 描述（去掉主角名后的部分）
├── category        String          — 分类（如 Cosplay）
├── tags            String          — 标签（JSON 数组字符串）
├── coverUrl        String          — 封面图 URL
├── imageCount      Int             — 图片数量
├── videoCount      Int             — 视频数量
├── pageCount       Int             — 总页数
├── status          String          — pending | scraping | completed | failed
├── savePath        String          — 本地保存路径
│
├── GalleryImage[]  — 一对多关联
│   ├── url         String          — 图片原始 URL
│   ├── localPath   String          — 本地保存路径
│   ├── fileName    String          — 文件名
│   ├── pageIndex   Int             — 所在页码
│   ├── orderIndex  Int             — 全局排序
│   └── status      String          — pending | downloaded | failed
│
└── GalleryVideo[]  — 一对多关联
    ├── url         String          — M3U8 或视频 URL
    ├── localPath   String          — 本地保存路径
    ├── fileName    String          — 文件名
    └── status      String          — pending | downloading | completed | failed
```

### AimeiziziProvider 实现

文件：`src/lib/sites/providers/aimeizizi-provider.ts`

```
AimeiziziProvider extends BaseSiteProvider implements GallerySiteProvider
├── id = 'aimeizizi'
├── name = '爱妹子'
├── baseUrl = 'https://xx.knit.bid'
│
├── buildSearchUrl(keyword)     → /?s={keyword}
├── cleanTitle(rawTitle)        → 去除 " - 分类 - 爱妹子" 后缀
├── matchesUrl(url)             → 匹配 *.knit.bid
├── extractSearchResults(page)  → 从 article a[href*="/article/"] 提取
├── extractExtendedMetadata(page) → 提取标题、主角、分类、标签
├── extractProtagonist(title, tags) → 从标题 "主角 - 描述" 中提取主角
├── extractDescription(title, protagonist) → 去掉主角名和数量标记
├── scrapeGallery(page, url)   → 完整图库爬取（含自动翻页）
└── scrapePage(page, url)       → 单页爬取（返回 ScrapeResult）
```

### 主角定位算法

```
输入：title = "可可小白兔 - 電車上の女高中生"
     tags = ["cosplay", "高中生", "双马尾", "白丝", "可可小白兔", "jk制服"]

步骤 1：按 " - " 分割标题
         parts = ["可可小白兔", "電車上の女高中生"]

步骤 2：取第一段作为候选主角名
         candidate = "可可小白兔"

步骤 3：交叉验证 — 候选名是否出现在标签列表中
         tags.includes("可可小白兔") → true ✓

输出：protagonist = "可可小白兔"
      description = "電車上の女高中生"
```

**降级策略**：
- 如果标题不含 ` - ` 分隔符，遍历标签列表，查找与标题前缀匹配的项
- 如果第一段长度 ≥ 20 字符，不认定为主角（可能是无主角的描述性标题）

### 自动翻页实现

```
scrapeGallery(page, pageUrl)
│
├── 1. 提取第一页数据
│   ├── H1 标题、标签、分类
│   ├── 分页信息：从 nav 文本匹配 "第 N 頁，共 M 頁"
│   ├── 图片：article img 的 data-src（过滤占位 GIF）
│   └── 视频：video > source[src*=".m3u8"] + script 内扫描
│
├── 2. 逐页爬取（page 2 ~ totalPages）
│   ├── 导航到 /article/{id}/page/{n}/
│   ├── 等待 article 元素加载
│   ├── 提取当前页的图片和视频
│   └── 翻页间隔 800~1300ms（防爬虫）
│
├── 3. 合并去重
│   ├── 图片：全局 orderIndex 递增
│   └── 视频：URL Set 去重
│
└── 4. 返回 GalleryScrapeResult
    ├── title, protagonist, description, category, tags
    ├── images: [{ url, pageIndex, orderIndex }]
    ├── videos: [{ url }]
    └── pageCount, imageCount, videoCount
```

---


---

## 类型系统扩展

### 新增类型（`src/types/index.ts`）

```typescript
GalleryImageItem    — 图库中单张图片信息（url, pageIndex, orderIndex）
GalleryVideoItem    — 图库中单个视频信息（url）
GalleryScrapeResult — 图库爬取完整结果
GalleryData         — 图库 API 响应格式
GalleryImageData    — 图库图片 API 响应格式
GalleryVideoData    — 图库视频 API 响应格式
```

### 新增接口（`src/lib/sites/types.ts`）

```typescript
GallerySiteProvider — 图库站点提供者接口
  └── scrapeGallery(page: Page, pageUrl: string): Promise<GalleryScrapeResult>
```

---


---

## API 路由清单

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/gallery` | `POST` | 爬取指定 URL 的图库，保存到数据库，异步触发下载 |
| `/api/gallery` | `GET` | 查询图库列表（支持主角筛选、状态筛选、分页） |
| `/api/gallery/[id]` | `GET` | 获取图库详情（含图片和视频列表） |
| `/api/gallery/[id]` | `DELETE` | 删除图库及其所有图片和视频记录 |
| `/api/gallery/[id]/download` | `POST` | 手动触发图库下载（支持自定义并发数） |

---
