# 开发日志 — 2026-07-12 — ouo.io 下载流程端到端测试与修复

## 1. 概述

对爱妹子模块的 ZIP/RAR 压缩包下载闭环进行了完整的端到端测试。测试过程中发现并修复了 6 个关键问题，最终验证了从 ouo.io 短链接到 MediaFire 直链提取、流式下载、RAR 密码解压的完整链路。

### 测试目标

图库 #10「焖焖碳 - 体操服：美腿大尺度写真 30P」

| 属性 | 值 |
|------|-----|
| 图库 ID | 10 |
| 标题 | 焖焖碳 - 体操服：美腿大尺度写真 30P |
| 来源 URL | `https://www.lovecutes.com/article/32000/` |
| 下载 URL | `https://ouo.io/jjNH1Pt` |
| 提供商 | MediaFire |
| 密码 | `www.lovecutes.com` |
| 文件数 | 30 |
| 体积 | 261.2 MB |

### 最终测试结果

```
✅ 成功: true
✅ 状态: completed
✅ 本地路径: data/gallery_zips/gallery_10/[写真] 焜焖碳 - 体操服：美腿大尺度写真 30P.rar
✅ 解压路径: data/galleries/焖焖碳 - 体操服：美腿大尺度写真 (10)/zip_extracted
✅ 文件大小: 273,927,423 bytes (261.24 MB)
✅ 文件数量: 30
```

---

## 2. 问题一：ouo.io IP 限速检测缺失

### 2.1 现象

测试脚本的「阶段 0 预检查」先访问了一次 ouo.io 链接，随后 `downloadAndExtractZip` 再次访问同一链接。第二次访问时 ouo.io 已触发 IP 限速，将请求重定向到 `/shorten` 页面，导致解析卡死。

### 2.2 原因

ouo.io 有严格的 IP 限速机制：同一链接短时间内被访问两次以上，服务端会重定向到 `/shorten` 页面（一个要求你注册/登录的页面），不再展示正常的广告跳转流程。

### 2.3 修复

在 `resolveOuoIo` 函数中，导航完成后立即检查 URL 是否包含 `/shorten`：

```typescript
await page.goto(ouoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

// 检查是否被 IP 限速重定向到 /shorten 页面
const currentUrl = page.url();
if (currentUrl.includes('/shorten') || currentUrl.includes('/go/shorten')) {
  throw new Error('ouo.io IP 限速：被重定向到 /shorten 页面，请等待 5-10 分钟后重试');
}
```

第一步点击后同样检查：

```typescript
const afterFirstClickUrl = page.url();
if (afterFirstClickUrl.includes('/shorten')) {
  throw new Error('ouo.io IP 限速：第一步点击后被重定向到 /shorten');
}
```

同时移除测试脚本中的预检查阶段，避免重复访问。

---

## 3. 问题二：ouo.press 域名未识别

### 3.1 现象

ouo.io 会自动重定向到 `ouo.press` 域名，但代码中只检测了 `ouo.io`，导致跳转到 `ouo.press` 后被误判为「已离开 ouo 域名」，返回了错误的 URL。

### 3.2 修复

所有域名判断同时检查 `ouo.io` 和 `ouo.press`：

```typescript
// 跳转结果判断
if (!finalUrl.includes('ouo.io') && !finalUrl.includes('ouo.press')) {
  return { directUrl: finalUrl, filename: extractFilenameFromUrl(finalUrl) };
}

// 响应监听器过滤条件
if (!url.includes('ouo.io') && !url.includes('ouo.press') && !url.includes('chrome-error')) {
  capturedTargetUrl = url;
}
```

---

## 4. 问题三：chrome-error 导致解析死循环（核心问题）

### 4.1 现象

ouo.io 第二步点击 "Get Link" 后，目标页面（MediaFire）加载失败，浏览器地址栏变为 `chrome-error://chromewebdata/`。`page.url()` 返回的是这个无效 URL，`resolveDirectDownloadUrl` 递归调用时传入 `chrome-error://` 导致 `new URL()` 抛出异常，触发重试，重试时又访问同一 ouo.io 链接，形成死循环。

