# tuyi.gmtaotu.net API 测试代码片段

## 基础信息
- **AJAX 端点**: `https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php`
- **Post ID 示例**: `195908`
- **解压密码**: `gmtaotu.com`

---

## 1. 测试 epd_see API (获取下载链接)

### cURL 命令
```bash
curl -X POST "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Referer: https://tuyi.gmtaotu.net/195908/" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d "action=epd_see&post_id=195908&vip=1&token=" \
  -v
```

### Python (requests)
```python
import requests

url = "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php"
headers = {
    "Referer": "https://tuyi.gmtaotu.net/195908/",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}
data = {
    "action": "epd_see",
    "post_id": "195908",
    "vip": "1",
    "token": ""  # 需要从页面获取
}

response = requests.post(url, headers=headers, data=data)
print(response.json())
```

### 预期响应
```json
// 未登录/无权限
{
  "status": 202,
  "msg": "抱歉，权限不足！"
}

// 次数用完
{
  "status": 0,
  "msg": "查看失败，请检查今天的查看次数是否已用光！"
}

// 成功 (推测)
{
  "status": 200,
  "url": "https://pan.baidu.com/s/xxxx",
  "code": "提取码"
}
```

---

## 2. 测试 epd_check_pan API (检测网盘链接)

### cURL 命令
```bash
curl -X POST "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Referer: https://tuyi.gmtaotu.net/195908/" \
  -d "action=epd_check_pan&post_id=195908&post_index=0" \
  -v
```

### Python
```python
import requests

url = "https://tuyi.gmtaotu.net/wp-admin/admin-ajax.php"
data = {
    "action": "epd_check_pan",
    "post_id": "195908",
    "post_index": "0"
}

response = requests.post(url, data=data)
print(response.json())
```

---

## 3. 获取页面 Token

### Python (BeautifulSoup)
```python
from bs4 import BeautifulSoup
import requests
import re

url = "https://tuyi.gmtaotu.net/195908/"
response = requests.get(url)
soup = BeautifulSoup(response.text, 'html.parser')

# 查找包含 token 的脚本
scripts = soup.find_all('script')
for script in scripts:
    if script.string and 'token' in script.string:
        # 提取 token
        token_match = re.search(r'token["\']?\s*[:=]\s*["\']([^"\']+)', script.string)
        if token_match:
            print(f"Token: {token_match.group(1)}")

# 或者查找 data-token 属性
token_elements = soup.find_all(attrs={"data-token": True})
for el in token_elements:
    print(f"Token: {el['data-token']}")
```

---

## 4. 爬取文章列表

### Python
```python
import requests
from bs4 import BeautifulSoup

def get_post_list(category_url):
    """获取文章列表"""
    response = requests.get(category_url)
    soup = BeautifulSoup(response.text, 'html.parser')
    
    posts = []
    for post in soup.select('.post.grid'):
        post_id = post.get('data-id')
        link = post.select_one('a[href]')
        img = post.select_one('img')
        
        posts.append({
            'id': post_id,
            'url': link['href'] if link else None,
            'title': link['title'] if link else None,
            'thumbnail': img['src'] if img else None
        })
    
    return posts

# 使用示例
posts = get_post_list("https://tuyi.gmtaotu.net/xiurenwang/xiuren/")
for post in posts[:5]:
    print(f"ID: {post['id']}, Title: {post['title']}")
```

---

## 5. 爬取详情页元数据

### Python
```python
import requests
from bs4 import BeautifulSoup
import re

def get_post_detail(post_url):
    """获取文章详情"""
    response = requests.get(post_url)
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # 提取表格数据
    detail = {}
    table = soup.find('table')
    if table:
        for row in table.find_all('tr'):
            cells = row.find_all('td')
            if len(cells) >= 2:
                key = cells[0].text.strip()
                value = cells[1].text.strip()
                detail[key] = value
    
    # 提取解压密码
    tips = soup.select_one('.erphpdown-box .tips2')
    if tips:
        password_match = re.search(r'解压密码[：:]\s*(\S+)', tips.text)
        if password_match:
            detail['password'] = password_match.group(1)
    
    # 提取预览图
    images = []
    for img in soup.select('.entry-content img'):
        images.append(img.get('src'))
    
    return {
        'detail': detail,
        'images': images,
        'download_box': soup.select_one('.erphpdown-box') is not None
    }

# 使用示例
detail = get_post_detail("https://tuyi.gmtaotu.net/195908/")
print(detail)
```

---

## 6. 使用 Playwright 模拟 VIP 用户

### Python
```python
from playwright.sync_api import sync_playwright

def get_download_link_with_vip(post_url, username, password):
    """使用 VIP 账号获取下载链接"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        
        # 登录
        page.goto("https://tuyi.gmtaotu.net/wp-login.php")
        page.fill('#user_login', username)
        page.fill('#user_pass', password)
        page.click('#wp-submit')
        
        # 等待登录完成
        page.wait_for_load_state('networkidle')
        
        # 访问详情页
        page.goto(post_url)
        
        # 点击下载按钮
        with page.expect_response(lambda r: 'admin-ajax.php' in r.url and 'epd_see' in r.request.post_data) as response_info:
            page.click('.erphpdown-see-btn, .down')
        
        response = response_info.value
        data = response.json()
        
        browser.close()
        return data

# 使用示例 (需要有效的 VIP 账号)
# result = get_download_link_with_vip("https://tuyi.gmtaotu.net/195908/", "username", "password")
# print(result)
```

---

## 注意事项

1. **Cookie 要求**: 所有下载相关 API 都需要有效的登录 Cookie
2. **Token 机制**: `epd_see` 需要有效的 token，token 与 session 绑定
3. **频率限制**: 注意控制请求频率，避免被封禁
4. **VIP 验证**: 服务器端严格验证 VIP 状态，无法绕过

---

## 响应状态码说明

| Status | 含义 |
|--------|------|
| 200 | 成功 |
| 202 | 权限不足 |
| 500 | 服务器错误/检测失败 |
| 0 | 其他错误 (如次数用完) |

---

*生成时间: 2026-08-03*
