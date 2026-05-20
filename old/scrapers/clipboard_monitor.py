#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
剪贴板监控模块
负责监控剪贴板内容变化，自动识别URL并分配到对应的爬虫模块
"""

import time
import threading
import queue
from typing import Dict, List, Optional, Callable, Any
from urllib.parse import urlparse


class ClipboardMonitor:
    """剪贴板监控器"""
    
    def __init__(self, scraper_manager, callback: Optional[Callable] = None):
        """初始化剪贴板监控器
        
        Args:
            scraper_manager: 爬虫管理器实例
            callback: 回调函数，当检测到有效URL时调用
        """
        self.scraper_manager = scraper_manager
        self.callback = callback
        self.monitoring = False
        self.monitor_thread = None
        self.last_clipboard = ""
        self.clipboard_queue = queue.Queue()
        self.pyperclip_available = self._check_pyperclip()
        
    def _check_pyperclip(self) -> bool:
        """检查pyperclip是否可用"""
        try:
            import pyperclip
            return True
        except ImportError:
            print("警告: pyperclip未安装，剪贴板监控功能不可用")
            return False
    
    def start_monitoring(self):
        """开始监控剪贴板"""
        if not self.pyperclip_available:
            return False
            
        if self.monitoring:
            return True
            
        self.monitoring = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        print("剪贴板监控已启动")
        return True
    
    def stop_monitoring(self):
        """停止监控剪贴板"""
        self.monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=1)
        print("剪贴板监控已停止")
    
    def _monitor_loop(self):
        """监控循环"""
        import pyperclip
        
        while self.monitoring:
            try:
                # 获取当前剪贴板内容
                current_clipboard = pyperclip.paste()
                
                # 检查内容是否变化
                if current_clipboard != self.last_clipboard and current_clipboard.strip():
                    self.last_clipboard = current_clipboard
                    
                    # 检查是否是URL
                    if self._is_url(current_clipboard):
                        # 检查是否是支持的图库URL
                        site_name = self.scraper_manager.get_site_name_by_url(current_clipboard)
                        if site_name:
                            print(f"检测到有效图库URL: {current_clipboard} (网站: {site_name})")
                            
                            # 将URL放入队列
                            self.clipboard_queue.put({
                                'url': current_clipboard,
                                'site_name': site_name,
                                'timestamp': time.time()
                            })
                            
                            # 调用回调函数
                            if self.callback:
                                self.callback(current_clipboard, site_name)
                
                # 休眠一段时间，减少CPU使用率
                time.sleep(1)
                
            except Exception as e:
                print(f"剪贴板监控错误: {e}")
                time.sleep(5)  # 出错后等待5秒再继续
    
    def _is_url(self, text: str) -> bool:
        """检查文本是否是URL"""
        try:
            result = urlparse(text.strip())
            return all([result.scheme, result.netloc])
        except:
            return False
    
    def set_callback(self, callback: Callable):
        """设置回调函数
        
        Args:
            callback: 回调函数，当检测到有效URL时调用
        """
        self.callback = callback
    
    def check_clipboard(self):
        """检查剪贴板内容（非线程阻塞方式）"""
        if not self.pyperclip_available:
            return
            
        try:
            import pyperclip
            
            # 获取当前剪贴板内容
            current_clipboard = pyperclip.paste()
            
            # 检查内容是否变化
            if current_clipboard != self.last_clipboard and current_clipboard.strip():
                self.last_clipboard = current_clipboard
                
                # 检查是否是URL
                if self._is_url(current_clipboard):
                    # 检查是否是支持的图库URL
                    site_name = self.scraper_manager.get_site_name_by_url(current_clipboard)
                    if site_name:
                        print(f"检测到有效图库URL: {current_clipboard} (网站: {site_name})")
                        
                        # 将URL放入队列
                        self.clipboard_queue.put({
                            'url': current_clipboard,
                            'site_name': site_name,
                            'timestamp': time.time()
                        })
                        
                        # 调用回调函数
                        if self.callback:
                            self.callback(current_clipboard, site_name)
        
        except Exception as e:
            print(f"剪贴板检查错误: {e}")
    
    def get_pending_urls(self) -> List[Dict[str, Any]]:
        """获取待处理的URL列表"""
        urls = []
        while not self.clipboard_queue.empty():
            try:
                urls.append(self.clipboard_queue.get_nowait())
            except queue.Empty:
                break
        return urls
    
    def clear_pending_urls(self):
        """清空待处理的URL列表"""
        while not self.clipboard_queue.empty():
            try:
                self.clipboard_queue.get_nowait()
            except queue.Empty:
                break