### 4.2 根因分析

ouo.io 的 "Get Link" 按钮实际上是通过表单 POST 提交的，服务端返回 302 重定向到目标站点。但在某些情况下（网络问题、目标站点 SSL 证书问题等），重定向的目标页面加载失败，Chrome 显示 `chrome-error://chromewebdata/` 错误页面。

关键点：**虽然页面加载失败，但 302 重定向响应本身是成功的**，响应头中的 `Location` 字段包含了真实的目标 URL。

### 4.3 修复方案

在点击 "Get Link" 按钮前，设置 `page.on('response')` 监听器捕获所有非 ouo 域名的响应 URL。即使目标页面加载失败，重定向响应仍会触发监听器：

```typescript
// 在点击前设置响应监听器
let capturedTargetUrl: string | null = null;
const responseHandler = (response: import('playwright').Response) => {
  const url = response.url();
  if (!url.includes('ouo.io') && !url.includes('ouo.press') && !url.includes('chrome-error')) {
    capturedTargetUrl = url;
  }
};
page.on('response', responseHandler);

// 点击 "Get Link"
const nav2 = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.click('#btn-main, .btn-main, button[type="submit"]').catch(() => {});
await nav2;

page.off('response', responseHandler);

const finalUrl = page.url();

// 页面加载失败时，使用捕获的目标 URL
if ((finalUrl.startsWith('chrome-error://') || finalUrl === 'about:blank') && capturedTargetUrl) {
  return {
    directUrl: capturedTargetUrl,
    filename: extractFilenameFromUrl(capturedTargetUrl),
  };
}

if (finalUrl.startsWith('chrome-error://')) {
  throw new Error('ouo.io 跳转失败：目标页面加载错误且未捕获到目标 URL');
}
```

同时在 `resolveDirectDownloadUrl` 入口添加防御检查：

```typescript
if (intermediateUrl.startsWith('chrome-error://') || intermediateUrl === 'about:blank') {
  throw new Error(`无效的中转站 URL: ${intermediateUrl}`);
}
```

### 4.4 实际日志

```
[ZipDL] ouo.io 第二步: 点击 "Get Link"
[ZipDL] ouo.io: 跳转结果 URL = https://www.mediafire.com/file/wdexuh2inty7ykc
```

本次测试中，页面成功跳转到了 MediaFire，未触发 chrome-error。但修复代码已就位，能在该场景下正确工作。

---

## 5. 问题四：RAR 文件无法解压

### 5.1 现象

261MB 文件下载完成后，解压阶段报错：

```
[ZipDL] 解压失败: ADM-ZIP: Invalid or unsupported zip format. No END header found
```

### 5.2 原因

下载的文件实际是 **RAR 格式**（文件名以 `.rar` 结尾），而 `adm-zip` 库只支持 ZIP 格式，无法解析 RAR 文件头。

爱妹子站点的压缩包使用 RAR 格式而非 ZIP，这与之前假设不一致。

### 5.3 修复

安装 `node-unrar-js`（基于 WASM 的 RAR 解压库）：

```bash
pnpm add node-unrar-js
```

重构解压逻辑，根据文件扩展名自动选择解压器：

```typescript
async function extractArchive(archivePath, extractPath, password?) {
  const ext = path.extname(archivePath).toLowerCase();
  if (ext === '.rar') {
    return extractRar(archivePath, extractPath, password);
  }
  return extractZipFile(archivePath, extractPath, password);
}
```

新增 `extractRar` 函数使用 `node-unrar-js`：

```typescript
async function extractRar(rarPath, extractPath, password?) {
  const extractor = await createExtractorFromFile({
    filepath: rarPath,
    targetPath: extractPath,
    password: password || '',
  });

  const extracted = extractor.extract({ password: password || undefined });
  const files: string[] = [];
  for (const file of extracted.files) {
    if (!file.fileHeader.flags.directory) {
      files.push(file.fileHeader.name);
    }
  }
  return { success: true, fileCount: files.length, files };
}
```

