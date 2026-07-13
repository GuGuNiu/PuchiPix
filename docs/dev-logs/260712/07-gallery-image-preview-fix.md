# 图库图片预览修复

## 问题描述

图包架（Gallery 页面）展开图库详情时，图片预览图无法实时显示，所有图片显示为半透明（opacity: 0.2）的加载失败状态。

## 根因分析

1. **图片源问题**：前端使用 `img.URL`（原始网络 URL）直接加载图片
2. **Referer 限制**：爱妹子站点的图片 CDN 需要特定的 Referer 头，浏览器直接请求会返回 403
3. **URL 失效**：部分图片 URL 可能已经过期或失效
4. **缺少本地文件回退**：已下载的图片没有优先使用本地路径

## 修复方案

### 1. 前端优先使用本地路径

**文件**: `src/app/gallery/page.tsx`

修改图片预览逻辑，优先使用本地文件路径，回退到网络 URL：

```typescript
// 修复前
<img
  src={img.URL}
  alt={`img-${img.OrderIndex + 1}`}
  ...
/>

// 修复后
<img
  src={img.LocalPath ? `/api/proxy?path=${encodeURIComponent(img.LocalPath)}` : img.URL}
  alt={`img-${img.OrderIndex + 1}`}
  ...
/>
```

### 2. API 代理支持本地文件

**文件**: `src/app/api/proxy/route.ts`

扩展代理 API，添加对本地文件路径的支持：

```typescript
// 新增参数支持
const filePath = request.nextUrl.searchParams.get('path');

// 本地文件处理逻辑
if (filePath) {
  // 安全检查：只允许访问 data 目录
  const resolvedPath = path.resolve(filePath);
  const dataDir = path.resolve('data');
  
  if (!resolvedPath.startsWith(dataDir)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // 读取并返回文件
  const fileBuffer = await readFile(resolvedPath);
  
  // 根据扩展名设置 Content-Type
  const contentTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
  };
  
  return new NextResponse(fileBuffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
```

## 安全考虑

1. **路径限制**：只允许访问 `data` 目录下的文件，防止目录遍历攻击
2. **路径解析**：使用 `path.resolve()` 和 `startsWith()` 进行严格检查
3. **文件存在性检查**：读取前验证文件是否存在

## 测试验证

### 测试步骤
1. 打开图库页面 (`/gallery`)
2. 点击任意已完成的图库卡片展开详情
3. 查看图片缩略图网格

### 预期结果
- 已下载的图片：显示本地文件预览（通过 `/api/proxy?path=`）
- 未下载的图片：尝试加载网络 URL，失败时显示半透明占位
- 图片加载速度明显提升（本地文件 vs 网络请求）

## 文件变更

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/app/gallery/page.tsx` | 修改 | 图片 src 优先使用本地路径 |
| `src/app/api/proxy/route.ts` | 修改 | 添加本地文件服务支持 |

## 后续优化

1. **缩略图生成**：为大图生成缩略图，减少内存占用
2. **懒加载优化**：使用 Intersection Observer 优化大量图片的懒加载
3. **图片占位符**：添加骨架屏或模糊占位符提升用户体验
4. **失败重试**：网络图片加载失败时，自动尝试重新下载

---

## 时间戳

- 问题发现: 2026-07-12
- 修复完成: 2026-07-12
- 作者: PuchiPix Team
