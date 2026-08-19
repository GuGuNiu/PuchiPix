# 4KHD (qbep.uuss.uk) 逆向分析报告

> **分析日期**: 2026-08-03
> **目标页面**: `https://qbep.uuss.uk/content/02/island-fish-prince-eugen-bunny-girl.html`
> **分析工具**: Playwright + Node.js HTTPS + JS-REVERSE MCP
> **参考模块**: aimeizizi (爱妹子)

---

## 1. 站点架构

### 1.1 CMS 指纹

| 项目 | 值 |
|------|-----|
| CMS | WordPress 6.1.1 |
| SEO 插件 | Yoast SEO v20.11 |
| 主题 | Charta (自定义 block-theme) |
| 缓存 | WP Rocket (延迟 JS 加载) |
| 其他插件 | My Favorites v1.4.1, WP PostViews |
| CDN | Cloudflare (cf-ray header, cache HIT) |
| 图片 CDN | Jetpack (`i0.wp.com` proxy) + `pic.4khd.com` (Blogger API) |

### 1.2 多域名架构

| 域名 | 用途 | 说明 |
|------|------|------|
| `www.4khd.com` | WordPress 主站 | 后台 admin-ajax.php, REST API, wp-content |
| `qbep.uuss.uk` | Cloudflare 前端代理 | 缓存页面, 附加 Service Worker + 反爬脚本 |
| `y5gx.uuss.uk` | 动态脚本服务 | `4khd.php` 返回 JS/CSS |
| `pic.4khd.com` | 图片 CDN | Blogger API 格式 URL |
| `m.4khd.com` | 短链接服务 | TeraBox 下载链接重定向 |
| `zy.4khd.com` | 作者主页 | 管理员 "行政" 的个人页面 |

### 1.3 URL 模式

```
列表页: https://www.4khd.com/pages/popular
        https://www.4khd.com/pages/cosplay
        https://www.4khd.com/pages/album
搜索页: https://www.4khd.com/?s={keyword}
详情页: https://www.4khd.com/content/{category_id}/{slug}.html
分页:   https://www.4khd.com/content/{category_id}/{slug}.html/{page_num}
封面图: https://i0.wp.com/pic.4khd.com/{hash1}/{hash2}/{hash3}/{id}/{w-h-p-k-no-rw}/{filename}
下载:   https://m.4khd.com/{short_code} → TeraBox
```

---

## 2. 页面结构

### 2.1 详情页 DOM 结构

```html
<body class="post-template-default single single-post postid-71429">
  <div class="wp-site-blocks">
    <header class="wp-block-template-part">
      <!-- 导航栏: popular / cosplay / album + 搜索框 -->
    </header>
    <main class="is-layout-constrained wp-block-group">
      <div class="wp-block-columns">
        <div class="wp-block-column">
          <!-- 主内容区 -->
          <h3 class="wp-block-post-title">屿鱼 欧根亲王 兔女郎[258MB-81photos]</h3>
          <!-- 社交分享按钮 -->
          <!-- 收藏按钮 -->
          <div class="entry-content wp-block-post-content">
            <!-- 下载信息 -->
            <p>Extracting passwords: 4KHD</p>
            <p>Full HD without watermark download: <a href="https://m.4khd.com/CcbvS8">TeraBox</a></p>
            <!-- 图片列表 -->
            <p>
              <a href="...bunny-girl-4khd.com-001.webp">
                <img loading="lazy" src="...001.webp" width="1300" height="1500">
              </a><br>
              <a href="...002.webp"><img ...></a><br>
              ...20 images per page...
            </p>
            <!-- 分页导航 -->
            <div class="page-link-box">
              <ul class="page-links">
                <li class="numpages current"><span>1</span></li>
                <li class="numpages"><a href="...html/2">2</a></li>
                <li class="numpages"><a href="...html/3">3</a></li>
                <li class="numpages"><a href="...html/4">4</a></li>
                <li class="numpages"><a href="...html/5">5</a></li>
              </ul>
            </div>
          </div>
          <!-- 相关推荐 -->
          <div id="basicE">
            <a href="...yuyu-underwear.html">
              <img src="...4KHD-beautifulGirls.webp">
              <p>屿鱼 – 内衣[16MB-12photos]</p>
            </a>
            ...8 more related galleries...
          </div>
        </div>
      </div>
    </main>
    <footer class="wp-block-template-part">
      <a href="https://m.4khd.com/faq">how to download</a>
    </footer>
  </div>
</body>
```

