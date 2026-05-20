# PuchiPix 爬虫扩展指南

本指南将帮助您为PuchiPix添加新网站的爬虫支持。

## 目录结构

```
PuchiPix/
├── main.py                 # 主应用程序入口
├── web_app.py             # Web API服务
├── scrapers/              # 爬虫模块目录
│   ├── __init__.py        # 包初始化文件
│   ├── base_scraper.py    # 基础爬虫类
│   ├── scraper_manager.py # 爬虫管理器
│   ├── current_site_scraper.py  # 当前网站爬虫
│   └── example_site_scraper.py  # 示例爬虫（参考）
```

## 创建新爬虫的步骤

### 1. 创建爬虫模块文件

在`scrapers`目录下创建一个新的Python文件，命名为`{site_name}_scraper.py`，例如`pixiv_scraper.py`。

### 2. 实现爬虫类

创建一个继承自`BaseScraper`的爬虫类，并实现所有必需的抽象方法。您可以参考`example_site_scraper.py`文件。

```python
from .base_scraper import BaseScraper

class PixivScraper(BaseScraper):
    def __init__(self):
        super().__init__()
        self.site_name = "Pixiv"
        self.base_url = "https://www.pixiv.net"
        self.supported_domains = ["pixiv.net", "www.pixiv.net"]
        # 其他初始化代码...
    
    # 实现所有必需的抽象方法
    def get_site_name(self) -> str:
        return self.site_name
    
    def get_site_domains(self) -> List[str]:
        return self.supported_domains
    
    def extract_gallery_id(self, url: str) -> Optional[str]:
        # 实现从URL提取图库ID的逻辑
        pass
    
    def build_gallery_url(self, gallery_id: str) -> str:
        # 实现构建图库URL的逻辑
        pass
    
    def parse_page(self, driver) -> Dict[str, Any]:
        # 实现解析页面内容，提取图片和视频URL的逻辑
        pass
```

### 3. 实现必需的方法

您必须实现以下方法：

- `get_site_name()`: 返回网站名称
- `get_site_domains()`: 返回支持的域名列表
- `extract_gallery_id(url)`: 从URL中提取图库ID
- `build_gallery_url(gallery_id)`: 构建图库URL
- `parse_page(driver)`: 解析页面内容，提取媒体URL

### 4. 添加导出函数

在文件末尾添加两个导出函数：

```python
def get_scraper_class():
    """返回爬虫类，供爬虫管理器使用"""
    return PixivScraper

def get_scraper_info():
    """返回爬虫信息，供爬虫管理器使用"""
    return {
        "name": "Pixiv",
        "domains": ["pixiv.net", "www.pixiv.net"],
        "description": "Pixiv网站爬虫",
        "version": "1.0.0",
        "author": "Your Name"
    }
```

### 5. 测试爬虫

创建完成后，您可以通过以下方式测试爬虫：

1. 在主应用程序中测试
2. 使用Web API测试
3. 创建单元测试

## 爬虫开发技巧

### 1. 页面解析

- 使用多种CSS选择器来适应不同的页面结构
- 考虑使用XPath作为备选方案
- 处理动态加载的内容

```python
# 使用多种选择器尝试匹配
image_selectors = [
    ".gallery img",
    ".image-container img",
    ".content img[src]",
    "img[data-src]"
]

for selector in image_selectors:
    try:
        images = driver.find_elements("css selector", selector)
        # 处理找到的图片...
        if images:
            break  # 找到图片后停止尝试其他选择器
    except:
        continue
```

### 2. URL处理

- 使用`urljoin`将相对URL转换为绝对URL
- 验证URL的有效性
- 处理特殊字符和编码

```python
from urllib.parse import urljoin, urlparse

# 转换为绝对URL
absolute_url = urljoin(self.base_url, relative_url)

# 验证URL有效性
if self._is_valid_image_url(absolute_url):
    # 处理有效URL...
```

### 3. 错误处理

- 添加适当的错误处理和日志记录
- 使用try-except块处理可能失败的操作
- 提供有意义的错误消息

```python
try:
    # 可能失败的操作
    title_element = driver.find_element("css selector", "h1.title")
    title = title_element.text.strip()
except Exception as e:
    print(f"获取标题失败: {e}")
    title = "未知标题"
```

### 4. 性能优化

- 设置适当的请求延迟
- 限制最大页数
- 使用缓存避免重复请求

```python
def get_request_delay(self) -> float:
    """获取请求之间的延迟时间（秒）"""
    return 2.0  # 每次请求间隔2秒

def get_max_pages(self) -> int:
    """获取最大页数限制"""
    return 50  # 最多抓取50页
```

### 5. 登录和认证

如果网站需要登录：

```python
def login(self, driver, username, password):
    """实现登录逻辑"""
    driver.get(f"{self.base_url}/login")
    
    # 输入用户名和密码
    username_field = driver.find_element("id", "username")
    password_field = driver.find_element("id", "password")
    
    username_field.send_keys(username)
    password_field.send_keys(password)
    
    # 点击登录按钮
    login_button = driver.find_element("id", "login-button")
    login_button.click()
    
    # 等待登录完成
    time.sleep(3)
```

## 常见问题

### 1. 如何处理反爬虫机制？

- 使用真实的User-Agent
- 设置适当的请求延迟
- 考虑使用代理IP
- 模拟人类行为

### 2. 如何处理动态加载的内容？

- 使用WebDriverWait等待元素加载
- 执行JavaScript获取动态内容
- 滚动页面以触发懒加载

```python
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# 等待元素加载
wait = WebDriverWait(driver, 10)
element = wait.until(EC.presence_of_element_located(("css selector", ".gallery img")))

# 滚动页面
driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
time.sleep(2)  # 等待内容加载
```

### 3. 如何处理分页？

- 识别下一页链接
- 限制最大页数
- 处理无限滚动

```python
def parse_page(self, driver):
    # ... 其他代码 ...
    
    # 查找下一页链接
    try:
        next_element = driver.find_element("css selector", ".next-page")
        next_url = next_element.get_attribute("href")
        if next_url:
            result["next_page_url"] = urljoin(self.base_url, next_url)
    except:
        result["next_page_url"] = None
    
    return result
```

## 提交您的爬虫

完成爬虫开发后，您可以：

1. 将代码提交到PuchiPix项目
2. 创建Pull Request
3. 分享您的爬虫模块

## 示例爬虫

请参考`example_site_scraper.py`文件，它提供了一个完整的爬虫实现示例。

## 获取帮助

如果您在开发过程中遇到问题，可以：

1. 查看现有爬虫的实现
2. 参考Selenium和Python文档
3. 在项目Issues中提问

---

感谢您为PuchiPix项目做出贡献！