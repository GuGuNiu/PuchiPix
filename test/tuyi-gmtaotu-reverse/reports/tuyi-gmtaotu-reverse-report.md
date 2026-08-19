# tuyi.gmtaotu.net 逆向分析报告

## 任务信息
- **目标站点**: https://tuyi.gmtaotu.net/
- **分析时间**: 2026-08-03
- **测试目录**: E:\data\Github\PuchiPix\test

---

## 站点架构分析

### 技术栈识别
| 组件 | 版本/类型 | 说明 |
|------|----------|------|
| **CMS** | WordPress | 标准 WordPress 站点 |
| **主题** | Modown v9.44 | 付费资源下载主题 |
| **下载插件** | Erphpdown v17.61 | 付费下载/会员系统插件 |
| **前端框架** | jQuery 3.7.1 | 标准 jQuery |
| **弹窗组件** | Layer v3.1.1 | 弹窗/对话框 |
| **CDN** | Cloudflare | 使用了 Cloudflare CDN |

### 站点类型
**付费图库资源站** - 提供国模套图下载，采用 VIP 会员制付费模式

---

## 资源下载容器分析

### 容器 HTML 结构
```html
<div class="erphpdown-box">
  <span class="erphpdown-title">资源下载</span>
  <div class="erphpdown-con clearfix">
    <div class="erphpdown-price">
      下载价格<span>VIP</span>专享
    </div>
    <div class="erphpdown-cart">
      <div class="vip vip-only">
        仅限VIP下载
        <a href="https://tuyi.gmtaotu.net/personal/?pd=money" 
           target="_blank" 
           class="erphpdown-vip-loader">升级VIP</a>
      </div>
      <a href="javascript:;" class="down signin-loader">立即购买</a>
    </div>
  </div>
  <div class="tips2">
    开通VIP即可下载，无需二次付费！
    充值及使用过程如遇问题，请添加客服微信：qwe35366进行反馈！
    全站套图解压密码：gmtaotu.com
  </div>
</div>
```

### 关键信息提取
- **解压密码**: `gmtaotu.com` (全站统一)
- **下载方式**: 百度网盘
- **付费模式**: VIP专享 (非单篇购买)
- **客服微信**: qwe35366

---

## API 端点分析

### WordPress AJAX 端点
```
https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php
```

### Erphpdown 插件 API Actions

| Action | 用途 | 参数 |
|--------|------|------|
| `epd_wppay` | 发起支付 | `post_id` |
| `epd_wppay_pay` | 查询支付状态 | `post_id`, `order_num` |
| `epd_see` | 查看/下载资源 | `post_id`, `vip`, `token` |
| `epd_check_pan` | 检测网盘链接 | `post_id`, `post_index` |
| `epd_vip_pay` | VIP购买 | `user_type` |
| `epd_activation_vip` | 激活VIP | `post_id` |
| `epd_index` | 首页购买 | `post_id`, `index_id`, `price` |
| `epd_checkin` | 签到 | - |
| `epd_promo` | 优惠码 | - |

### 关键 JavaScript 配置
```javascript
// _ERPHPDOWN 配置
{
  "uri": "https://tuyi.gmtaotu.net/wp-content/plugins/erphpdown",
  "payment": "1",
  "wppay": "scan",
  "tuan": "",
  "danmu": "0",
  "author": "mobantu"
}

// _ERPHP 配置
{
  "ajaxurl": "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php"
}

// _MBT (主题) 配置
{
  "uri": "https://tuyi.gmtaotu.net/wp-content/themes/modown",
  "admin_ajax": "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php",
  "erphpdown": "https://tuyi.gmtaotu.net/wp-content/plugins/erphpdown/"
}
```

---

## VIP 机制分析

### 权限控制流程
1. **前端检查**: 页面渲染时根据用户登录状态显示不同UI
2. **登录拦截**: 未登录用户点击"立即购买"弹出登录框
3. **权限验证**: 后端 API 验证用户 VIP 状态
4. **下载授权**: 仅 VIP 用户可获取百度网盘链接

### 绕过难度评估
| 检查点 | 位置 | 绕过难度 |
|--------|------|----------|
| 登录状态 | 后端 API | 高 - 需要有效账号 |
| VIP 权限 | 后端数据库 | 高 - 服务器端验证 |
| 下载链接 | 后端生成 | 高 - 动态生成 |

### 结论
**该站点采用标准的 WordPress + Erphpdown 付费下载方案，VIP 权限验证完全在服务器端进行，无法通过前端绕过。**

---

## 逆向尝试记录

### 已尝试方法
1. ✅ 页面结构分析 - 成功
2. ✅ API 端点识别 - 成功
3. ✅ JavaScript 源码分析 - 成功
4. ✅ API 权限测试 - 成功
5. ❌ 前端绕过 - 不可行 (权限验证在服务端)

### API 测试结果

#### epd_see (获取下载链接)
```bash
$ curl -X POST "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "action=epd_see&post_id=195908&vip=1&token="
```
**响应**: `{"status":202}`
**结论**: 权限不足，需要登录和 VIP 权限

#### epd_check_pan (检测网盘链接)
```bash
$ curl -X POST "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php" \
  -d "action=epd_check_pan&post_id=195908&post_index=0"
```
**响应**: `0`
**结论**: 无权限或参数错误

### 关键发现
- 下载链接通过 `epd_see` API 获取，需要有效的 `post_id` + `vip` + `token`
- Token 由后端生成，与 session 绑定
- 百度网盘链接不在页面源码中，完全由后端动态提供
- **解压密码 `gmtaotu.com` 直接暴露在页面源码中** (全站统一)

---

## 数据提取策略

### 可公开获取的数据
1. **文章列表**: 标题、缩略图、套图数量、大小
2. **预览图片**: 经过处理的预览图
3. **解压密码**: gmtaotu.com (全站统一)

### 需要 VIP 才能获取的数据
1. **百度网盘链接**: 真实下载地址
2. **提取码**: 网盘提取码

### 推荐爬取方案
```python
# 1. 列表页爬取
GET https://tuyi.gmtaotu.net/xiurenwang/xiuren/
# 提取: post_id, title, thumbnail, size, count

# 2. 详情页爬取
GET https://tuyi.gmtaotu.net/{post_id}/
# 提取: 套图数量、大小、解压密码、预览图

# 3. 下载链接获取 (需要 VIP Cookie)
POST https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php
Body: action=epd_see&post_id={id}&vip=1&token={token}
```

---

## 文件清单

| 文件 | 路径 | 说明 |
|------|------|------|
| 分析报告 | `E:\data\Github\PuchiPix\test\tuyi-gmtaotu-reverse-report.md` | 本报告 |
| Erphpdown JS | `E:\data\Github\PuchiPix\test\erphpdown.js` | 插件源码(格式化) |
| 截图 | 浏览器截图 | 页面状态记录 |

---

## 总结

### 站点架构
**WordPress + Modown主题 + Erphpdown插件** 的标准付费资源站架构

### VIP机制
- 服务器端权限验证，无法前端绕过
- 需要有效的 VIP 账号才能获取下载链接
- 下载链接动态生成，与 session 绑定

### 建议
1. 如需获取下载链接，需要购买 VIP 会员
2. 可爬取公开数据（标题、预览图、元信息）建立索引
3. 考虑使用 Playwright 模拟登录后的 VIP 用户行为

---

*报告生成时间: 2026-08-03*
*分析工具: js-reverse MCP*
