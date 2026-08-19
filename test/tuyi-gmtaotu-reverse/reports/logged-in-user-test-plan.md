# 已登录用户测试方案 (tuyi.gmtaotu.net)

## 测试账户信息
- **用户名**: ASD21234
- **密码**: aczw2e1233412312312
- **状态**: 非VIP (普通用户)

---

## 测试目标
1. 测试非VIP用户能获取哪些数据
2. 测试下载按钮点击后的行为
3. 测试是否有其他绕过方式
4. 测试 API 响应差异

---

## 测试步骤

### 步骤 1: 登录状态检查
```javascript
// 在浏览器控制台执行
() => {
  return {
    isLoggedIn: document.body.classList.contains('logged-in'),
    userMenu: document.querySelector('.user-menu, .personal-center')?.textContent,
    vipBadge: document.querySelector('.vip-badge, .vip-icon')?.textContent,
    cookies: document.cookie.split(';').map(c => c.trim().split('=')[0])
  };
}
```

### 步骤 2: 检查资源下载容器 (已登录状态)
```javascript
// 查看已登录用户的下载容器
() => {
  const box = document.querySelector('.erphpdown-box');
  return {
    html: box?.outerHTML,
    price: box?.querySelector('.erphpdown-price')?.textContent,
    buttonText: box?.querySelector('.down, .erphpdown-see-btn')?.textContent,
    buttonClass: box?.querySelector('.down, .erphpdown-see-btn')?.className,
    vipOnly: box?.querySelector('.vip-only')?.textContent
  };
}
```

### 步骤 3: 点击下载按钮并捕获请求
```javascript
// 设置 XHR 断点
// 使用 js-reverse_break_on_xhr("admin-ajax.php")
// 然后点击下载按钮
```

### 步骤 4: 测试 epd_see API (已登录)
```javascript
// 在已登录页面执行
() => {
  return fetch('https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: 'action=epd_see&post_id=195908&vip=1&token='
  }).then(r => r.json());
}
```

### 步骤 5: 查找页面中的 Token
```javascript
// 查找 epd_see 需要的 token
() => {
  const scripts = document.querySelectorAll('script');
  const tokens = [];
  scripts.forEach(s => {
    if (s.textContent.includes('token')) {
      const match = s.textContent.match(/token["\']?\s*[:=]\s*["\']([^"\']+)/);
      if (match) tokens.push(match[1]);
    }
  });
  
  // 查找 data-token 属性
  const elements = document.querySelectorAll('[data-token]');
  elements.forEach(el => tokens.push(el.dataset.token));
  
  return tokens;
}
```

### 步骤 6: 检查是否有其他下载按钮
```javascript
// 查找所有可能的下载相关元素
() => {
  const selectors = [
    '.erphpdown-see-btn',
    '.erphpdown-download-btn',
    '.down',
    '[class*="download"]',
    '[class*="vip"]',
    'a[href*="pan.baidu"]',
    'a[href*="download"]'
  ];
  
  const results = {};
  selectors.forEach(sel => {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) {
      results[sel] = Array.from(els).map(el => ({
        text: el.textContent?.trim(),
        href: el.href,
        className: el.className,
        dataset: Object.entries(el.dataset)
      }));
    }
  });
  
  return results;
}
```

---

## 预期测试结果

### 非VIP用户预期行为
1. **下载容器显示**: "VIP专享" + "升级VIP" 按钮
2. **点击下载按钮**: 弹出提示 "仅限VIP下载" 或跳转到充值页面
3. **epd_see API**: 返回 `{"status":202}` 或类似权限不足的错误
4. **无百度网盘链接**: 页面源码中不包含网盘URL

### 可能的发现
- 某些资源可能有 "免费试看" 或 "限时免费"
- 可能有 "积分下载" 而非纯VIP限制
- 可能有其他隐藏的下载入口

---

## 绕过测试清单

### 已测试 (不可行)
- [x] 直接调用 epd_see API (无 Cookie) → 返回 202
- [x] 访问 buy.php (无登录) → 显示 "请先登录"
- [x] REST API 获取内容 → 无网盘链接

### 待测试 (已登录)
- [ ] 调用 epd_see API (有 Cookie)
- [ ] 检查是否有积分系统
- [ ] 检查是否有其他下载方式
- [ ] 检查页面是否有隐藏数据

---

## 如果非VIP无法获取链接

### 替代方案
1. **爬取元数据**: 标题、预览图、大小、解压密码
2. **监控新资源**: 第一时间获取资源信息
3. **批量索引**: 建立完整资源数据库

---

## 测试记录

### 测试时间: 2026-08-03
### 测试账户: ASD21234 (非VIP)
### 测试结果: 待填写...

---

*测试计划生成时间: 2026-08-03*
