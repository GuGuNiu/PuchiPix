"""
爬虫管理器
负责管理和协调所有爬虫实例
"""

import os
import sys
import importlib
import inspect
import time
from typing import Dict, List, Optional, Type
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


class ScraperFileHandler(FileSystemEventHandler):
    """爬虫文件变更处理器"""
    
    def __init__(self, scraper_manager):
        self.scraper_manager = scraper_manager
        self.last_modified = {}
    
    def on_modified(self, event):
        """文件修改事件处理"""
        if event.is_directory:
            return
        
        # 只处理Python文件
        if not event.src_path.endswith('.py'):
            return
        
        # 防止重复处理
        current_time = time.time()
        if event.src_path in self.last_modified and current_time - self.last_modified[event.src_path] < 1:
            return
        
        self.last_modified[event.src_path] = current_time
        
        # 获取模块名
        module_name = os.path.basename(event.src_path)[:-3]
        if module_name.startswith('__'):
            return
        
        print(f"检测到爬虫文件变更: {module_name}")
        
        # 重新加载爬虫
        self.scraper_manager.reload_scraper(module_name)


class ScraperManager:
    """爬虫管理器类"""
    
    def __init__(self):
        """初始化爬虫管理器"""
        self.scrapers = {}  # 存储所有爬虫类
        self.scraper_instances = {}  # 存储爬虫实例
        self.scrapers_dir = os.path.dirname(os.path.abspath(__file__))
        self.observer = None
        self.load_scrapers()
        self.start_file_watcher()
    
    def start_file_watcher(self):
        """启动文件监控"""
        try:
            self.observer = Observer()
            self.observer.schedule(ScraperFileHandler(self), self.scrapers_dir, recursive=False)
            self.observer.start()
            print("爬虫文件监控已启动")
        except Exception as e:
            print(f"启动文件监控失败: {e}")
    
    def stop_file_watcher(self):
        """停止文件监控"""
        if self.observer:
            self.observer.stop()
            self.observer.join()
    
    def reload_scraper(self, module_name):
        """重新加载指定的爬虫模块"""
        try:
            # 如果模块已加载，先卸载
            if module_name in sys.modules:
                importlib.reload(sys.modules[f'scrapers.{module_name}'])
            
            # 重新加载爬虫
            self._load_scraper_module(module_name)
            print(f"已重新加载爬虫模块: {module_name}")
        except Exception as e:
            print(f"重新加载爬虫模块 {module_name} 失败: {e}")
    
    def _load_scraper_module(self, module_name):
        """加载单个爬虫模块"""
        try:
            # 动态导入模块
            module = importlib.import_module(f'scrapers.{module_name}')
            
            # 查找模块中的爬虫类
            for name, obj in inspect.getmembers(module):
                if (inspect.isclass(obj) and 
                    name != 'BaseScraper' and 
                    hasattr(obj, '__bases__') and 
                    any(base.__name__ == 'BaseScraper' for base in obj.__bases__)):
                    
                    # 创建爬虫实例并添加到字典
                    scraper_class = obj
                    scraper_instance = scraper_class()
                    site_name = scraper_instance.get_site_name()
                    
                    self.scrapers[site_name] = scraper_class
                    self.scraper_instances[site_name] = scraper_instance
                    
                    print(f"已加载爬虫: {site_name}")
        except Exception as e:
            print(f"加载爬虫模块 {module_name} 失败: {e}")
    
    def load_scrapers(self):
        """加载所有爬虫"""
        # 遍历scrapers目录中的所有Python文件
        for filename in os.listdir(self.scrapers_dir):
            if filename.endswith('.py') and not filename.startswith('__'):
                module_name = filename[:-3]
                self._load_scraper_module(module_name)
    
    def get_all_scrapers(self) -> List:
        """获取所有爬虫实例"""
        return list(self.scraper_instances.values())
    
    def get_all_site_names(self) -> List[str]:
        """获取所有网站名称"""
        return list(self.scrapers.keys())
    
    def get_scraper_by_site_name(self, site_name: str) -> Optional:
        """根据网站名称获取爬虫实例"""
        return self.scraper_instances.get(site_name)
    
    def get_scraper_by_url(self, url: str) -> Optional:
        """根据URL获取对应的爬虫实例"""
        for scraper in self.scraper_instances.values():
            if scraper.is_valid_url(url):
                return scraper
        return None
    
    def create_scraper_instance(self, site_name: str, config: Dict = None):
        """创建指定网站的爬虫实例
        
        Args:
            site_name (str): 网站名称
            config (dict): 配置信息
            
        Returns:
            BaseScraper: 爬虫实例
        """
        if site_name not in self.scrapers:
            return None
            
        scraper_class = self.scrapers[site_name]
        return scraper_class(config)
    
    def is_valid_gallery_url(self, url: str) -> bool:
        """检查URL是否为有效的图库URL"""
        return self.get_scraper_by_url(url) is not None
    
    def get_supported_sites(self) -> List[str]:
        """获取所有支持的网站列表"""
        return list(self.scrapers.keys())
    
    def get_site_name_by_url(self, url: str) -> Optional[str]:
        """根据URL获取网站名称"""
        scraper = self.get_scraper_by_url(url)
        if scraper:
            return scraper.get_site_name()
        return None


# 导入基础爬虫类
from .base_scraper import BaseScraper