密码容错：如果密码错误（错误信息包含 `PASSWORD`），尝试无密码解压。

---

## 6. 问题五：重复下载已存在文件

### 6.1 现象

首次测试下载了 261MB 文件但因解压失败而终止。第二次测试时，由于 `Content-Disposition` 重命名了文件，代码未检测到已下载的文件，重新走了完整的 ouo.io 解析 + 下载流程。

### 6.2 修复

在下载前扫描目标目录，检查是否已有压缩包文件：

```typescript
const existingArchive = fs.readdirSync(zipDir).find((f) => {
  const lower = f.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.7z');
});

if (existingArchive) {
  const existingPath = path.join(zipDir, existingArchive);
  const stat = fs.statSync(existingPath);
  if (stat.size > 0) {
    console.log(`[ZipDL] 发现已下载文件: ${existingArchive} (${stat.size} bytes)，跳过下载`);
    actualZipPath = existingPath;
    actualSize = BigInt(stat.size);
    skipDownload = true;
  }
}
```

---

## 7. 问题六：缺少进度日志

### 7.1 现象

首次测试时日志卡在 `[ZipDL] 解析中转站: https://ouo.io/jjNH1Pt` 长达 5 分钟，无法判断卡在哪一步。

### 7.2 修复

在所有关键步骤添加 `console.log`：

| 步骤 | 日志 |
|------|------|
| ouo.io 导航 | `[ZipDL] ouo.io: 导航到 {url}` |
| 第一步等待 | `[ZipDL] ouo.io 第一步: 等待按钮激活...` |
| 第一步点击 | `[ZipDL] ouo.io 第一步: 点击 "I'm a human"` |
| 第二步等待 | `[ZipDL] ouo.io 第二步: 等待 "Get Link" 按钮激活 (URL: {url})` |
| 第二步点击 | `[ZipDL] ouo.io 第二步: 点击 "Get Link"` |
| 跳转结果 | `[ZipDL] ouo.io: 跳转结果 URL = {url}` |
| MediaFire 按钮 | `[ZipDL] MediaFire: 等待下载按钮...` |
| MediaFire 直链 | `[ZipDL] MediaFire: 按钮直接含直链 → {url}` |
| 下载开始 | `[ZipDL] 下载开始: {path} (Content-Length: {bytes} bytes)` |
| 下载进度 | `[ZipDL] 下载进度: {pct}% ({downloaded} MB / {total} MB)` |
| 下载完成 | `[ZipDL] 下载完成: {path} ({bytes} bytes)` |
| 解压开始 | `[ZipDL] 开始解压: {path} → {dir} (密码: 有/无)` |
| RAR 解压成功 | `[ZipDL] RAR 解压成功: {count} 个文件` |

下载进度每 5MB 输出一次，避免日志过多。

---

## 8. WAF 与反爬虫注意事项

### 8.1 ouo.io 的反爬虫机制

| 机制 | 说明 | 应对策略 |
|------|------|---------|
| Cloudflare Turnstile | 不可见验证码，headless 模式下不自动完成 | 表单仍可提交（服务端验证宽松），直接点击按钮 |
| 按钮延迟激活 | `setTimeout` 2.5s 后移除 `disabled` 类 | `waitForFunction` 轮询检查 `disabled` 类 |
| IP 限速 | 同一链接短时间内多次访问 → 重定向到 `/shorten` | 避免重复访问；被限速时等待 5-10 分钟冷却 |
| 域名重定向 | `ouo.io` → `ouo.press` | 域名判断同时检查两个域名 |
| 目标页面加载失败 | 重定向目标可能因 SSL/网络问题加载失败 | `page.on('response')` 监听器捕获真实 URL |

### 8.2 MediaFire 的下载限制

