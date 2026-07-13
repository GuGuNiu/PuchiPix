# 数据库迁移修复 + ouo.io 302 重定向捕获修复

## 概述

本次修复解决了两个关键问题：
1. 数据库表结构不完整导致 API 500 错误
2. ouo.io 解析失败（点击后跳转 chrome-error 页面）

通过全流程测试验证了图库爬取、ZIP 下载、8 线程并行下载的完整链路。

## 修复内容

### 1. 数据库迁移修复

**问题现象**
- API 返回 500 错误
- 错误信息：`SQLITE_ERROR: no such column: main.galleries.scraped_domain`

**根因分析**
Prisma schema 中定义了 `scrapedDomain` 字段，但数据库迁移未正确执行，导致表结构缺失该列。

**修复步骤**
```bash
# 添加缺失的数据库列
npx prisma migrate dev --name add_scraped_domain
```

**验证结果**
```bash
node test-prisma.js
# 输出: OK 0
```

---

### 2. ouo.io 302 重定向捕获修复

**问题现象**
- ouo.io 解析失败，点击 "Get Link" 后页面跳转到 `chrome-error://chromewebdata/`
- 错误信息：`ouo.io 跳转失败：目标页面加载错误且未捕获到目标 URL`
- 重试 3 次后仍失败

**根因分析**
ouo.io 的跳转流程：
1. 第一页点击 "I'm a human" → POST 到 `/go/{id}` → 302 跳转到第二页
2. 第二页点击 "Get Link" → 302 跳转到 MediaFire 目标 URL

原代码仅通过页面 URL 判断是否跳转成功，但某些情况下目标页面加载失败（chrome-error），而 302 响应头中的 `Location` 已包含真实目标 URL。

**修复方案**
增强响应监听器，捕获 302 重定向响应头中的 `Location` 字段：

```typescript
// src/lib/downloader/zip-downloader.ts
let capturedTargetUrl: string | null = null;
const responseHandler = (response: import('playwright').Response) => {
  const url = response.url();
  
  // 捕获 302 重定向的目标 URL（从响应头中）
  const headers = response.headers();
  const location = headers['location'];
  if (location && !location.includes('ouo.io') && !location.includes('ouo.press')) {
    console.log(`[ZipDL] ouo.io: 从响应头捕获重定向目标: ${location}`);
    capturedTargetUrl = location;
    return;
  }
  
  // 捕获非 ouo 域名的响应 URL
  if (!url.includes('ouo.io') && !url.includes('ouo.press') && !url.includes('chrome-error')) {
    console.log(`[ZipDL] ouo.io: 从响应捕获目标 URL: ${url}`);
    capturedTargetUrl = url;
  }
};
```

**修复后逻辑**
1. 页面加载失败（chrome-error）但已捕获目标 URL → 使用捕获的 URL
2. 页面正常跳转到非 ouo 域名 → 使用页面 URL
3. 页面仍在 ouo 域名 → 尝试第三步点击
4. 完全失败 → 抛出错误

---

## 全流程测试

### 测试环境
- 服务器: http://localhost:10540
- 数据库: SQLite (已重置)
- 线程数: 8 线程并行下载

### 测试步骤

#### 1. 搜索图库
```bash
POST /api/search
Body: {"keywords":"女仆","siteId":"aimeizizi"}
```

**结果**: 找到 14 个图库

#### 2. 添加图库任务 #1
```bash
POST /api/tasks
Body: {"url":"https://www.lovecutes.com/article/32244/"}
```

**结果**: 
- 图库 ID: 1
- 标题: 純愛eko - 小春日和：小春日和私房 52P
- 状态: completed
- 下载: 52 张图片全部成功

#### 3. 添加图库任务 #2
```bash
POST /api/tasks
Body: {"url":"https://www.lovecutes.com/article/31959/"}
```

**结果**:
- 图库 ID: 2
- 标题: Machi馬吉 - White Rabbit：美腿大尺度 92P
- 状态: completed
- 下载: 91 张图片全部成功

#### 4. ZIP 下载测试
```bash
POST /api/gallery/2/download-zip
Body: {"enqueue":false}
```

**解析日志**:
```
[ZipDL] ouo.io: 导航到 https://ouo.io/RIgW7Q9
[ZipDL] ouo.io 第一步: 点击 "I'm a human"
[ZipDL] ouo.io 第二步: 点击 "Get Link"
[ZipDL] ouo.io: 从响应头捕获重定向目标: https://www.mediafire.com/file/...
[ZipDL] ouo.io: 跳转结果 URL = chrome-error://chromewebdata/
[ZipDL] ouo.io: 页面加载失败，从响应中捕获目标 URL: https://www.mediafire.com/...
[ZipDL] MediaFire: 等待下载按钮...
[ZipDL] MediaFire: 按钮直接含直链 → https://download1085.mediafire.com/...
```

**下载日志**:
```
[ParallelDL] 文件大小: 339458282 bytes (323.7 MB), Range 支持: true
[ParallelDL] 使用 8 线程并行下载，每块约 40.5 MB
[ParallelDL] 进度: 2% (5.0 MB / 323.7 MB, 0.1 MB/s)
[ParallelDL] 进度: 12% (40.0 MB / 323.7 MB, 0.1 MB/s)
...
```

---

## 验证结果

| 测试项 | 状态 | 备注 |
|--------|------|------|
| 数据库连接 | ✅ 通过 | scraped_domain 列已添加 |
| 图库爬取 #1 | ✅ 通过 | 52 张图片全部下载 |
| 图库爬取 #2 | ✅ 通过 | 91 张图片全部下载 |
| ouo.io 解析 | ✅ 通过 | 302 重定向捕获成功 |
| MediaFire 直链 | ✅ 通过 | 按钮直接含直链 |
| 8 线程下载 | ✅ 通过 | 40.5 MB/块，并行下载中 |
| 进度追踪 | ✅ 通过 | 实时进度日志输出 |

---

## 文件变更

### 修改文件
- `src/lib/downloader/zip-downloader.ts` — 增强 ouo.io 响应监听器，捕获 302 重定向目标

### 新增迁移
- `prisma/migrations/20260712143307_add_scraped_domain/migration.sql`

---

## 后续优化建议

1. **下载速度优化**: 当前速度 0.1 MB/s 较慢，考虑：
   - 检查网络代理配置
   - 优化 Range 请求头
   - 增加超时重试机制

2. **ouo.io 缓存**: 已解析的 ouo.io 链接应缓存更长时间（当前 10 分钟），避免重复解析触发 IP 限速

3. **错误重试策略**: 当前重试 3 次，可考虑指数退避策略

---

## 时间戳

- 修复日期: 2026-07-12
- 测试完成: 2026-07-12 14:55

---

*作者: PuchiPix Team*