### 2.2 图片 URL 格式

```
缩略图（页内显示）: https://i0.wp.com/pic.4khd.com/{hash1}/{hash2}/{hash3}/{id}/w1300-rw/{filename}.webp?w=1300
原图（点击链接）:   https://i0.wp.com/pic.4khd.com/{hash1}/{hash2}/{hash3}/{id}/w1300-rw/{filename}.webp?w=1300

注: 页内 img src 和父级 a href 指向同一 URL，无单独的 "原图" URL
```

### 2.3 标题模式

```
格式: {主角} {描述}[{文件大小}-{图片数量}photos]
示例: 屿鱼  欧根亲王 兔女郎[258MB-81photos]
      屿鱼 – 内衣[16MB-12photos]
      Bunny Ayumi – Polka Dot Bikini(46MB)(15photos)
```

### 2.4 JSON-LD 结构

```json
{
  "@type": "WebPage",
  "url": "https://www.4khd.com/content/02/island-fish-prince-eugen-bunny-girl.html",
  "name": "屿鱼 欧根亲王 兔女郎[258MB-81photos] - 4KHD",
  "datePublished": "2026-08-02T10:36:00+00:00",
  "dateModified": "2026-08-02T10:36:00+00:00",
  "thumbnailUrl": "https://i0.wp.com/pic.4khd.com/.../4KHD-beautifulGirls.webp",
  "author": { "@type": "Person", "name": "行政" },
  "primaryImageOfPage": { "@id": "...#primaryimage" }
}
```

---

## 3. WAF / 反爬虫机制

### 3.1 Cloudflare

| 机制 | 状态 | 说明 |
|------|------|------|
| CDN 缓存 | ✅ 启用 | `cf-cache-status: HIT`, `cache-control: max-age=86400` |
| Challenge Platform | ✅ 启用 | 注入 iframe + `cdn-cgi/challenge-platform/scripts/jsd/main.js` |
| Browser Verification | ❌ 未触发 | HTTP 请求直接返回 200 + 完整 HTML |
| Turnstile CAPTCHA | ❌ 未启用 | 无 `.cf-turnstile` 元素 |
| Rate Limiting | ⚠️ 未知 | 高频请求可能触发 429 |

### 3.2 Service Worker 反爬 (scss.js)

`scss.js` 是一个混淆的 Service Worker 脚本，功能：
1. **注册 Service Worker**: `navigator.serviceWorker.register('/scss.js')`
2. **图片缓存**: 通过 Cache API 缓存图片到 `img-cache`
3. **域名优选**: 测速选择最快的 Google CDN 域名加载 favicon
4. **心跳消息**: 每 30 秒向 controller 发送 `{action: 'keepAlive'}`
5. **每日清理**: `checkDailyCacheClean` 动作清理过期缓存
6. **允许域名白名单**: 14 个 Google 域名 + `i1.wp.com`

### 3.3 反自动化检测

| 检测点 | 机制 | 影响 |
|--------|------|------|
| Headless Browser | Service Worker + JS 指纹 | 页面重定向到 `about:blank` |
| DevTools | `disabley.min.js` | 可能禁用右键和开发者工具 |
| 广告注入 | `a.pemsrv.com/popunder1000.js` | 弹窗广告 |
| 延迟加载 | WP Rocket `delayjs.js` | 非关键 JS 延迟执行 |
| 图片懒加载 | `loading="lazy"` | 滚动到可视区域才加载 |

### 3.4 绕过策略

| 策略 | 可行性 | 说明 |
|------|--------|------|
| **HTTP 直接抓取** | ✅ 推荐 | Cloudflare 缓存 HIT，直接返回完整 HTML，无需 JS 执行 |
| Playwright headless | ❌ 不可行 | Service Worker 检测后重定向到 about:blank |
| Playwright headed | ⚠️ 可能 | 需要禁用 Service Worker 或使用隐身模式 |
| curl/wget | ✅ 可行 | 模拟浏览器 UA 即可获取完整 HTML |
| 反射代理 | ✅ 可行 | 服务端 fetch 可获取完整 HTML |