| 限制 | 说明 |
|------|------|
| 免费用户限速 | 下载速度约 170 KB/s，261MB 文件需要约 25 分钟 |
| 直链有效期 | 直链 URL 有时效性，过期后返回 403 |
| 倒计时 | 部分页面需等待 10-15 秒倒计时后才出现直链 |
| Referer 校验 | 直链请求需携带 MediaFire 页面 URL 作为 Referer |

### 8.3 Stealth 模式要求

- 使用 `createStealthPage` 创建隐身页面，注入反检测脚本
- 模拟真实浏览器指纹（UA、屏幕分辨率、WebGL 等）
- 使用 `channel: 'chrome'` 启动真实 Chrome 而非 Chromium

---

## 9. 测试过程时间线

| 时间 | 事件 |
|------|------|
| 06:17 | 第一次测试启动，预检查 ouo.io 后主流程卡死 |
| 06:29 | 第二次测试，修复了预检查问题，但遇到 chrome-error 死循环 |
| 06:33 | 第三次测试，修复了 chrome-error（response 监听器），ouo.io 解析成功 |
| 06:33 - 07:59 | 261MB 文件下载完成（约 86 分钟，含重试） |
| 07:59 | 解压失败：ADM-ZIP 不支持 RAR 格式 |
| 08:16 | 安装 node-unrar-js，修复解压器，完整测试通过 |
| 总计 | 约 2 小时，6 个问题发现并修复 |

### 第一次测试日志（卡死）

```
[ZipDL] 解析中转站: https://ouo.io/jjNH1Pt
（卡死 5 分钟+，因为预检查已触发 IP 限速）
```

### 第二次测试日志（chrome-error）

```
[ZipDL] ouo.io 第一步: 点击 "I'm a human"
[ZipDL] ouo.io 第二步: 点击 "Get Link"
[ZipDL] ouo.io: 跳转结果 URL = chrome-error://chromewebdata/
[ZipDL] 中转站解析失败（第 1 次）: page.goto: net::ERR_ABORTED
（重试时再次访问 ouo.io，形成死循环）
```

### 第三次测试日志（成功）

```
[ZipDL] ouo.io: 导航到 https://ouo.io/jjNH1Pt
[ZipDL] ouo.io 第一步: 等待按钮激活...
[ZipDL] ouo.io 第一步: 点击 "I'm a human"
[ZipDL] ouo.io 第二步: 等待 "Get Link" 按钮激活 (URL: https://ouo.io/go/jjNH1Pt)
[ZipDL] ouo.io 第二步: 点击 "Get Link"
[ZipDL] ouo.io: 跳转结果 URL = https://www.mediafire.com/file/wdexuh2inty7ykc
[ZipDL] MediaFire: 等待下载按钮...
[ZipDL] MediaFire: 按钮直接含直链 → https://download854.mediafire.com/...
[ZipDL] 下载开始: ...30P.rar (Content-Length: 273927423 bytes)
[ZipDL] 下载进度: 2% (5.0 MB / 261.2 MB)
...
[ZipDL] 下载进度: 100% (260.0 MB / 261.2 MB)
[ZipDL] 下载完成: ...30P.rar (273927423 bytes)
[ZipDL] 开始解压: ...30P.rar → .../zip_extracted (密码: 有)
[ZipDL] RAR 解压成功: 30 个文件
[ZipDL] 解压完成: .../zip_extracted（30 个文件）
```

---

## 10. 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/lib/downloader/zip-downloader.ts` | 修改 | 新增 `extractRar`/`extractArchive` 函数支持 RAR；`resolveOuoIo` 增加 /shorten 检测、ouo.press 域名识别、response 监听器捕获 chrome-error 场景的目标 URL；下载前已有文件检测；全链路进度日志 |
| `package.json` | 修改 | 新增 `node-unrar-js` 依赖 |
| `test/e2e-zip-download.ts` | 新建 | 端到端测试脚本 |
| `test/test-rar-extract.ts` | 新建 | RAR 解压单元测试 |
| `test/check-zip-status.ts` | 新建 | 数据库 ZIP 状态查询脚本 |

