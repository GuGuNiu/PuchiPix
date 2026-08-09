# tuyi.gmtaotu.net WordPress 深度逆向分析报告

## 执行摘要

| 维度 | 发现数量 |
|------|---------|
| REST API 路由 | 标准 WP 端点 |
| 自定义 AJAX Actions | 10+ 个 (erphpdown) |
| WordPress 核心端点 | 完整可用 |
| 第三方插件 API | Yoast SEO, WP Statistics |
| **VIP 绕过可行性** | **不可行 - 服务端验证** |

---

## 1. 站点指纹识别

### 1.1 基础信息
```yaml
Site Name: 国模套图
URL: https://tuyi.gmtaotu.net/
WordPress Version: 6.x (通过 REST API 推断)
Theme: Modown v9.44
Theme Author: mobantu
Plugins:
  - Erphpdown v17.61 (付费下载)
  - Yoast SEO v21.9.1
  - WP Statistics
Server: Cloudflare (CF-Ray header)
PHP Version: 未知 (X-Powered-By 隐藏)
```

### 1.2 主题检测
- **路径**: `/wp-content/themes/modown/`
- **版本**: 9.44 (从 CSS/JS 查询参数)
- **类型**: 付费资源下载主题

### 1.3 插件检测
- **Erphpdown**: `/wp-content/plugins/erphpdown/` v17.61
- **功能**: VIP 会员系统、付费下载、百度网盘集成

---

## 2. WordPress REST API 分析

### 2.1 API 根目录
```
https://tuyi.gmtaotu.net/wp-json/
```

### 2.2 可用命名空间
| 命名空间 | 用途 | 访问权限 |
|----------|------|----------|
| `wp/v2` | 核心内容 API | 公开 |
| `yoast/v1` | SEO 数据 | 公开 |
| `wp-statistics/v2` | 统计 | 部分受限 |

### 2.3 核心端点测试

#### 获取文章列表
```bash
GET https://tuyi.gmtaotu.net/wp-json/wp/v2/posts?per_page=5
```
✅ **可用** - 返回文章基础信息

#### 获取文章详情
```bash
GET https://tuyi.gmtaotu.net/wp-json/wp/v2/posts/195908
```
✅ **可用** - 返回完整文章内容

**注意**: `content.rendered` 中**不包含**百度网盘链接，仅包含预览图

#### 获取媒体附件
```bash
GET https://tuyi.gmtaotu.net/wp-json/wp/v2/media?parent=195908
```
✅ **可用** - 仅返回预览图，无网盘链接

#### 获取文章 Meta
```bash
GET https://tuyi.gmtaotu.net/wp-json/wp/v2/posts/195908?_embed
```
⚠️ **受限** - meta 字段仅返回 `{"footnotes":""}`

---

## 3. AJAX 端点逆向

### 3.1 主 AJAX 端点
```
https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php
```

### 3.2 Erphpdown 插件 Actions

| Action | 用途 | 参数 | 权限要求 |
|--------|------|------|----------|
| `epd_wppay` | 发起支付 | `post_id` | 登录 |
| `epd_wppay_pay` | 查询支付状态 | `post_id`, `order_num` | 登录 |
| `epd_see` | **获取下载链接** | `post_id`, `vip`, `token` | **VIP** |
| `epd_check_pan` | 检测网盘链接 | `post_id`, `post_index` | 登录 |
| `epd_index` | 首页购买 | `post_id`, `index_id`, `price` | 登录 |
| `epd_vip_pay` | VIP 购买 | `type` | 登录 |
| `epd_activation_vip` | 激活 VIP | `post_id` | 登录 |
| `epd_checkin` | 签到 | - | 登录 |
| `epd_check_pan` | 检测网盘 | `post_id` | 登录 |

### 3.3 关键 API 测试

#### epd_see (获取下载链接)
```bash
curl -X POST "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php" \
  -d "action=epd_see&post_id=195908&vip=1&token="
```
**响应**: `{"status":202}`
**结论**: 权限不足，需要 VIP

#### epd_check_pan
```bash
curl -X POST "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php" \
  -d "action=epd_check_pan&post_id=195908&post_index=0"
```
**响应**: `0`
**结论**: 无权限

---

## 4. 认证机制分析

### 4.1 认证方式
| 方式 | 状态 | 说明 |
|------|------|------|
| Cookie 认证 | ✅ 使用 | `wordpress_logged_in_*` |
| Nonce | ✅ 使用 | 通过内联 JS 传递 |
| JWT | ❌ 未使用 | - |
| Application Password | ⚠️ 可用 | 标准 WP 功能 |

### 4.2 全局配置对象
```javascript
// _ERPHPDOWN
{
  "uri": "https://tuyi.gmtaotu.net/wp-content/plugins/erphpdown",
  "payment": "1",
  "wppay": "scan",
  "tuan": "",
  "danmu": "0",
  "author": "mobantu"
}

// _ERPHP
{
  "ajaxurl": "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php"
}

// _MBT (主题配置)
{
  "uri": "https://tuyi.gmtaotu.net/wp-content/themes/modown",
  "admin_ajax": "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php",
  "erphpdown": "https://tuyi.gmtaotu.net/wp-content/plugins/erphpdown/"
}
```

---

## 5. VIP 机制深度分析

