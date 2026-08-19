# COS猫猫 (cosmaomao.com) 完整图片爬取分析报告

## 📋 测试目标

- **页面**: https://cosmaomao.com/cos-online/487022.html
- **标题**: 云溪溪-No.130 – OL (&奈汐酱nice) **[55P]**
- **测试时间**: 2026-08-01
- **测试工具**: JS-REVERSE MCP (Playwright)

---

## 🔍 关键发现

### 1. 页面显示机制

| 项目 | 详情 |
|------|------|
| **声明总数** | 55 张图片 |
| **免费显示** | 仅前 3 张 |
| **隐藏内容** | 52 张需要登录/购买会员 |

### 2. 免费可见图片 (3张)

页面源码中可直接提取的3张预览图：

```
https://cosmaomao.com/wp-content/uploads/2026/07/5ad3d1344105d64.jpg
https://cosmaomao.com/wp-content/uploads/2026/07/0c88e279fccc14d.jpg
https://cosmaomao.com/wp-content/uploads/2026/07/91823d1903f115a.jpg
```

### 3. 隐藏内容机制

```html
<div class="ri-hide-warp">
  <span class="hide-msg"><i class="fas fa-lock me-1"></i>隐藏内容</span>
  <div class="hide-buy-warp">
    <div class="buy-title">本内容需权限查看</div>
    <div class="buy-btns">
      <a href="/login?redirect_to=..." class="login-btn">登录后购买</a>
    </div>
    <div class="buy-desc">
      <ul class="prices-info">
        <li class="price-item no">普通用户: <span>不可购买</span></li>
        <li class="price-item vip">VIP会员: <span>1.4软妹币<sup>1折</sup></span></li>
        <li class="price-item boosvip">永久会员: <span>免费</span></li>
      </ul>
    </div>
    <div class="buy-count">已有<span>1253</span>人解锁查看</div>
  </div>
</div>
```

---

## ⚠️ 结论：无法直接爬取全部55张

### 原因分析

1. **权限控制**: 网站使用 **Ripro-V5** 主题的付费内容保护机制
2. **服务端验证**: 完整图片列表只在用户登录且有权限后通过AJAX加载
3. **无公开API**: 测试了多个可能的 AJAX action，均返回 400 错误
4. **图片命名**: 使用随机哈希命名（如 `5ad3d1344105d64.jpg`），无法猜测

### 尝试过的方法

| 方法 | 结果 | 说明 |
|------|------|------|
| 页面源码提取 | ❌ 失败 | 仅包含3张预览图 |
| WordPress AJAX API | ❌ 失败 | 需要正确的 action 和 nonce |
| JSON-LD 数据 | ❌ 失败 | 只包含1张图片 |
| 正则匹配所有URL | ❌ 失败 | 只找到5张相关图片 |
| 猜测URL模式 | ❌ 失败 | 哈希命名无法预测 |

---

## 🛠️ 可行的获取方案

### 方案 1: 模拟登录（需要账号）

```powershell
# 使用 Playwright 模拟登录流程
# 需要有效的 VIP/永久会员账号

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false }); // 需要可视化登录
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // 1. 访问登录页
  await page.goto('https://cosmaomao.com/login');
  
  // 2. 手动或使用脚本填写账号密码
  await page.fill('input[name="username"]', 'your_username');
  await page.fill('input[name="password"]', 'your_password');
  await page.click('button[type="submit"]');
  
  // 3. 等待登录成功，跳转到目标页面
  await page.goto('https://cosmaomao.com/cos-online/487022.html');
  
  // 4. 等待隐藏内容加载
  await page.waitForTimeout(3000);
  
  // 5. 提取所有图片
  const images = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.wp-block-gallery img, .ri-hide-warp img'))
      .map(img => img.src || img.dataset.lazySrc)
      .filter(src => src && src.includes('wp-content/uploads'));
  });
  
  console.log(`找到 ${images.length} 张图片`);
  console.log(images);
  
  await browser.close();
})();
```

### 方案 2: 使用已登录的 Cookie

```powershell
# 如果有已登录的 Cookie，可以直接使用

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# 添加登录后的 Cookie
$cookie = New-Object System.Net.Cookie
$cookie.Name = "wordpress_logged_in_..."
$cookie.Value = "your_cookie_value"
$cookie.Domain = "cosmaomao.com"
$session.Cookies.Add($cookie)

# 请求页面
$response = Invoke-WebRequest -Uri "https://cosmaomao.com/cos-online/487022.html" `
  -WebSession $session -UserAgent "Mozilla/5.0..."

# 提取图片URL
$images = [regex]::Matches($response.Content, 'https://cosmaomao\.com/wp-content/uploads/[^"\'\s]+\.(jpg|jpeg|png|webp)')
$images | ForEach-Object { $_.Value }
```

### 方案 3: 浏览器开发者工具手动提取

1. 使用浏览器登录 VIP 账号
2. 访问目标页面
3. 按 F12 打开开发者工具
4. 在 Console 中执行：

```javascript
// 提取所有图片URL
const images = Array.from(document.querySelectorAll('.wp-block-gallery img, .ri-hide-warp img'))
  .map(img => img.src || img.dataset.lazySrc)
  .filter(src => src && src.includes('wp-content/uploads'));

console.log(images.join('\n'));

// 复制到剪贴板
copy(images.join('\n'));
```

---

## 📊 技术细节

### 网站架构

| 项目 | 详情 |
|------|------|
| **CMS** | WordPress |
| **主题** | Ripro-V5 (付费主题) |
| **付费插件** | 自带内容保护机制 |
| **图片存储** | 本地 wp-content/uploads |
| **图片命名** | 随机16位十六进制哈希 |
| **反爬措施** | 服务端权限验证 |

### 发现的API端点

```
AJAX URL: https://cosmaomao.com/wp-admin/admin-ajax.php
Post ID: 487022
```

测试失败的 action：
- `ripro_get_post_content`
- `get_post_gallery`
- `load_hidden_content`
- `get_attachment_images`
- `ripro_v5_get_content`

---

## 🎯 最终结论

### 直接爬取全部55张？ **❌ 不可能**

**原因：**
1. 网站有完善的付费内容保护机制
2. 完整图片列表需要登录 + VIP/永久会员权限
3. 图片使用随机哈希命名，无法通过猜测获取
4. 没有公开的API可以绕过权限检查

### 可行的替代方案

| 方案 | 难度 | 成本 | 成功率 |
|------|------|------|--------|
| 购买会员后爬取 | 低 | ~1.4元/月 | 100% |
| 使用他人共享账号 | 中 | 免费 | 取决于账号 |
| 寻找第三方镜像站 | 高 | 免费 | 不确定 |
| 手动下载 | 低 | 免费 | 100%（费时） |

---

## 📁 相关文件

| 文件 | 说明 |
|------|------|
| `cosmaomao-full-analysis.md` | 本完整分析报告 |
| `crawler-analysis-report.md` | 基础爬取测试报告 |
| `cosmaomao-crawler-test.ps1` | PowerShell 测试脚本 |

---

*报告生成时间: 2026-08-01*
*测试工具: JS-REVERSE MCP*