---

## 4. 数据提取策略

### 4.1 HTTP 抓取流程 (参考 aimeizi 模式)

```
1. HTTP GET 目标 URL → 获取完整 HTML (Cloudflare 缓存 HIT)
2. goquery 解析 HTML → 提取标题、图片、分页、下载链接
3. 遍历分页 → 拼接 /{N} 后缀获取剩余页面
4. 合并所有页面图片 → 去重 → 输出 GalleryScrapeResult
```

### 4.2 提取选择器

```css
标题:        h3.wp-block-post-title
文章内容:    .entry-content.wp-block-post-content
图片:        .entry-content img[src]  或  .entry-content a[href] > img
分页:        .page-links .numpages a[href]  或  .page-links li
下载链接:    .entry-content a[href*="m.4khd.com"]
提取码:     .entry-content p (文本包含 "passwords: 4KHD")
发布时间:    meta[property="article:published_time"]
分类:       URL 路径中的数字段 /content/{cat_id}/
JSON-LD:    script[type="application/ld+json"]
```

### 4.3 与 aimeizi 模块的差异

| 维度 | aimeizi | 4KHD |
|------|---------|------|
| CMS | WordPress (Modown 主题) | WordPress (Charta 主题) |
| URL 模式 | /article/{id}/ | /content/{cat_id}/{slug}.html |
| 分页模式 | /article/{id}/page/{N}/ | /content/{cat_id}/{slug}.html/{N} |
| 图片属性 | data-src (lazy-load) | src + loading="lazy" |
| 图片 CDN | 站内 / 自建 CDN | Jetpack (`i0.wp.com`) + `pic.4khd.com` |
| ZIP 下载 | .download-info-box | TeraBox 短链接 (`m.4khd.com/{code}`) |
| 反爬强度 | Cloudflare (中) | Cloudflare + Service Worker (高) |
| HTTP 可行性 | ✅ 可行 | ✅ 可行（缓存 HIT） |
| 标题模式 | ModelName – Description | 主角 描述[大小-数量photos] |

---

## 5. GalleryScrapeResult 映射

```go
&sites.GalleryScrapeResult{
    SourceURL:     "https://www.4khd.com/content/02/island-fish-prince-eugen-bunny-girl.html",
    Title:         "屿鱼 欧根亲王 兔女郎",
    Protagonist:   "屿鱼",
    Description:   "欧根亲王 兔女郎",
    Category:      "02",  // URL 路径中的分类 ID
    Tags:          []string{"屿鱼", "欧根亲王", "兔女郎", "4KHD"},
    CoverURL:      "https://i0.wp.com/pic.4khd.com/.../4KHD-beautifulGirls.webp",
    PublishTime:   "2026-08-02",
    Images:        []GalleryImageItem{...},  // 81 张
    Videos:        []GalleryVideoItem{},
    PageCount:     5,
    ImageCount:    81,
    VideoCount:    0,
    ScrapedDomain: "https://www.4khd.com",
    ZipInfo: &GalleryZipInfo{
        DownloadURL: "https://m.4khd.com/CcbvS8",
        Password:    "4KHD",
        FileSizeText: "258MB",
        FileCount:    81,
        Provider:    "TeraBox",
    },
}
```

---

## 6. 结论

1. **4KHD 是一个标准 WordPress 图集站**，使用 Charta block-theme + Yoast SEO
2. **HTTP 直接抓取完全可行**，Cloudflare 缓存 HIT 返回完整 HTML（~83KB/页）
3. **Playwright 不推荐**，Service Worker 会检测 headless 浏览器并重定向到 about:blank
4. **图片可直接下载**，URL 格式为 `https://i0.wp.com/pic.4khd.com/...`，无需 Referer
5. **下载链接为 TeraBox 短链接**，提取码固定为 "4KHD"
6. **分页模式简单**：`/{slug}.html/{page_num}`，最多 5 页
7. **建议采用 aimeizi 的 HTTP 抓取模式**，无需 Browser 回退
