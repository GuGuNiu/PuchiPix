"""
基础爬虫类
定义所有爬虫的通用接口和基础功能
"""

import os
import re
import time
import threading
import queue
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import WebDriverException, TimeoutException
from bs4 import BeautifulSoup
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class BaseScraper(ABC):
    """基础爬虫抽象类"""
    
    def __init__(self, config=None):
        """初始化爬虫
        
        Args:
            config (dict): 爬虫配置
        """
        self.config = config or {}
        self.base_headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
        }
        self.session = self._create_session()
        self.driver = None
        self.stop_requested = False
        self.download_queue = queue.Queue()
        self.byte_counter_lock = threading.Lock()
        self.total_bytes_downloaded = 0
        
    def _create_session(self):
        """创建HTTP会话"""
        session = requests.Session()
        
        # 配置重试策略
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        session.headers.update(self.base_headers)
        
        return session
    
    def create_driver(self):
        """创建WebDriver实例"""
        try:
            from selenium.webdriver.chrome.service import Service as ChromeService
            from selenium.webdriver.chrome.options import Options
            from webdriver_manager.chrome import ChromeDriverManager
            
            chrome_options = Options()
            
            # 添加Chrome选项
            chrome_options.add_argument('--disable-blink-features=AutomationControlled')
            chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
            chrome_options.add_experimental_option('useAutomationExtension', False)
            
            # 设置ChromeDriver路径
            chromedriver_path = self.config.get('chromedriver_path', '')
            if chromedriver_path and os.path.exists(chromedriver_path):
                service = ChromeService(chromedriver_path)
            else:
                service = ChromeService(ChromeDriverManager().install())
            
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            
            # 设置超时
            self.driver.set_page_load_timeout(30)
            self.driver.implicitly_wait(10)
            
            return self.driver
        except Exception as e:
            print(f"创建WebDriver失败: {e}")
            return None
    
    def stop(self):
        """停止爬虫"""
        self.stop_requested = True
        if self.driver:
            try:
                self.driver.quit()
            except:
                pass
    
    @abstractmethod
    def get_site_name(self):
        """获取网站名称"""
        pass
    
    @abstractmethod
    def get_site_domain(self):
        """获取网站域名"""
        pass
    
    @abstractmethod
    def get_url_patterns(self):
        """获取URL匹配模式"""
        pass
    
    @abstractmethod
    def extract_gallery_id(self, url):
        """从URL中提取图库ID"""
        pass
    
    @abstractmethod
    def scrape_gallery(self, task_id, gallery_id, save_path, progress_callback=None):
        """爬取图库
        
        Args:
            task_id (str): 任务ID
            gallery_id (str): 图库ID
            save_path (str): 保存路径
            progress_callback (callable): 进度回调函数
            
        Returns:
            bool: 是否成功
        """
        pass
    
    def is_valid_url(self, url):
        """检查URL是否有效"""
        for pattern in self.get_url_patterns():
            if re.search(pattern, url):
                return True
        return False
    
    def update_progress(self, task_id, status=None, action=None, progress_text=None, progress_value=None, callback=None):
        """更新进度"""
        if callback:
            callback(task_id, status, action, progress_text, progress_value)
    
    def format_bytes(self, size):
        """格式化字节数"""
        if size < 1024: return f"{size} B"
        elif size < 1024**2: return f"{size/1024:.2f} KB"
        elif size < 1024**3: return f"{size/1024**2:.2f} MB"
        else: return f"{size/1024**3:.2f} GB"
    
    def sanitize_filename(self, filename):
        """清理文件名，移除非法字符"""
        return re.sub(r'[\\/*?:"<>|]', '', filename)
    
    def download_file(self, url, save_path, headers=None, resume=True):
        """下载文件
        
        Args:
            url (str): 文件URL
            save_path (str): 保存路径
            headers (dict): 请求头
            resume (bool): 是否支持断点续传
            
        Returns:
            bool: 是否成功
        """
        try:
            if self.stop_requested:
                return False
                
            # 合并请求头
            download_headers = self.base_headers.copy()
            if headers:
                download_headers.update(headers)
            
            # 检查是否已存在部分下载的文件
            existing_file = None
            ext = os.path.splitext(save_path)[1]
            if not ext:
                # 尝试从URL获取扩展名
                ext = os.path.splitext(url.split('?')[0])[1]
                if not ext:
                    ext = '.jpg'  # 默认扩展名
                save_path += ext
            
            if os.path.exists(save_path):
                existing_file = save_path
            
            # 如果存在已下载的文件，检查是否需要续传
            resume_header = {}
            initial_downloaded_size = 0
            if existing_file and resume:
                initial_downloaded_size = os.path.getsize(existing_file)
                resume_header['Range'] = f'bytes={initial_downloaded_size}-'
            
            # 合并请求头
            download_headers.update(resume_header)
            
            # 发送请求
            response = self.session.get(url, headers=download_headers, stream=True, timeout=30)
            response.raise_for_status()
            
            # 获取内容类型
            content_type = response.headers.get('content-type', '')
            
            # 如果是断点续传，使用追加模式
            mode = 'ab' if resume and existing_file else 'wb'
            
            # 下载文件
            with open(save_path, mode) as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if self.stop_requested:
                        return False
                    if chunk:
                        f.write(chunk)
                        with self.byte_counter_lock:
                            self.total_bytes_downloaded += len(chunk)
            
            return True
        except Exception as e:
            print(f"下载文件失败 {url}: {e}")
            return False
    
    def transcode_image(self, source_path, target_format):
        """转换图片格式"""
        try:
            from PIL import Image
        except ImportError:
            print("Pillow库未安装，无法转换图片格式")
            return source_path
        
        try:
            img = Image.open(source_path)
            base_path, ext = os.path.splitext(source_path)
            new_path = source_path
            
            if target_format.lower() == 'jpg':
                if img.mode in ('RGBA', 'LA', 'P'):
                    img = img.convert('RGB')
                new_path = base_path + '.jpg'
                img.save(new_path, 'jpeg', quality=95)
            elif target_format.lower() == 'png':
                new_path = base_path + '.png'
                img.save(new_path, 'png')
            
            # 如果新路径与原路径不同，删除原文件
            if new_path != source_path and os.path.exists(source_path):
                os.remove(source_path)
                
            return new_path
        except Exception as e:
            print(f"转换图片格式失败: {e}")
            return source_path
    
    def merge_ts_files_with_ffmpeg(self, ts_list_path, output_path):
        """使用FFmpeg合并TS文件
        
        Args:
            ts_list_path (str): TS文件列表路径
            output_path (str): 输出文件路径
            
        Returns:
            bool: 是否成功
        """
        try:
            ffmpeg_path = self.config.get('ffmpeg_path', 'ffmpeg')
            
            # 构建FFmpeg命令
            cmd = [
                ffmpeg_path,
                '-f', 'concat',
                '-safe', '0',
                '-i', ts_list_path,
                '-c', 'copy',
                '-y',  # 覆盖输出文件
                output_path
            ]
            
            # 执行命令
            import subprocess
            result = subprocess.run(cmd, capture_output=True, text=True)
            
            if result.returncode != 0:
                print(f"FFmpeg合并失败: {result.stderr}")
                return False
                
            return True
        except Exception as e:
            print(f"合并TS文件失败: {e}")
            return False