### 5.1 权限控制流程
```
用户点击下载
    ↓
前端检查登录状态 (JS)
    ↓
未登录 → 弹出登录框
已登录 → 检查 VIP 状态
    ↓
非 VIP → 显示"仅限VIP下载" + 升级按钮
VIP → 调用 epd_see API
    ↓
后端验证 VIP 权限
    ↓
返回百度网盘链接
```

### 5.2 服务端验证点
1. **登录验证**: 检查 `wordpress_logged_in_*` Cookie
2. **VIP 验证**: 查询用户元数据 `wp_usermeta`
3. **Token 验证**: 防止 CSRF 攻击
4. **权限检查**: 验证用户是否有权下载该资源

### 5.3 绕过可行性分析

| 绕过方式 | 可行性 | 原因 |
|----------|--------|------|
| 前端绕过 | ❌ 不可行 | 链接由服务端生成 |
| API 直接调用 | ❌ 不可行 | 需要有效 Cookie + VIP |
| 参数伪造 | ❌ 不可行 | Token 验证 |
| SQL 注入 | ❌ 不可行 | WP 使用预处理语句 |
| 未授权访问 | ❌ 不可行 | 权限检查严格 |

---

## 6. 数据提取策略

### 6.1 公开可获取数据
```python
# 1. 文章列表
GET /wp-json/wp/v2/posts?per_page=100&page={n}

# 2. 文章详情
GET /wp-json/wp/v2/posts/{id}

# 3. 媒体文件
GET /wp-json/wp/v2/media?parent={post_id}

# 4. 分类
GET /wp-json/wp/v2/categories
```

### 6.2 可提取字段
- ✅ 标题
- ✅ 内容 (HTML)
- ✅ 预览图 URL
- ✅ 发布日期
- ✅ 作者
- ✅ 分类/标签
- ✅ 解压密码 (从内容中解析: `gmtaotu.com`)
- ❌ 百度网盘链接 (VIP 专享)

### 6.3 提取代码示例
```python
import requests
from bs4 import BeautifulSoup

def extract_post_metadata(post_id):
    """提取文章元数据"""
    url = f"https://tuyi.gmtaotu.net/wp-json/wp/v2/posts/{post_id}"
    response = requests.get(url)
    data = response.json()
    
    # 解析内容中的表格数据
    soup = BeautifulSoup(data['content']['rendered'], 'html.parser')
    table = soup.find('table')
    
    metadata = {
        'id': post_id,
        'title': data['title']['rendered'],
        'date': data['date'],
        'preview_image': data.get('featured_media', None),
    }
    
    # 提取表格数据
    if table:
        for row in table.find_all('tr'):
            cells = row.find_all('td')
            if len(cells) >= 2:
                key = cells[0].text.strip()
                value = cells[1].text.strip()
                metadata[key] = value
    
    return metadata
```

---

## 7. 安全风险评估

### 7.1 发现的问题
| 问题 | 严重程度 | 说明 |
|------|----------|------|
| 解压密码暴露 | 🟡 低 | 全站统一密码在页面源码中 |
| REST API 公开 | 🟢 信息 | 标准 WP 行为 |
| 用户枚举 | 🟢 信息 | 作者信息可获取 |

### 7.2 安全强度
- ✅ VIP 验证严格 (服务端)
- ✅ 下载链接动态生成
- ✅ Token 防 CSRF
- ✅ 权限检查完整

---

## 8. 结论与建议

### 8.1 核心结论
**无法绕过 VIP 机制获取百度网盘链接**

原因：
1. 下载链接完全由服务端生成
2. VIP 验证在服务端进行
3. 无未授权访问漏洞
4. 无前端加密可逆向

### 8.2 可行方案

#### 方案 1: 爬取公开数据 (推荐)
- 提取标题、预览图、元数据
- 建立资源索引
- 解压密码已知: `gmtaotu.com`

#### 方案 2: VIP 账号模拟
- 购买 VIP 会员
- 使用 Playwright 模拟登录
- 调用 `epd_see` API 获取链接

#### 方案 3: 浏览器扩展
- 开发 Chrome 扩展
- VIP 用户安装后自动提取链接
- 需要至少一个 VIP 账号

### 8.3 技术参考

| 资源 | 路径 |
|------|------|
| 完整分析报告 | `tuyi-gmtaotu-reverse-report.md` |
| API 测试代码 | `api-test-snippets.md` |
| 插件源码 | `erphpdown.js` |
| REST API 文档 | `wp-json-root.json` |

---

## 附录: API 快速参考

### 公开 API (无需认证)
```bash
# 文章列表
curl "https://tuyi.gmtaotu.net/wp-json/wp/v2/posts?per_page=10"

# 文章详情
curl "https://tuyi.gmtaotu.net/wp-json/wp/v2/posts/195908"

# 媒体文件
curl "https://tuyi.gmtaotu.net/wp-json/wp/v2/media?parent=195908"

# 分类
curl "https://tuyi.gmtaotu.net/wp-json/wp/v2/categories"
```

### 受限 API (需要 VIP)
```bash
# 获取下载链接 (需要 Cookie + VIP)
curl -X POST "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php" \
  -H "Cookie: wordpress_logged_in_xxx=..." \
  -d "action=epd_see&post_id=195908&vip=1&token=..."
```

---

*报告生成时间: 2026-08-03*
*分析工具: JS-REVERSE MCP + WordPress Reverse Skill*
