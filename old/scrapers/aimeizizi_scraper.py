"""
爱妹子站点爬虫
"""

import os
import re
import time
import shutil
from urllib.parse import urljoin
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import WebDriverException, TimeoutException
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

from .base_scraper import BaseScraper


class AimeiziziScraper(BaseScraper):
    """爱妹子站点爬虫"""
    
    def __init__(self, config=None):
        """初始化爱妹子爬虫"""
        super().__init__(config)
        self.base_domain = "https://xx.knit.bid"
    
    def get_site_name(self):
        """获取网站名称"""
        return "爱妹子"
    
    def get_site_domain(self):
        """获取网站域名"""
        return self.base_domain
    
    def get_url_patterns(self):
        """获取URL匹配模式"""
        return [
            r'https?://xx\.knit\.bid/article/\d+',
            r'^\d+$'  # 纯数字ID
        ]
    
    def extract_gallery_id(self, url):
        """从URL中提取图库ID"""
        # 如果是纯数字ID
        if re.match(r'^\d+$', url):
            return url
        
        # 从URL中提取ID
        match = re.search(r'xx\.knit\.bid/article/(\d+)', url)
        if match:
            return match.group(1)
        
        return None
    
    def scrape_gallery(self, task_id, gallery_id, save_path, progress_callback=None):
        """爬取图库"""
        try:
            if self.stop_requested:
                return False
                
            base_url = f"{self.base_domain}/article/{gallery_id}/"
            self.update_progress(task_id, status="⚙️ 解析中", action="解析中...", callback=progress_callback)
            
            # 创建WebDriver
            if not self.driver:
                if not self.create_driver():
                    self.update_progress(task_id, status="❌", action="创建WebDriver失败", callback=progress_callback)
                    return False
            
            # 访问页面
            self.driver.get(base_url)
            WebDriverWait(self.driver, 25).until(EC.presence_of_element_located((By.CSS_SELECTOR, "h1.focusbox-title")))
            
            if self.stop_requested:
                return False
            
            # 解析页面内容
            soup = BeautifulSoup(self.driver.page_source, 'html.parser')
            title = soup.find('h1', class_='focusbox-title').get_text().strip()
            valid_title = self.sanitize_filename(title)
            gallery_path = os.path.join(save_path, valid_title)
            os.makedirs(gallery_path, exist_ok=True)
            
            # 提取标签
            tags_elements = soup.find('div', class_='article-tags')
            tags = [a.get_text() for a in tags_elements.find_all('a')] if tags_elements else []
            
            # 收集所有图片和视频URL
            image_urls, video_urls = set(), set()
            page_urls_tuples = []
            
            # 检查是否有分页
            if pagination_container := soup.find('div', class_='pagination-container'):
                for link in pagination_container.select('a[data-page]'):
                    if (page_num_str := link.get('data-page')) and page_num_str.isdigit():
                        page_urls_tuples.append((int(page_num_str), f"{base_url}page/{page_num_str}/"))
            
            # 排序分页URL
            page_urls_tuples.sort()
            sorted_urls = [base_url] + [url for _, url in page_urls_tuples]
            
            # 解析所有页面
            for i, url in enumerate(sorted_urls):
                if self.stop_requested:
                    return False
                    
                if i != 0:
                    self.driver.get(url)
                    WebDriverWait(self.driver, 15).until(EC.presence_of_element_located((By.CSS_SELECTOR, "article.article-content")))
                
                if self.stop_requested:
                    return False
                
                # 解析页面内容
                page_soup = BeautifulSoup(self.driver.page_source, 'html.parser')
                
                # 提取视频URL
                if video_source := page_soup.select_one('video > source[src*=".m3u8"]'):
                    video_urls.add(urljoin(self.base_domain, video_source['src']))
                
                # 提取图片URL
                for img in page_soup.select('article.article-content img[data-src]'):
                    if '/static/images/' in img['data-src']:
                        image_urls.add(urljoin(self.base_domain, img['data-src']))
                
                # 更新解析进度
                progress_value = (i + 1) / len(sorted_urls) * 100
                self.update_progress(task_id, progress_value=progress_value, callback=progress_callback)
            
            if not video_urls and not image_urls:
                self.update_progress(task_id, status="❌", action="未找到任何图片或视频", callback=progress_callback)
                return False
            
            # 准备下载任务
            all_downloads = []
            video_segment_map = {}
            temp_dir = None
            
            # 处理视频下载
            if video_urls and self.config.get('download_video', False):
                video_url = list(video_urls)[0]
                temp_dir = os.path.join(gallery_path, f"temp_{int(time.time())}")
                os.makedirs(temp_dir, exist_ok=True)
                
                # 获取M3U8内容
                download_headers = self.base_headers.copy()
                download_headers['Referer'] = base_url
                m3u8_content = self.session.get(video_url, headers=download_headers, timeout=15).text
                
                # 解析TS文件URL
                ts_urls = [urljoin(video_url, line.strip()) for line in m3u8_content.split('\n') if line and not line.startswith('#')]
                video_segment_map['output_path'] = os.path.join(gallery_path, f"{valid_title}.mp4")
                video_segment_map['ts_paths'] = []
                
                for i, ts_url in enumerate(ts_urls):
                    ts_path = os.path.join(temp_dir, f"{i:05d}.ts")
                    all_downloads.append({'url': ts_url, 'path': ts_path, 'is_video': True})
                    video_segment_map['ts_paths'].append(ts_path)
            
            # 处理图片下载
            rename_format = self.config.get('rename_format', '{id}_{num}')
            for i, img_url in enumerate(sorted(list(image_urls))):
                filename_base = rename_format.format(id=gallery_id, num=f"{i+1:03d}", title=valid_title)
                
                # 根据保存格式设置文件扩展名
                save_format = self.config.get('save_format', '原始格式')
                if save_format == 'JPG':
                    ext = '.jpg'
                elif save_format == 'PNG':
                    ext = '.png'
                else:
                    # 使用原始格式
                    ext = os.path.splitext(img_url.split('?')[0])[1]
                    if not ext:
                        ext = '.jpg'
                
                full_path = os.path.join(gallery_path, filename_base + ext)
                all_downloads.append({'url': img_url, 'path': full_path, 'is_video': False})
            
            # 开始下载
            total_downloads = len(all_downloads)
            completed_count = 0
            
            self.update_progress(task_id, status="⚙️ 下载中", action="下载中...", progress_text=f"0/{total_downloads}", callback=progress_callback)
            
            # 使用多线程下载
            threads = self.config.get('threads', 4)
            download_headers = self.base_headers.copy()
            download_headers['Referer'] = base_url
            
            with ThreadPoolExecutor(max_workers=threads) as executor:
                for result in executor.map(self._download_task_wrapper, all_downloads, [download_headers]*len(all_downloads)):
                    if self.stop_requested:
                        break
                    if result:
                        completed_count += 1
                        self.update_progress(
                            task_id, 
                            progress_text=f"{completed_count}/{total_downloads}",
                            progress_value=(completed_count / total_downloads) * 100 if total_downloads > 0 else 0,
                            callback=progress_callback
                        )
            
            # 合并视频
            if video_segment_map and not self.stop_requested:
                self.update_progress(task_id, status="⚙️ 合并中", action="合并视频...", callback=progress_callback)
                ts_list_path = os.path.join(temp_dir, "filelist.txt")
                with open(ts_list_path, 'w', encoding='utf-8') as f:
                    for ts_path in video_segment_map['ts_paths']:
                        f.write(f"file '{os.path.abspath(ts_path)}'\n")
                
                if not self.merge_ts_files_with_ffmpeg(ts_list_path, video_segment_map['output_path']):
                    completed_count -= len(video_segment_map['ts_paths'])
            
            # 清理临时目录
            if temp_dir and os.path.exists(temp_dir):
                shutil.rmtree(temp_dir)
            
            if self.stop_requested:
                return False
            
            # 保存历史记录
            if completed_count > 0:
                # 这里应该调用主应用的历史记录保存方法
                # save_history({
                #     "id": gallery_id, 
                #     "title": valid_title, 
                #     "tags": ", ".join(tags), 
                #     "path": gallery_path, 
                #     "total_count": total_downloads, 
                #     "completed_count": completed_count, 
                #     "image_count": len(image_urls), 
                #     "video_count": len(video_urls),
                #     "site": self.get_site_name()
                # })
                pass
            
            return completed_count > 0
            
        except WebDriverException as e:
            self.update_progress(task_id, status="❌", action=f"WebDriver错误: {str(e)}", callback=progress_callback)
            return False
        except TimeoutException as e:
            self.update_progress(task_id, status="❌", action=f"超时错误: {str(e)}", callback=progress_callback)
            return False
        except Exception as e:
            self.update_progress(task_id, status="❌", action=f"未知错误: {str(e)}", callback=progress_callback)
            return False
    
    def _download_task_wrapper(self, task, headers):
        """下载任务包装器"""
        url, path, is_video = task['url'], task['path'], task.get('is_video', False)
        
        # 下载文件
        success = self.download_file(url, path, headers)
        
        if success and not is_video:
            # 转换图片格式
            save_format = self.config.get('save_format', '原始格式')
            if save_format != '原始格式':
                path = self.transcode_image(path, save_format)
        
        return success