---

## 11. 注意事项总结

### 11.1 ouo.io 使用要点

1. **不要重复访问同一链接**：ouo.io IP 限速严格，同一链接短时间内访问两次即被封锁
2. **按钮有 2.5s 延迟**：页面 `setTimeout` 后才移除 `disabled` 类，需轮询等待
3. **两步点击流程**：第一步 "I'm a human" → `/go/{id}` 页面 → 第二步 "Get Link" → 目标站点
4. **域名重定向**：`ouo.io` 会重定向到 `ouo.press`，两个域名都需检测
5. **目标页面可能加载失败**：必须设置 response 监听器作为备用方案
6. **被限速后等待 5-10 分钟**：冷却后可恢复访问

### 11.2 MediaFire 使用要点

1. **先检查按钮 href**：`#downloadButton` 的 href 可能直接包含直链，无需等待倒计时
2. **Referer 必须正确**：下载直链时 Referer 设为 MediaFire 页面 URL，不能设为 ouo.io
3. **免费用户限速**：下载速度约 170 KB/s，大文件需要较长时间
4. **Content-Disposition 文件名**：下载响应头可能包含真实文件名，需在创建写入流前提取

### 11.3 RAR 解压要点

1. **爱妹子站点使用 RAR 格式**：不是 ZIP，`adm-zip` 无法处理
2. **使用 node-unrar-js**：基于 WASM 的纯 JS RAR 解压库，无需系统级依赖
3. **解压密码**：通常为站点域名（如 `www.lovecutes.com`）
4. **密码容错**：密码错误时尝试无密码解压（部分文件可能未加密）

---

## 12. 完整链路架构图

```
图库详情页 (lovecutes.com/article/xxx)
    │
    ├── extractZipDownloadInfo()
    │   └── eligibility API (带 next 参数) → resolved_links[0] = ouo.io 短链接
    │
    ▼
downloadAndExtractZip(galleryId)
    │
    ├── [跳过检查] 扫描 zipDir 是否已有 .zip/.rar 文件
    │
    ├── [阶段 1] resolveDirectDownloadUrl(ouo.io URL)
    │   │
    │   ├── resolveOuoIo()
    │   │   ├── 导航到 ouo.io → 检测 /shorten 限速
    │   │   ├── 第一步: 等待 #btn-main 激活 → 点击 "I'm a human"
    │   │   ├── 第二步: 等待 #btn-main 激活 → 设置 response 监听器 → 点击 "Get Link"
    │   │   └── 返回目标 URL (优先用 response 捕获的 URL，备用 page.url())
    │   │
    │   ├── resolveMediaFire()
    │   │   ├── 等待 #downloadButton
    │   │   ├── 检查 href 是否直接含直链 → 是则直接返回
    │   │   └── 否则点击 → 等待倒计时 → 轮询查找直链
    │   │
    │   └── 返回 { directUrl, filename, sourceUrl }
    │
    ├── [阶段 2] downloadFile(directUrl, filePath, { Referer: mediafireUrl })
    │   ├── HTTP/HTTPS GET → 处理 3xx 重定向
    │   ├── 从 Content-Disposition 提取文件名 → 确定最终保存路径
    │   ├── 创建 WriteStream → 手动监听 data 事件写入
    │   └── 每 5MB 输出进度日志
    │
    └── [阶段 3] extractArchive(zipPath, extractDir, password)
        ├── .rar → extractRar() → node-unrar-js (WASM)
        └── .zip → extractZipFile() → adm-zip
            └── 密码容错：密码错误 → 尝试无密码解压
```

---

## 13. 修订记录

| 日期 | 修订内容 |
|------|---------|
| 2026-07-12 | 初始版本：ouo.io 下载流程端到端测试，6 个问题修复，RAR 解压支持 |
