#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
示例爬虫模块 - 展示如何为新网站创建爬虫

这个模块提供了一个示例实现，展示如何继承BaseScraper类来创建一个新的网站爬虫。
开发者可以参考这个模块来为其他网站创建爬虫。
"""

import os
import time
import re
import json
from typing import List, Dict, Any, Optional, Tuple
from urllib.parse import urljoin, urlparse

from .base_scraper import BaseScraper


class ExampleSiteScraper(BaseScraper):
    """
    示例网站爬虫
    
    这是一个示例爬虫实现，展示如何为新的网站创建爬虫。
    开发者可以参考这个实现来为其他网站创建爬虫。
    """
    
    def __init__(self):
        """初始化示例网站爬虫"""
        super().__init__()
        self.site_name = "ExampleSite"
        self.base_url = "https://example.com"
        self.supported_domains = ["example.com", "www.example.com"]
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Referer": self.base_url
        }
    
    def get_site_name(self) -> str:
        """返回网站名称"""
        return self.site_name
    
    def get_site_domains(self) -> List[str]:
        """返回支持的域名列表"""
        return self.supported_domains
    
    def get_site_domain(self) -> str:
        """返回主域名"""
        return self.supported_domains[0] if self.supported_domains else "example.com"
    
    def get_url_patterns(self) -> List[str]:
        """返回URL匹配模式"""
        return [
            r'https?://(?:www\.)?example\.com/(?:gallery|g)/\d+',
            r'https?://(?:www\.)?example\.com/\d+',
        ]
    
    def extract_gallery_id(self, url: str) -> Optional[str]:
        """
        从URL中提取图库ID
        
        Args:
            url: 图库URL
            
        Returns:
            图库ID，如果无法提取则返回None
        """
        try:
            # 示例URL格式: https://example.com/gallery/12345
            # 或者: https://example.com/g/12345
            pattern = r'(?:gallery|g)/(\d+)'
            match = re.search(pattern, url)
            if match:
                return match.group(1)
            return None
        except Exception as e:
            print(f"提取图库ID失败: {e}")
            return None
    
    def build_gallery_url(self, gallery_id: str) -> str:
        """
        构建图库URL
        
        Args:
            gallery_id: 图库ID
            
        Returns:
            图库URL
        """
        return f"{self.base_url}/gallery/{gallery_id}"
    
    def parse_page(self, driver) -> Dict[str, Any]:
        """
        解析页面内容，提取图片和视频URL
        
        Args:
            driver: WebDriver实例
            
        Returns:
            包含图片URL列表、视频URL列表和下一页URL的字典
        """
        result = {
            "image_urls": [],
            "video_urls": [],
            "next_page_url": None,
            "title": None,
            "description": None,
            "tags": []
        }
        
        try:
            # 获取页面标题
            try:
                title_element = driver.find_element("css selector", "h1.title, .gallery-title, #title")
                result["title"] = title_element.text.strip()
            except:
                result["title"] = "未知标题"
            
            # 获取页面描述
            try:
                desc_element = driver.find_element("css selector", ".description, .gallery-desc, #description")
                result["description"] = desc_element.text.strip()
            except:
                result["description"] = ""
            
            # 获取标签
            try:
                tag_elements = driver.find_elements("css selector", ".tag, .gallery-tag, .label")
                result["tags"] = [tag.text.strip() for tag in tag_elements if tag.text.strip()]
            except:
                result["tags"] = []
            
            # 提取图片URL
            # 这里使用多种选择器尝试匹配不同的图片容器
            image_selectors = [
                ".gallery img",
                ".image-container img",
                ".photo img",
                ".content img[src]",
                "img[data-src]",
                ".thumbnail img",
                "#gallery img"
            ]
            
            for selector in image_selectors:
                try:
                    images = driver.find_elements("css selector", selector)
                    for img in images:
                        src = img.get_attribute("src") or img.get_attribute("data-src")
                        if src and self._is_valid_image_url(src):
                            # 转换为绝对URL
                            absolute_url = urljoin(self.base_url, src)
                            if absolute_url not in result["image_urls"]:
                                result["image_urls"].append(absolute_url)
                except Exception as e:
                    print(f"使用选择器 {selector} 提取图片失败: {e}")
            
            # 提取视频URL
            video_selectors = [
                "video source",
                "video[src]",
                ".video-container video",
                ".player video"
            ]
            
            for selector in video_selectors:
                try:
                    videos = driver.find_elements("css selector", selector)
                    for video in videos:
                        src = video.get_attribute("src")
                        if src and self._is_valid_video_url(src):
                            # 转换为绝对URL
                            absolute_url = urljoin(self.base_url, src)
                            if absolute_url not in result["video_urls"]:
                                result["video_urls"].append(absolute_url)
                except Exception as e:
                    print(f"使用选择器 {selector} 提取视频失败: {e}")
            
            # 查找下一页链接
            try:
                next_selectors = [
                    ".next-page",
                    ".pagination .next",
                    "a.next",
                    ".pager-next",
                    "#next-page"
                ]
                
                for selector in next_selectors:
                    try:
                        next_element = driver.find_element("css selector", selector)
                        next_url = next_element.get_attribute("href")
                        if next_url:
                            result["next_page_url"] = urljoin(self.base_url, next_url)
                            break
                    except:
                        continue
            except:
                result["next_page_url"] = None
            
            # 打印提取结果用于调试
            print(f"提取结果: {len(result['image_urls'])} 张图片, {len(result['video_urls'])} 个视频")
            if result["next_page_url"]:
                print(f"找到下一页: {result['next_page_url']}")
            
            return result
        except Exception as e:
            print(f"解析页面失败: {e}")
            return result
    
    def _is_valid_image_url(self, url: str) -> bool:
        """检查URL是否是有效的图片URL"""
        if not url:
            return False
        
        # 检查文件扩展名
        image_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
        parsed = urlparse(url)
        path = parsed.path.lower()
        
        # 检查是否有图片扩展名
        for ext in image_extensions:
            if path.endswith(ext):
                return True
        
        # 检查URL中是否包含图片相关的参数
        if any(keyword in url.lower() for keyword in ['image', 'img', 'photo', 'pic']):
            return True
        
        return False
    
    def _is_valid_video_url(self, url: str) -> bool:
        """检查URL是否是有效的视频URL"""
        if not url:
            return False
        
        # 检查文件扩展名
        video_extensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv']
        parsed = urlparse(url)
        path = parsed.path.lower()
        
        # 检查是否有视频扩展名
        for ext in video_extensions:
            if path.endswith(ext):
                return True
        
        # 检查URL中是否包含视频相关的参数
        if any(keyword in url.lower() for keyword in ['video', 'movie', 'clip']):
            return True
        
        return False
    
    def get_file_name_from_url(self, url: str, index: int = 0) -> str:
        """
        从URL中提取文件名
        
        Args:
            url: 媒体文件URL
            index: 文件索引，用于生成唯一文件名
            
        Returns:
            文件名
        """
        try:
            parsed = urlparse(url)
            path = parsed.path
            
            # 尝试从路径中获取文件名
            filename = os.path.basename(path)
            
            # 如果文件名为空或无效，则生成一个
            if not filename or '.' not in filename:
                # 根据URL生成文件名
                url_hash = abs(hash(url)) % 10000
                if self._is_valid_image_url(url):
                    ext = ".jpg"
                else:
                    ext = ".mp4"
                filename = f"image_{url_hash}{ext}"
            
            # 添加索引以确保唯一性
            name, ext = os.path.splitext(filename)
            return f"{name}_{index}{ext}"
        except Exception as e:
            print(f"提取文件名失败: {e}")
            return f"file_{index}.jpg"
    
    def get_max_pages(self) -> int:
        """获取最大页数限制"""
        return 50  # 示例网站最多抓取50页
    
    def get_request_delay(self) -> float:
        """获取请求之间的延迟时间（秒）"""
        return 2.0  # 示例网站每次请求间隔2秒
    
    def scrape_gallery(self, task_id, gallery_id, save_path, progress_callback=None):
        """爬取图库
        
        Args:
            task_id (str): 任务ID
            gallery_id (str): 图库ID
            save_path (str): 保存路径
            progress_callback (callable): 进度回调函数
            
        Returns:
            dict: 爬取结果
        """
        try:
            # 创建WebDriver
            driver = self.create_driver()
            if not driver:
                return {
                    'success': False,
                    'message': '无法创建WebDriver实例'
                }
            
            # 构建图库URL
            gallery_url = self.build_gallery_url(gallery_id)
            
            # 更新进度
            self.update_progress(task_id, status="running", action="正在加载页面", 
                                progress_text="正在访问图库页面...", progress_value=0, callback=progress_callback)
            
            # 访问图库页面
            driver.get(gallery_url)
            
            # 解析页面内容
            page_data = self.parse_page(driver)
            
            # 创建保存目录
            os.makedirs(save_path, exist_ok=True)
            
            # 下载图片
            downloaded_count = 0
            total_count = len(page_data["image_urls"]) + len(page_data["video_urls"])
            
            if total_count == 0:
                return {
                    'success': False,
                    'message': '未找到任何图片或视频'
                }
            
            # 下载图片
            for i, img_url in enumerate(page_data["image_urls"]):
                if self.stop_requested:
                    break
                
                # 更新进度
                progress = int((i / total_count) * 100)
                self.update_progress(task_id, status="running", action="正在下载图片", 
                                    progress_text=f"正在下载图片 {i+1}/{len(page_data['image_urls'])}", 
                                    progress_value=progress, callback=progress_callback)
                
                # 获取文件名
                filename = self.get_file_name_from_url(img_url, i)
                file_path = os.path.join(save_path, filename)
                
                # 下载文件
                if self.download_file(img_url, file_path):
                    downloaded_count += 1
            
            # 下载视频
            video_offset = len(page_data["image_urls"])
            for i, video_url in enumerate(page_data["video_urls"]):
                if self.stop_requested:
                    break
                
                # 更新进度
                progress = int(((video_offset + i) / total_count) * 100)
                self.update_progress(task_id, status="running", action="正在下载视频", 
                                    progress_text=f"正在下载视频 {i+1}/{len(page_data['video_urls'])}", 
                                    progress_value=progress, callback=progress_callback)
                
                # 获取文件名
                filename = self.get_file_name_from_url(video_url, video_offset + i)
                file_path = os.path.join(save_path, filename)
                
                # 下载文件
                if self.download_file(video_url, file_path):
                    downloaded_count += 1
            
            # 关闭浏览器
            driver.quit()
            
            # 返回结果
            return {
                'success': True,
                'downloaded_count': downloaded_count,
                'total_count': total_count,
                'message': f'成功下载 {downloaded_count} 个文件'
            }
            
        except Exception as e:
            return {
                'success': False,
                'message': f'爬取图库失败: {str(e)}'
            }


# 注册爬虫类
def get_scraper_class():
    """返回爬虫类，供爬虫管理器使用"""
    return ExampleSiteScraper


# 爬虫信息
def get_scraper_info():
    """返回爬虫信息，供爬虫管理器使用"""
    return {
        "name": "ExampleSite",
        "domains": ["example.com", "www.example.com"],
        "description": "示例网站爬虫，展示如何实现新网站的爬虫",
        "version": "1.0.0",
        "author": "PuchiPix Team"
    }