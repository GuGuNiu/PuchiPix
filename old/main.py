"""
PuchiPix 主入口文件
支持多个网站爬虫获取资源的程序
"""

import os
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog
import ttkbootstrap as ttk
from ttkbootstrap.constants import *
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import threading
import re
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import deque
import time
import subprocess
import shutil
import random
import webbrowser
import psutil
import queue

# 导入爬虫管理器
from scrapers.scraper_manager import ScraperManager
# 导入剪贴板监控模块
from scrapers.clipboard_monitor import ClipboardMonitor

try:
    # 尝试从run.py导入路径（打包后）
    from run import HISTORY_FILE, CONFIG_FILE, FAILED_TASKS_FILE, TASK_STATE_FILE
except ImportError:
    # 开发环境中使用相对路径
    HISTORY_FILE = 'history.json'
    CONFIG_FILE = 'config.json'
    FAILED_TASKS_FILE = 'failed_tasks.txt'
    TASK_STATE_FILE = 'task_state.json'


class MultiScraperApp:
    """多爬虫应用程序主类"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("PuchiPix-噗呲专用 v2.2.0 (多爬虫版)")
        self.root.geometry("1600x800")
        
        self.setup_styles()
        
        # 初始化爬虫管理器
        self.scraper_manager = ScraperManager()
        
        # 任务队列管理
        self.task_queue = deque()
        self.all_tasks_map = {}
        self.failed_tasks_list = []
        self.is_running = False
        self.stop_requested = False
        self.task_thread = None
        self.task_id_counter = 0
        self.success_count = 0
        self.failed_count = 0
        self.current_queue_filter = "All"
        self.batch_window = None
        self.unattended_timer = None
        self.active_tag_button = None
        self.active_queue_filter_button = None
        self.timer_running = False
        
        # 初始化剪切板监控变量
        self.clipboard_monitor_var = tk.BooleanVar(value=False)
        
        # 初始化设置变量
        self.download_video_var = tk.BooleanVar(value=True)
        self.debug_mode_var = tk.BooleanVar(value=False)
        self.unattended_mode_var = tk.BooleanVar(value=False)
        self.threads_var = tk.StringVar(value="16")
        self.save_format_var = tk.StringVar(value="原始格式")
        self.rename_format_var = tk.StringVar(value="{id}_{num}")
        self.ffmpeg_path_var = tk.StringVar(value="")
        self.chromedriver_path_var = tk.StringVar(value="")
        
        # 任务状态管理
        self.task_states = {}
        self.load_task_states()
        
        # 性能监控
        self.psutil_process = psutil.Process(os.getpid())
        self.total_bytes_downloaded = 0
        self.total_traffic_bytes = 0
        self.last_check_time = time.time()
        self.last_check_bytes = 0
        self.byte_counter_lock = threading.Lock()
        
        # 创建UI
        self.create_ui()
        
        # 加载配置
        self.load_config()
        
        # 加载历史记录
        self.load_history()
        
        # 启动性能监控
        self.update_performance_stats()
        
        # 初始化剪贴板监控器
        self.clipboard_monitor = ClipboardMonitor(self.scraper_manager)
        self.clipboard_monitor.set_callback(self.on_clipboard_url_detected)
        
        # 启动剪贴板监控
        self.clipboard_content = ""
        self.monitor_clipboard()
    
    def setup_styles(self):
        """设置应用程序样式"""
        style = ttk.Style()
        style.configure("TFrame", background="#f0f0f0")
        style.configure("TLabel", background="#f0f0f0")
        style.configure("TButton", font=("Microsoft YaHei UI", 9))
    
    def create_ui(self):
        """创建用户界面"""
        main_container = ttk.Frame(self.root)
        main_container.pack(fill=BOTH, expand=True, padx=10, pady=10)

        main_container.grid_columnconfigure(0, weight=2, minsize=300)
        main_container.grid_columnconfigure(1, weight=2, minsize=400)
        main_container.grid_columnconfigure(2, weight=3, minsize=500)
        main_container.grid_rowconfigure(0, weight=1)

        # 左侧面板 - 历史记录和标签
        left_pane = ttk.Frame(main_container)
        left_pane.grid(row=0, column=0, sticky="nsew")
        self.create_left_pane(left_pane)
        
        # 中间面板 - 任务控制和日志
        middle_pane = ttk.Frame(main_container)
        middle_pane.grid(row=0, column=1, sticky="nsew", padx=(10, 10))
        self.create_middle_pane(middle_pane)

        # 右侧面板 - 任务队列
        right_pane = ttk.Frame(main_container)
        right_pane.grid(row=0, column=2, sticky="nsew")
        self.create_right_pane(right_pane)
    
    def create_left_pane(self, parent):
        """创建左侧面板"""
        # 搜索框
        search_frame = ttk.Frame(parent)
        search_frame.pack(fill=X, pady=(0, 5))
        ttk.Label(search_frame, text="搜索历史:").pack(side=LEFT, padx=(0, 5))
        self.search_var = tk.StringVar()
        self.search_var.trace("w", self.filter_history)
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var)
        self.search_entry.pack(fill=X, expand=True, side=LEFT)
        ttk.Button(search_frame, text="清空历史", command=self.clear_history, bootstyle="outline-danger").pack(side=RIGHT, padx=(5,0))

        # 历史记录
        self.history_frame_container = ttk.Labelframe(text="下载历史", padding=5)
        self.history_frame_container.pack(in_=parent, fill=BOTH, expand=True)
        
        history_tree_frame = ttk.Frame(self.history_frame_container)
        history_tree_frame.pack(fill=BOTH, expand=True)

        cols = ("标题", "数量", "Tags", "网站")
        self.history_tree = ttk.Treeview(history_tree_frame, columns=cols, show='headings')
        self.history_tree.column("标题", width=150); self.history_tree.heading("标题", text="标题")
        self.history_tree.column("数量", width=80, anchor='center'); self.history_tree.heading("数量", text="数量")
        self.history_tree.column("Tags", width=120); self.history_tree.heading("Tags", text="Tags")
        self.history_tree.column("网站", width=80, anchor='center'); self.history_tree.heading("网站", text="网站")
        self.history_tree.pack(side=LEFT, fill=BOTH, expand=True)
        self.history_tree.bind("<Button-3>", self.copy_history_url)
        scrollbar = ttk.Scrollbar(history_tree_frame, orient=VERTICAL, command=self.history_tree.yview)
        scrollbar.pack(side=RIGHT, fill=Y)
        self.history_tree.config(yscrollcommand=scrollbar.set)

        # 标签筛选
        self.tags_filter_frame = ttk.Labelframe(parent, text="标签筛选", padding=10)
        self.tags_filter_frame.pack(fill=X, pady=(10,0))
        self.tags_buttons_frame = ttk.Frame(self.tags_filter_frame)
        self.tags_buttons_frame.pack(fill=X, pady=(0, 5))
        
        manage_tags_btn = ttk.Button(self.tags_filter_frame, text="管理自定义标签", command=self.open_tag_manager, bootstyle="outline-primary")
        manage_tags_btn.pack(anchor='w')
        self.manage_tags_btn_ref = manage_tags_btn
    
    def create_middle_pane(self, parent):
        """创建中间面板"""
        # 控制面板
        controls_frame = ttk.Frame(parent)
        controls_frame.pack(fill=X, padx=5, pady=5)
        
        # 输入组
        input_group = ttk.Frame(controls_frame)
        input_group.pack(fill=X, pady=(0,5))
        ttk.Label(input_group, text="ID/网址:", font=("Microsoft YaHei UI", 11)).pack(side=LEFT, padx=(5,2))
        self.url_entry = ttk.Entry(input_group)
        self.url_entry.pack(side=LEFT, expand=True, fill=X)
        self.add_task_button = ttk.Button(input_group, text="添加", command=self.add_task_from_entry, bootstyle="primary")
        self.add_task_button.pack(side=LEFT, padx=(5,5))
        self.batch_add_button = ttk.Button(input_group, text="批量导入", command=self.open_batch_import_window, bootstyle="secondary")
        self.batch_add_button.pack(side=LEFT, padx=(0,5))
        self.batch_add_button_ref = self.batch_add_button
        self.settings_button = ttk.Button(input_group, text="高级设置", command=self.open_settings_window, bootstyle="outline-info")
        self.settings_button.pack(side=LEFT)
        self.url_entry.bind("<Return>", self.add_task_from_entry)
        
        # 网站选择
        site_group = ttk.Frame(controls_frame)
        site_group.pack(fill=X, pady=(0,5))
        ttk.Label(site_group, text="网站:", font=("Microsoft YaHei UI", 11)).pack(side=LEFT, padx=(5,2))
        self.site_var = tk.StringVar()
        self.site_combo = ttk.Combobox(site_group, textvariable=self.site_var, state="readonly")
        self.site_combo.pack(side=LEFT, expand=True, fill=X, padx=(0, 5))
        self.update_site_list()
        
        # 路径选择
        path_group = ttk.Frame(controls_frame)
        path_group.pack(fill=X, pady=(0,5))
        ttk.Label(path_group, text="保存位置:", font=("Microsoft YaHei UI", 11)).pack(side=LEFT, padx=(5,2))
        self.save_path_var = tk.StringVar()
        self.save_path_entry = ttk.Entry(path_group, textvariable=self.save_path_var)
        self.save_path_entry.pack(side=LEFT, expand=True, fill=X, padx=(0, 5))
        ttk.Button(path_group, text="...", command=self.select_save_path, width=4).pack(side=LEFT)

        # 选项
        main_options_frame = ttk.Frame(controls_frame)
        main_options_frame.pack(fill=X, pady=(5,10))
        ttk.Checkbutton(main_options_frame, text="下载视频", variable=self.download_video_var, bootstyle="round-toggle").pack(side=LEFT, padx=(5,10))
        ttk.Checkbutton(main_options_frame, text="调试模式(显示浏览器)", variable=self.debug_mode_var, bootstyle="round-toggle").pack(side=LEFT, padx=(0,10))
        ttk.Checkbutton(main_options_frame, text="无人值守", variable=self.unattended_mode_var, bootstyle="round-toggle").pack(side=LEFT, padx=(0,10))
        ttk.Checkbutton(main_options_frame, text="自动剪切板", variable=self.clipboard_monitor_var, bootstyle="round-toggle").pack(side=LEFT, padx=(0,10))
        self.delay_label = ttk.Label(main_options_frame, text="任务延时: 1-30s (自动)")
        self.delay_label.pack(side=LEFT, padx=(10,0))
        
        # 任务控制按钮
        task_buttons_group = ttk.Frame(parent)
        task_buttons_group.pack(fill=X, padx=5, pady=5)
        self.start_tasks_button = ttk.Button(task_buttons_group, text="开始任务", command=self.start_task_processor, bootstyle=SUCCESS)
        self.start_tasks_button.pack(side=LEFT, expand=True, fill=X, padx=(0,5))
        self.stop_tasks_button = ttk.Button(task_buttons_group, text="停止任务", command=self.stop_task_processor, bootstyle=DANGER, state=tk.DISABLED)
        self.stop_tasks_button.pack(side=LEFT, expand=True, fill=X, padx=(0,5))
        self.clear_tasks_button = ttk.Button(task_buttons_group, text="清空任务", command=self.clear_all_tasks, bootstyle=WARNING)
        self.clear_tasks_button.pack(side=LEFT, expand=True, fill=X)
        
        # 进度条
        progress_frame = ttk.Frame(parent, padding=(5, 5))
        progress_frame.pack(fill=X)
        self.parse_progress = ttk.Progressbar(progress_frame, mode='determinate', bootstyle="info-striped")
        self.parse_progress.pack(fill=X, pady=(0, 2))
        self.download_progress = ttk.Progressbar(progress_frame, mode='determinate', bootstyle="success-striped")
        self.download_progress.pack(fill=X, pady=(2, 0))

        # 日志输出
        log_frame = ttk.Labelframe(parent, text="日志输出", padding=10)
        log_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)
        self.log_area = tk.Text(log_frame, height=10, font=("Consolas", 10), relief="flat")
        self.log_area.pack(side=LEFT, fill=BOTH, expand=True)
        log_scrollbar = ttk.Scrollbar(log_frame, orient=VERTICAL, command=self.log_area.yview)
        log_scrollbar.pack(side=RIGHT, fill=Y)
        self.log_area.config(yscrollcommand=log_scrollbar.set)
        clear_log_btn = ttk.Button(log_frame, text="清理", command=self.clear_log, bootstyle="secondary-outline", width=5)
        clear_log_btn.place(relx=1.0, rely=0, x=-5, y=5, anchor="ne")

        # 性能监控
        perf_frame = ttk.Labelframe(parent, text="性能监控", padding=10)
        perf_frame.pack(fill=X, padx=5, pady=5)
        self.create_performance_monitor(perf_frame)
    
    def create_right_pane(self, parent):
        """创建右侧面板"""
        # 任务队列标题
        queue_title_frame = ttk.Frame(parent)
        queue_title_frame.pack(fill=X, padx=5, pady=(5, 0))
        ttk.Label(queue_title_frame, text="任务队列", font=("Microsoft YaHei UI", 12, "bold")).pack(side=LEFT)
        self.queue_count_label = ttk.Label(queue_title_frame, text="(0)")
        self.queue_count_label.pack(side=LEFT, padx=(5, 0))
        
        # 队列过滤器
        queue_filter_frame = ttk.Frame(parent)
        queue_filter_frame.pack(fill=X, padx=5, pady=(5, 0))
        ttk.Label(queue_filter_frame, text="过滤:").pack(side=LEFT, padx=(0, 5))
        
        filter_options = ["All", "等待中", "进行中", "已完成", "失败"]
        for option in filter_options:
            btn = ttk.Button(queue_filter_frame, text=option, command=lambda opt=option: self.filter_queue(opt), bootstyle="outline-primary")
            btn.pack(side=LEFT, padx=(0, 5))
            if option == "All":
                self.active_queue_filter_button = btn
        
        # 任务队列树
        queue_tree_frame = ttk.Frame(parent)
        queue_tree_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)
        
        cols = ("ID", "状态", "操作", "进度", "网站")
        self.queue_tree = ttk.Treeview(queue_tree_frame, columns=cols, show='headings')
        self.queue_tree.column("ID", width=200); self.queue_tree.heading("ID", text="ID/网址")
        self.queue_tree.column("状态", width=100, anchor='center'); self.queue_tree.heading("状态", text="状态")
        self.queue_tree.column("操作", width=150, anchor='center'); self.queue_tree.heading("操作", text="操作")
        self.queue_tree.column("进度", width=100, anchor='center'); self.queue_tree.heading("进度", text="进度")
        self.queue_tree.column("网站", width=80, anchor='center'); self.queue_tree.heading("网站", text="网站")
        self.queue_tree.pack(side=LEFT, fill=BOTH, expand=True)
        self.queue_tree.bind("<Button-3>", self.show_queue_context_menu)
        
        queue_scrollbar = ttk.Scrollbar(queue_tree_frame, orient=VERTICAL, command=self.queue_tree.yview)
        queue_scrollbar.pack(side=RIGHT, fill=Y)
        self.queue_tree.config(yscrollcommand=queue_scrollbar.set)
        
        # 失败任务按钮
        failed_tasks_frame = ttk.Frame(parent)
        failed_tasks_frame.pack(fill=X, padx=5, pady=(0, 5))
        self.show_failed_tasks_button = ttk.Button(failed_tasks_frame, text="显示失败任务", command=self.show_failed_tasks, bootstyle="outline-danger")
        self.show_failed_tasks_button.pack(side=LEFT)
        self.retry_failed_tasks_button = ttk.Button(failed_tasks_frame, text="重试失败任务", command=self.retry_failed_tasks, bootstyle="outline-warning")
        self.retry_failed_tasks_button.pack(side=LEFT, padx=(5, 0))
    
    def create_performance_monitor(self, parent):
        """创建性能监控面板"""
        # 创建三个圆环图表的容器
        charts_frame = ttk.Frame(parent)
        charts_frame.pack(fill=X, pady=(0, 10))
        
        # CPU使用率
        cpu_frame = ttk.Frame(charts_frame)
        cpu_frame.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 5))
        ttk.Label(cpu_frame, text="CPU", font=("Microsoft YaHei UI", 10)).pack()
        self.cpu_canvas = tk.Canvas(cpu_frame, width=80, height=80, bg="#f0f0f0", highlightthickness=0)
        self.cpu_canvas.pack()
        self.cpu_percent_label = ttk.Label(cpu_frame, text="0%", font=("Microsoft YaHei UI", 10, "bold"))
        self.cpu_percent_label.pack()
        self.cpu_stats_label = ttk.Label(cpu_frame, text="0.00 GHz", font=("Microsoft YaHei UI", 8))
        self.cpu_stats_label.pack()
        
        # 内存使用率
        mem_frame = ttk.Frame(charts_frame)
        mem_frame.pack(side=LEFT, fill=BOTH, expand=True, padx=(0, 5))
        ttk.Label(mem_frame, text="内存", font=("Microsoft YaHei UI", 10)).pack()
        self.mem_canvas = tk.Canvas(mem_frame, width=80, height=80, bg="#f0f0f0", highlightthickness=0)
        self.mem_canvas.pack()
        self.mem_percent_label = ttk.Label(mem_frame, text="0%", font=("Microsoft YaHei UI", 10, "bold"))
        self.mem_percent_label.pack()
        self.mem_stats_label = ttk.Label(mem_frame, text="0.0/0.0 GB", font=("Microsoft YaHei UI", 8))
        self.mem_stats_label.pack()
        
        # 磁盘使用率
        disk_frame = ttk.Frame(charts_frame)
        disk_frame.pack(side=LEFT, fill=BOTH, expand=True)
        ttk.Label(disk_frame, text="磁盘", font=("Microsoft YaHei UI", 10)).pack()
        self.disk_canvas = tk.Canvas(disk_frame, width=80, height=80, bg="#f0f0f0", highlightthickness=0)
        self.disk_canvas.pack()
        self.disk_percent_label = ttk.Label(disk_frame, text="0%", font=("Microsoft YaHei UI", 10, "bold"))
        self.disk_percent_label.pack()
        self.disk_stats_label = ttk.Label(disk_frame, text="0.0/0.0 GB", font=("Microsoft YaHei UI", 8))
        self.disk_stats_label.pack()
        
        # 初始化圆环图
        self.cpu_arc_id = self.cpu_canvas.create_arc(10, 10, 70, 70, start=90, extent=0, fill="#4CAF50", outline="")
        self.mem_arc_id = self.mem_canvas.create_arc(10, 10, 70, 70, start=90, extent=0, fill="#2196F3", outline="")
        self.disk_arc_id = self.disk_canvas.create_arc(10, 10, 70, 70, start=90, extent=0, fill="#FF9800", outline="")
        
        # 网络和应用程序信息
        info_frame = ttk.Frame(parent)
        info_frame.pack(fill=X)
        
        self.speed_label = ttk.Label(info_frame, text="速度: 0 B/s", font=("Microsoft YaHei UI", 9))
        self.speed_label.pack(side=LEFT, padx=(0, 10))
        
        self.data_label = ttk.Label(info_frame, text="已用流量: 0 B", font=("Microsoft YaHei UI", 9))
        self.data_label.pack(side=LEFT, padx=(0, 10))
        
        self.total_data_label = ttk.Label(info_frame, text="总流量: 0 B", font=("Microsoft YaHei UI", 9))
        self.total_data_label.pack(side=LEFT, padx=(0, 10))
        
        self.app_mem_label = ttk.Label(info_frame, text="脚本内存: 0 MB", font=("Microsoft YaHei UI", 9))
        self.app_mem_label.pack(side=LEFT, padx=(0, 10))
        
        self.app_cpu_label = ttk.Label(info_frame, text="脚本CPU: 0%", font=("Microsoft YaHei UI", 9))
        self.app_cpu_label.pack(side=LEFT)
    
    def update_site_list(self):
        """更新网站列表"""
        site_names = self.scraper_manager.get_all_site_names()
        self.site_combo['values'] = site_names
        if site_names:
            self.site_var.set(site_names[0])
    
    def is_valid_gallery_url(self, url):
        """检查URL是否为有效的图库URL"""
        return self.scraper_manager.is_valid_gallery_url(url)
    
    def add_task_from_entry(self, event=None):
        """从输入框添加任务"""
        user_input = self.url_entry.get().strip()
        if not user_input:
            return
        
        # 检查URL是否有效
        scraper = self.scraper_manager.get_scraper_by_url(user_input)
        if not scraper:
            messagebox.showerror("错误", f"无法识别的URL或网站: {user_input}")
            return
        
        # 检查保存路径
        if not self.save_path_var.get():
            messagebox.showerror("错误", "请选择保存路径")
            return
        
        # 添加任务
        self._add_task(user_input, self.save_path_var.get(), scraper.get_site_name())
        self.url_entry.delete(0, tk.END)
    
    def _add_task(self, user_input, save_path, site_name):
        """添加任务的核心实现"""
        # 检查任务队列中是否已存在相同ID的任务
        for task in self.all_tasks_map.values():
            if task.get('input') == user_input:
                messagebox.showinfo("提示", "任务已存在于队列中")
                return
        
        # 检查历史记录中是否已下载过相同ID的图包
        history = self.load_history_file()
        for entry in history:
            if entry.get("url") == user_input or entry.get("id") == user_input:
                messagebox.showinfo("提示", "该图包已存在于历史记录中")
                return
        
        # 如果没有指定站点，尝试自动识别
        if not site_name:
            site_name = self.scraper_manager.get_site_name_by_url(user_input)
            if not site_name:
                messagebox.showerror("错误", "无法识别该URL的站点，请手动选择站点")
                return
        
        self.task_id_counter += 1
        task_id = f"task_{int(time.time() * 1000)}_{self.task_id_counter}"
        task_data = {
            'id': task_id, 
            'input': user_input, 
            'path': save_path, 
            'site': site_name,
            'status': "⏳ 等待中", 
            'action': '', 
            'progress_text': '', 
            'operation': ''
        }
        self.all_tasks_map[task_id] = task_data
        
        self.refresh_queue_view()
    
    def start_task_processor(self):
        """启动任务处理器"""
        if self.is_running:
            return
        
        self.is_running = True
        self.stop_requested = False
        self.success_count = 0
        self.failed_count = 0
        
        self.start_tasks_button.config(state=tk.DISABLED)
        self.stop_tasks_button.config(state=tk.NORMAL)
        
        # 启动任务处理线程
        self.task_thread = threading.Thread(target=self._process_tasks)
        self.task_thread.daemon = True
        self.task_thread.start()
    
    def stop_task_processor(self):
        """停止任务处理器"""
        if not self.is_running:
            return
        
        self.stop_requested = True
        self.is_running = False
        
        self.start_tasks_button.config(state=tk.NORMAL)
        self.stop_tasks_button.config(state=tk.DISABLED)
        
        # 停止所有爬虫
        for scraper in self.scraper_manager.get_all_scrapers():
            scraper.stop()
    
    def _process_tasks(self):
        """处理任务队列"""
        while self.task_queue and not self.stop_requested:
            try:
                task = self.task_queue.popleft()
                task_id = task['id']
                
                # 更新任务状态
                self.update_task_status(task_id, "⚙️ 解析中", "解析中...")
                
                # 获取爬虫
                scraper = self.scraper_manager.get_scraper_by_site_name(task['site'])
                if not scraper:
                    self.update_task_status(task_id, "❌", "爬虫未找到")
                    self.failed_count += 1
                    continue
                
                # 提取图库ID
                gallery_id = scraper.extract_gallery_id(task['input'])
                if not gallery_id:
                    self.update_task_status(task_id, "❌", "无法提取图库ID")
                    self.failed_count += 1
                    continue
                
                # 创建爬虫配置
                config = self._create_scraper_config()
                
                # 创建爬虫实例
                scraper_instance = self.scraper_manager.create_scraper_instance(task['site'], config)
                if not scraper_instance:
                    self.update_task_status(task_id, "❌", "无法创建爬虫实例")
                    self.failed_count += 1
                    continue
                
                # 爬取图库
                self.update_task_status(task_id, "⚙️ 爬取中", "开始爬取...")
                success = scraper_instance.scrape_gallery(
                    task_id, gallery_id, task['path'], 
                    lambda tid, status=None, action=None, progress_text=None, progress_value=None: 
                    self.update_task_status(tid, status, action, progress_text, progress_value)
                )
                
                if success:
                    self.update_task_status(task_id, "✅", "完成")
                    self.success_count += 1
                    # 添加到历史记录
                    self._add_to_history(task['input'], task['site'], task['path'])
                else:
                    self.update_task_status(task_id, "❌", "失败")
                    self.failed_count += 1
                    # 添加到失败记录
                    self._add_to_failed_tasks(task)
                
                # 添加随机延时
                if not self.stop_requested and self.task_queue:
                    delay = random.randint(1, 30)
                    self.delay_label.config(text=f"任务延时: {delay}s")
                    for i in range(delay):
                        if self.stop_requested:
                            break
                        time.sleep(1)
                    self.delay_label.config(text="任务延时: 1-30s (自动)")
                
            except Exception as e:
                print(f"处理任务时出错: {e}")
                if task_id:
                    self.update_task_status(task_id, "❌", f"错误: {str(e)}")
                    self.failed_count += 1
                    # 添加到失败记录
                    self._add_to_failed_tasks(task)
        
        # 任务处理完成
        self.is_running = False
        self.start_tasks_button.config(state=tk.NORMAL)
        self.stop_tasks_button.config(state=tk.DISABLED)
        
        # 显示完成消息
        if self.success_count > 0 or self.failed_count > 0:
            messagebox.showinfo("任务完成", 
                               f"任务处理完成!\n成功: {self.success_count}\n失败: {self.failed_count}")
    
    def _create_scraper_config(self):
        """创建爬虫配置"""
        return {
            'download_video': self.download_video_var.get(),
            'debug_mode': self.debug_mode_var.get(),
            'threads': int(self.threads_var.get()) if hasattr(self, 'threads_var') and self.threads_var.get() else 4,
            'ffmpeg_path': self.ffmpeg_path_var.get() if hasattr(self, 'ffmpeg_path_var') else 'ffmpeg.exe',
            'chromedriver_path': self.chromedriver_path_var.get() if hasattr(self, 'chromedriver_path_var') else '',
            'save_format': self.save_format_var.get() if hasattr(self, 'save_format_var') else '原始格式',
            'rename_format': self.rename_format_var.get() if hasattr(self, 'rename_format_var') else '{id}_{num}'
        }
    
    def _add_to_history(self, url, site, path):
        """添加到历史记录"""
        try:
            history = self.load_history_file()
            new_entry = {
                "url": url,
                "site": site,
                "path": path,
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            history.append(new_entry)
            self.save_history_file(history)
        except Exception as e:
            print(f"添加历史记录失败: {e}")
    
    def _add_to_failed_tasks(self, task):
        """添加到失败任务记录"""
        try:
            failed_tasks = self.load_failed_tasks_file()
            new_entry = {
                "id": task['id'],
                "input": task['input'],
                "site": task['site'],
                "path": task['path'],
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "error": task.get('progress_text', '未知错误')
            }
            failed_tasks.append(new_entry)
            self.save_failed_tasks_file(failed_tasks)
        except Exception as e:
            print(f"添加失败任务记录失败: {e}")
    
    def update_task_status(self, task_id, status=None, action=None, progress_text=None, progress_value=None):
        """更新任务状态"""
        if task_id not in self.all_tasks_map:
            return
        
        task = self.all_tasks_map[task_id]
        
        if status:
            task['status'] = status
        if action:
            task['action'] = action
        if progress_text:
            task['progress_text'] = progress_text
        if progress_value is not None:
            task['progress_value'] = progress_value
        
        # 更新UI
        self.root.after(0, self.refresh_queue_view)
    
    def refresh_queue_view(self):
        """刷新任务队列视图"""
        # 清空树视图
        for item in self.queue_tree.get_children():
            self.queue_tree.delete(item)
        
        # 重新添加任务
        for task_id, task in self.all_tasks_map.items():
            # 应用过滤器
            if self.current_queue_filter != "All":
                if self.current_queue_filter == "等待中" and not task['status'].startswith("⏳"):
                    continue
                elif self.current_queue_filter == "进行中" and not (task['status'].startswith("⚙️") or task['status'].startswith("🔄")):
                    continue
                elif self.current_queue_filter == "已完成" and not task['status'].startswith("✅"):
                    continue
                elif self.current_queue_filter == "失败" and not task['status'].startswith("❌"):
                    continue
            
            # 添加到树视图
            self.queue_tree.insert("", "end", values=(
                task['input'],
                task['status'],
                task['action'],
                task['progress_text'],
                task.get('site', '未知')
            ))
        
        # 更新计数
        self.queue_count_label.config(text=f"({len(self.all_tasks_map)})")
    
    def filter_queue(self, filter_type):
        """过滤任务队列"""
        self.current_queue_filter = filter_type
        
        # 更新按钮样式
        if self.active_queue_filter_button:
            self.active_queue_filter_button.config(bootstyle="outline-primary")
        
        # 设置新的活动按钮
        for widget in self.queue_tree.master.master.winfo_children():
            if isinstance(widget, ttk.Frame) and widget.winfo_children():
                for child in widget.winfo_children():
                    if isinstance(child, ttk.Button) and child['text'] == filter_type:
                        child.config(bootstyle="primary")
                        self.active_queue_filter_button = child
                        break
        
        self.refresh_queue_view()
    
    def clear_all_tasks(self):
        """清空所有任务"""
        if not self.all_tasks_map:
            messagebox.showinfo("提示", "任务队列为空")
            return
        
        if messagebox.askyesno("确认", "确定要清空所有任务吗？"):
            self.all_tasks_map.clear()
            self.task_queue.clear()
            self.refresh_queue_view()
    
    def select_save_path(self):
        """选择保存路径"""
        path = filedialog.askdirectory()
        if path:
            self.save_path_var.set(path)
    
    def load_history_file(self):
        """加载历史记录文件"""
        if not os.path.exists(HISTORY_FILE):
            return []
        
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    
    def load_history(self):
        """加载历史记录到UI"""
        history = self.load_history_file()
        
        # 清空树视图
        for item in self.history_tree.get_children():
            self.history_tree.delete(item)
        
        # 添加历史记录
        for entry in history:
            self.history_tree.insert("", "end", values=(
                entry.get('title', ''),
                entry.get('total_count', 0),
                entry.get('tags', ''),
                entry.get('site', '未知')
            ))
    
    def filter_history(self, *args):
        """过滤历史记录"""
        search_term = self.search_var.get().lower()
        
        # 清空树视图
        for item in self.history_tree.get_children():
            self.history_tree.delete(item)
        
        # 加载并过滤历史记录
        history = self.load_history_file()
        for entry in history:
            title = entry.get('title', '').lower()
            tags = entry.get('tags', '').lower()
            site = entry.get('site', '').lower()
            
            if search_term in title or search_term in tags or search_term in site:
                self.history_tree.insert("", "end", values=(
                    entry.get('title', ''),
                    entry.get('total_count', 0),
                    entry.get('tags', ''),
                    entry.get('site', '未知')
                ))
    
    def clear_history(self):
        """清空历史记录"""
        if not os.path.exists(HISTORY_FILE):
            messagebox.showinfo("提示", "历史记录为空")
            return
        
        if messagebox.askyesno("确认", "确定要清空历史记录吗？"):
            try:
                os.remove(HISTORY_FILE)
                self.load_history()
            except OSError as e:
                messagebox.showerror("错误", f"无法删除历史记录文件: {e}")
    
    def copy_history_url(self, event):
        """复制历史记录URL"""
        selection = self.history_tree.selection()
        if not selection:
            return
        
        item = self.history_tree.item(selection[0])
        title = item['values'][0]
        
        # 查找对应的URL
        history = self.load_history_file()
        for entry in history:
            if entry.get('title') == title:
                url = entry.get('url', '')
                if url:
                    self.root.clipboard_clear()
                    self.root.clipboard_append(url)
                    messagebox.showinfo("提示", f"已复制URL: {url}")
                break
    
    def show_queue_context_menu(self, event):
        """显示任务队列上下文菜单"""
        selection = self.queue_tree.selection()
        if not selection:
            return
        
        item = self.queue_tree.item(selection[0])
        task_input = item['values'][0]
        
        # 查找任务ID
        task_id = None
        for tid, task in self.all_tasks_map.items():
            if task['input'] == task_input:
                task_id = tid
                break
        
        if not task_id:
            return
        
        # 创建上下文菜单
        context_menu = tk.Menu(self.root, tearoff=0)
        context_menu.add_command(label="复制URL", command=lambda: self.copy_task_url(task_input))
        context_menu.add_command(label="修改任务", command=lambda: self.modify_task(task_id))
        context_menu.add_command(label="删除任务", command=lambda: self.delete_task(task_id))
        context_menu.add_separator()
        context_menu.add_command(label="移至顶部", command=lambda: self.move_task_to_top(task_id))
        context_menu.add_command(label="移至底部", command=lambda: self.move_task_to_bottom(task_id))
        
        context_menu.post(event.x_root, event.y_root)
    
    def copy_task_url(self, url):
        """复制任务URL"""
        self.root.clipboard_clear()
        self.root.clipboard_append(url)
        messagebox.showinfo("提示", f"已复制URL: {url}")
    
    def modify_task(self, task_id):
        """修改任务"""
        if task_id not in self.all_tasks_map:
            return
        
        task = self.all_tasks_map[task_id]
        
        # 创建修改窗口
        modify_window = tk.Toplevel(self.root)
        modify_window.title("修改任务")
        modify_window.geometry("400x200")
        modify_window.transient(self.root)
        modify_window.grab_set()
        
        # URL输入
        ttk.Label(modify_window, text="URL:").pack(pady=(10, 0))
        url_var = tk.StringVar(value=task['input'])
        url_entry = ttk.Entry(modify_window, textvariable=url_var, width=50)
        url_entry.pack(pady=(0, 10))
        
        # 路径选择
        ttk.Label(modify_window, text="保存路径:").pack()
        path_var = tk.StringVar(value=task['path'])
        path_frame = ttk.Frame(modify_window)
        path_frame.pack(pady=(0, 10))
        path_entry = ttk.Entry(path_frame, textvariable=path_var, width=45)
        path_entry.pack(side=LEFT)
        ttk.Button(path_frame, text="...", command=lambda: path_var.set(filedialog.askdirectory())).pack(side=LEFT)
        
        # 按钮
        button_frame = ttk.Frame(modify_window)
        button_frame.pack(pady=10)
        ttk.Button(button_frame, text="保存", command=lambda: self.save_task_modification(task_id, url_var.get(), path_var.get(), modify_window)).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="取消", command=modify_window.destroy).pack(side=LEFT)
    
    def save_task_modification(self, task_id, new_url, new_path, window):
        """保存任务修改"""
        if task_id not in self.all_tasks_map:
            return
        
        # 检查URL是否有效
        scraper = self.scraper_manager.get_scraper_by_url(new_url)
        if not scraper:
            messagebox.showerror("错误", f"无法识别的URL或网站: {new_url}")
            return
        
        # 更新任务
        self.all_tasks_map[task_id]['input'] = new_url
        self.all_tasks_map[task_id]['path'] = new_path
        self.all_tasks_map[task_id]['site'] = scraper.get_site_name()
        
        self.refresh_queue_view()
        window.destroy()
        messagebox.showinfo("提示", "任务已更新")
    
    def delete_task(self, task_id):
        """删除任务"""
        if task_id not in self.all_tasks_map:
            return
        
        if messagebox.askyesno("确认", "确定要删除此任务吗？"):
            del self.all_tasks_map[task_id]
            self.refresh_queue_view()
    
    def move_task_to_top(self, task_id):
        """将任务移至顶部"""
        if task_id not in self.all_tasks_map:
            return
        
        task = self.all_tasks_map.pop(task_id)
        self.all_tasks_map[task_id] = task
        
        # 重新构建任务队列
        self.task_queue.clear()
        for task_id, task in self.all_tasks_map.items():
            self.task_queue.append(task)
        
        self.refresh_queue_view()
    
    def move_task_to_bottom(self, task_id):
        """将任务移至底部"""
        if task_id not in self.all_tasks_map:
            return
        
        task = self.all_tasks_map.pop(task_id)
        self.all_tasks_map[task_id] = task
        
        # 重新构建任务队列
        self.task_queue.clear()
        for task_id, task in self.all_tasks_map.items():
            self.task_queue.append(task)
        
        self.refresh_queue_view()
    
    def show_failed_tasks(self):
        """显示失败任务"""
        # 加载失败任务
        if not os.path.exists(FAILED_TASKS_FILE):
            messagebox.showinfo("提示", "没有失败任务")
            return
        
        try:
            with open(FAILED_TASKS_FILE, 'r', encoding='utf-8') as f:
                failed_tasks = [line.strip() for line in f.readlines() if line.strip()]
        except IOError:
            messagebox.showerror("错误", "无法读取失败任务文件")
            return
        
        if not failed_tasks:
            messagebox.showinfo("提示", "没有失败任务")
            return
        
        # 创建失败任务窗口
        failed_window = tk.Toplevel(self.root)
        failed_window.title("失败任务")
        failed_window.geometry("600x400")
        failed_window.transient(self.root)
        
        # 创建列表框
        list_frame = ttk.Frame(failed_window)
        list_frame.pack(fill=BOTH, expand=True, padx=10, pady=10)
        
        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side=RIGHT, fill=Y)
        
        failed_listbox = tk.Listbox(list_frame, yscrollcommand=scrollbar.set)
        failed_listbox.pack(side=LEFT, fill=BOTH, expand=True)
        scrollbar.config(command=failed_listbox.yview)
        
        # 添加失败任务
        for task in failed_tasks:
            failed_listbox.insert(tk.END, task)
        
        # 按钮
        button_frame = ttk.Frame(failed_window)
        button_frame.pack(fill=X, padx=10, pady=(0, 10))
        
        def retry_selected():
            selection = failed_listbox.curselection()
            if not selection:
                return
            
            for idx in selection:
                task = failed_listbox.get(idx)
                if task:
                    # 检查URL是否有效
                    scraper = self.scraper_manager.get_scraper_by_url(task)
                    if scraper:
                        self._add_task(task, self.save_path_var.get(), scraper.get_site_name())
            
            failed_window.destroy()
            messagebox.showinfo("提示", f"已重试 {len(selection)} 个任务")
        
        def retry_all():
            for task in failed_tasks:
                # 检查URL是否有效
                scraper = self.scraper_manager.get_scraper_by_url(task)
                if scraper:
                    self._add_task(task, self.save_path_var.get(), scraper.get_site_name())
            
            failed_window.destroy()
            messagebox.showinfo("提示", f"已重试所有 {len(failed_tasks)} 个任务")
        
        def clear_failed():
            if messagebox.askyesno("确认", "确定要清空所有失败任务吗？"):
                try:
                    os.remove(FAILED_TASKS_FILE)
                    failed_window.destroy()
                    messagebox.showinfo("提示", "已清空失败任务")
                except OSError as e:
                    messagebox.showerror("错误", f"无法删除失败任务文件: {e}")
        
        ttk.Button(button_frame, text="重试选中", command=retry_selected).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="重试全部", command=retry_all).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="清空", command=clear_failed).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="关闭", command=failed_window.destroy).pack(side=RIGHT)
    
    def retry_failed_tasks(self):
        """重试失败任务"""
        if not os.path.exists(FAILED_TASKS_FILE):
            messagebox.showinfo("提示", "没有失败任务")
            return
        
        try:
            with open(FAILED_TASKS_FILE, 'r', encoding='utf-8') as f:
                failed_tasks = [line.strip() for line in f.readlines() if line.strip()]
        except IOError:
            messagebox.showerror("错误", "无法读取失败任务文件")
            return
        
        if not failed_tasks:
            messagebox.showinfo("提示", "没有失败任务")
            return
        
        # 重试所有失败任务
        retry_count = 0
        for task in failed_tasks:
            # 检查URL是否有效
            scraper = self.scraper_manager.get_scraper_by_url(task)
            if scraper:
                self._add_task(task, self.save_path_var.get(), scraper.get_site_name())
                retry_count += 1
        
        if retry_count > 0:
            messagebox.showinfo("提示", f"已重试 {retry_count} 个失败任务")
        else:
            messagebox.showinfo("提示", "没有可重试的任务")
    
    def open_batch_import_window(self):
        """打开批量导入窗口"""
        batch_window = tk.Toplevel(self.root)
        batch_window.title("批量导入")
        batch_window.geometry("600x400")
        batch_window.transient(self.root)
        batch_window.grab_set()
        
        # 说明文本
        info_label = ttk.Label(batch_window, text="每行输入一个URL或ID，支持多种格式")
        info_label.pack(pady=(10, 5))
        
        # 文本框
        text_frame = ttk.Frame(batch_window)
        text_frame.pack(fill=BOTH, expand=True, padx=10, pady=(0, 10))
        
        text_scrollbar = ttk.Scrollbar(text_frame)
        text_scrollbar.pack(side=RIGHT, fill=Y)
        
        batch_text = tk.Text(text_frame, yscrollcommand=text_scrollbar.set)
        batch_text.pack(side=LEFT, fill=BOTH, expand=True)
        text_scrollbar.config(command=batch_text.yview)
        
        # 按钮
        button_frame = ttk.Frame(batch_window)
        button_frame.pack(fill=X, padx=10, pady=(0, 10))
        
        def import_tasks():
            content = batch_text.get("1.0", tk.END).strip()
            if not content:
                messagebox.showerror("错误", "请输入URL或ID")
                return
            
            lines = [line.strip() for line in content.split('\n') if line.strip()]
            if not lines:
                messagebox.showerror("错误", "请输入有效的URL或ID")
                return
            
            # 检查保存路径
            if not self.save_path_var.get():
                messagebox.showerror("错误", "请选择保存路径")
                return
            
            # 导入任务
            import_count = 0
            duplicate_count = 0
            
            for line in lines:
                # 检查URL是否有效
                scraper = self.scraper_manager.get_scraper_by_url(line)
                if not scraper:
                    continue
                
                # 检查是否已存在
                exists = False
                for task in self.all_tasks_map.values():
                    if task['input'] == line:
                        exists = True
                        duplicate_count += 1
                        break
                
                if not exists:
                    self._add_task(line, self.save_path_var.get(), scraper.get_site_name())
                    import_count += 1
            
            batch_window.destroy()
            messagebox.showinfo("提示", f"已导入 {import_count} 个任务，跳过 {duplicate_count} 个重复任务")
        
        ttk.Button(button_frame, text="导入", command=import_tasks).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="取消", command=batch_window.destroy).pack(side=RIGHT)
    
    def open_settings_window(self):
        """打开设置窗口"""
        settings_window = tk.Toplevel(self.root)
        settings_window.title("高级设置")
        settings_window.geometry("500x400")
        settings_window.transient(self.root)
        settings_window.grab_set()
        
        # 创建笔记本控件
        notebook = ttk.Notebook(settings_window)
        notebook.pack(fill=BOTH, expand=True, padx=10, pady=10)
        
        # 下载设置标签页
        download_tab = ttk.Frame(notebook)
        notebook.add(download_tab, text="下载设置")
        
        # 线程数
        threads_frame = ttk.Frame(download_tab)
        threads_frame.pack(fill=X, padx=10, pady=(10, 5))
        ttk.Label(threads_frame, text="下载线程数:").pack(side=LEFT)
        threads_spinbox = ttk.Spinbox(threads_frame, from_=1, to=32, textvariable=self.threads_var, width=10)
        threads_spinbox.pack(side=LEFT, padx=(10, 0))
        
        # 保存格式
        format_frame = ttk.Frame(download_tab)
        format_frame.pack(fill=X, padx=10, pady=(5, 5))
        ttk.Label(format_frame, text="图片保存格式:").pack(side=LEFT)
        format_combo = ttk.Combobox(format_frame, textvariable=self.save_format_var, values=["原始格式", "JPG", "PNG"], state="readonly")
        format_combo.pack(side=LEFT, padx=(10, 0))
        
        # 重命名格式
        rename_frame = ttk.Frame(download_tab)
        rename_frame.pack(fill=X, padx=10, pady=(5, 10))
        ttk.Label(rename_frame, text="重命名格式:").pack(anchor='w')
        rename_entry = ttk.Entry(rename_frame, textvariable=self.rename_format_var)
        rename_entry.pack(fill=X, pady=(5, 0))
        ttk.Label(rename_frame, text="可用变量: {id} - 图库ID, {num} - 序号, {title} - 标题", font=("Microsoft YaHei UI", 8)).pack(anchor='w')
        
        # 路径设置标签页
        path_tab = ttk.Frame(notebook)
        notebook.add(path_tab, text="路径设置")
        
        # FFmpeg路径
        ffmpeg_frame = ttk.Frame(path_tab)
        ffmpeg_frame.pack(fill=X, padx=10, pady=(10, 5))
        ttk.Label(ffmpeg_frame, text="FFmpeg路径:").pack(anchor='w')
        ffmpeg_path_frame = ttk.Frame(ffmpeg_frame)
        ffmpeg_path_frame.pack(fill=X, pady=(5, 0))
        ffmpeg_entry = ttk.Entry(ffmpeg_path_frame, textvariable=self.ffmpeg_path_var)
        ffmpeg_entry.pack(side=LEFT, fill=X, expand=True)
        ttk.Button(ffmpeg_path_frame, text="...", command=lambda: self.ffmpeg_path_var.set(filedialog.askopenfilename(filetypes=[("可执行文件", "*.exe")]))).pack(side=RIGHT)
        
        # ChromeDriver路径
        chromedriver_frame = ttk.Frame(path_tab)
        chromedriver_frame.pack(fill=X, padx=10, pady=(5, 10))
        ttk.Label(chromedriver_frame, text="ChromeDriver路径:").pack(anchor='w')
        chromedriver_path_frame = ttk.Frame(chromedriver_frame)
        chromedriver_path_frame.pack(fill=X, pady=(5, 0))
        chromedriver_entry = ttk.Entry(chromedriver_path_frame, textvariable=self.chromedriver_path_var)
        chromedriver_entry.pack(side=LEFT, fill=X, expand=True)
        ttk.Button(chromedriver_path_frame, text="...", command=lambda: self.chromedriver_path_var.set(filedialog.askopenfilename(filetypes=[("可执行文件", "*.exe")]))).pack(side=RIGHT)
        
        # 网站设置标签页
        site_tab = ttk.Frame(notebook)
        notebook.add(site_tab, text="网站设置")
        
        # 网站列表
        site_list_frame = ttk.Frame(site_tab)
        site_list_frame.pack(fill=BOTH, expand=True, padx=10, pady=(10, 10))
        
        site_list_label = ttk.Label(site_list_frame, text="已加载的网站爬虫:")
        site_list_label.pack(anchor='w')
        
        site_listbox = tk.Listbox(site_list_frame)
        site_listbox.pack(fill=BOTH, expand=True, pady=(5, 0))
        
        # 添加网站信息
        for scraper in self.scraper_manager.get_all_scrapers():
            site_listbox.insert(tk.END, f"{scraper.get_site_name()} ({scraper.get_site_domain()})")
        
        # 按钮
        button_frame = ttk.Frame(settings_window)
        button_frame.pack(fill=X, padx=10, pady=(0, 10))
        
        def save_settings():
            # 保存设置到配置文件
            config = {
                'download_video': self.download_video_var.get(),
                'debug_mode': self.debug_mode_var.get(),
                'unattended_mode': self.unattended_mode_var.get(),
                'clipboard_monitor': self.clipboard_monitor_var.get(),
                'threads': self.threads_var.get(),
                'save_format': self.save_format_var.get(),
                'rename_format': self.rename_format_var.get(),
                'ffmpeg_path': self.ffmpeg_path_var.get(),
                'chromedriver_path': self.chromedriver_path_var.get()
            }
            
            try:
                with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=4)
                messagebox.showinfo("提示", "设置已保存")
                settings_window.destroy()
            except IOError as e:
                messagebox.showerror("错误", f"无法保存设置: {e}")
        
        ttk.Button(button_frame, text="保存", command=save_settings).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="取消", command=settings_window.destroy).pack(side=RIGHT)
    
    def open_tag_manager(self):
        """打开标签管理器"""
        tag_window = tk.Toplevel(self.root)
        tag_window.title("标签管理")
        tag_window.geometry("400x300")
        tag_window.transient(self.root)
        tag_window.grab_set()
        
        # 标签列表
        list_frame = ttk.Frame(tag_window)
        list_frame.pack(fill=BOTH, expand=True, padx=10, pady=(10, 10))
        
        scrollbar = ttk.Scrollbar(list_frame)
        scrollbar.pack(side=RIGHT, fill=Y)
        
        tag_listbox = tk.Listbox(list_frame, yscrollcommand=scrollbar.set)
        tag_listbox.pack(side=LEFT, fill=BOTH, expand=True)
        scrollbar.config(command=tag_listbox.yview)
        
        # 添加标签
        for tag in self.custom_tags:
            tag_listbox.insert(tk.END, tag)
        
        # 输入框
        input_frame = ttk.Frame(tag_window)
        input_frame.pack(fill=X, padx=10, pady=(0, 10))
        
        ttk.Label(input_frame, text="新标签:").pack(side=LEFT)
        tag_var = tk.StringVar()
        tag_entry = ttk.Entry(input_frame, textvariable=tag_var)
        tag_entry.pack(side=LEFT, fill=X, expand=True, padx=(10, 0))
        
        # 按钮
        button_frame = ttk.Frame(tag_window)
        button_frame.pack(fill=X, padx=10, pady=(0, 10))
        
        def add_tag():
            tag = tag_var.get().strip()
            if tag and tag not in self.custom_tags:
                self.custom_tags.append(tag)
                tag_listbox.insert(tk.END, tag)
                tag_var.set("")
        
        def delete_tag():
            selection = tag_listbox.curselection()
            if selection:
                index = selection[0]
                tag = tag_listbox.get(index)
                self.custom_tags.remove(tag)
                tag_listbox.delete(index)
        
        def save_tags():
            # 保存标签到配置文件
            config = self.load_config()
            config['custom_tags'] = self.custom_tags
            
            try:
                with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump(config, f, ensure_ascii=False, indent=4)
                messagebox.showinfo("提示", "标签已保存")
                tag_window.destroy()
            except IOError as e:
                messagebox.showerror("错误", f"无法保存标签: {e}")
        
        ttk.Button(button_frame, text="添加", command=add_tag).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="删除", command=delete_tag).pack(side=LEFT, padx=(0, 5))
        ttk.Button(button_frame, text="保存", command=save_tags).pack(side=RIGHT, padx=(5, 0))
        ttk.Button(button_frame, text="取消", command=tag_window.destroy).pack(side=RIGHT)
    
    def load_config(self):
        """加载配置"""
        if not os.path.exists(CONFIG_FILE):
            return {}
        
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    
    def load_config(self):
        """加载配置"""
        if not os.path.exists(CONFIG_FILE):
            return {}
        
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config = json.load(f)
                
                # 应用配置
                self.download_video_var.set(config.get('download_video', True))
                self.debug_mode_var.set(config.get('debug_mode', False))
                self.unattended_mode_var.set(config.get('unattended_mode', False))
                self.clipboard_monitor_var.set(config.get('clipboard_monitor', False))
                self.threads_var.set(config.get('threads', '16'))
                self.save_format_var.set(config.get('save_format', '原始格式'))
                self.rename_format_var.set(config.get('rename_format', '{id}_{num}'))
                self.ffmpeg_path_var.set(config.get('ffmpeg_path', ''))
                self.chromedriver_path_var.set(config.get('chromedriver_path', ''))
                self.custom_tags = config.get('custom_tags', [])
                
                # 更新标签按钮
                self.update_tag_buttons()
                
                return config
        except (json.JSONDecodeError, IOError):
            return {}
    
    def update_tag_buttons(self):
        """更新标签按钮"""
        # 清除现有按钮
        for widget in self.tags_buttons_frame.winfo_children():
            widget.destroy()
        
        # 添加标签按钮
        for tag in self.custom_tags:
            btn = ttk.Button(self.tags_buttons_frame, text=tag, command=lambda t=tag: self.filter_by_tag(t), bootstyle="outline-primary")
            btn.pack(side=LEFT, padx=(0, 5))
    
    def filter_by_tag(self, tag):
        """按标签过滤历史记录"""
        # 清空树视图
        for item in self.history_tree.get_children():
            self.history_tree.delete(item)
        
        # 加载并过滤历史记录
        history = self.load_history_file()
        for entry in history:
            tags = entry.get('tags', '')
            if tag in tags:
                self.history_tree.insert("", "end", values=(
                    entry.get('title', ''),
                    entry.get('total_count', 0),
                    entry.get('tags', ''),
                    entry.get('site', '未知')
                ))
    
    def clear_log(self):
        """清空日志"""
        self.log_area.delete("1.0", tk.END)
    
    def _update_donut_chart(self, canvas, label, arc_id, percent, is_cpu=False):
        """更新圆环图"""
        # 计算角度
        extent = 360 * percent / 100
        
        # 选择颜色
        if is_cpu:
            if percent < 50:
                color = "#4CAF50"  # 绿色
            elif percent < 80:
                color = "#FF9800"  # 橙色
            else:
                color = "#F44336"  # 红色
        else:
            if percent < 50:
                color = "#2196F3"  # 蓝色
            elif percent < 80:
                color = "#FF9800"  # 橙色
            else:
                color = "#F44336"  # 红色
        
        # 更新圆环
        canvas.itemconfig(arc_id, extent=extent, fill=color)
        
        # 更新标签
        label.config(text=f"{percent:.1f}%")
    
    def format_bytes(self, size):
        """格式化字节数"""
        if size < 1024: return f"{size} B"
        elif size < 1024**2: return f"{size/1024:.2f} KB"
        elif size < 1024**3: return f"{size/1024**2:.2f} MB"
        else: return f"{size/1024**3:.2f} GB"
    
    def update_performance_stats(self):
        """更新性能统计"""
        current_time = time.time()
        time_delta = current_time - self.last_check_time
        
        with self.byte_counter_lock:
            bytes_delta = self.total_bytes_downloaded - self.last_check_bytes
            total_bytes = self.total_bytes_downloaded
        
        if time_delta > 0:
            speed = bytes_delta / time_delta
            self.speed_label.config(text=f"速度: {self.format_bytes(speed)}/s")
        
        self.data_label.config(text=f"已用流量: {self.format_bytes(total_bytes)}")
        
        # 更新总流量统计
        self.total_traffic_bytes += bytes_delta
        self.total_data_label.config(text=f"总流量: {self.format_bytes(self.total_traffic_bytes)}")
        
        self.last_check_time = current_time
        self.last_check_bytes = total_bytes

        cpu_usage = psutil.cpu_percent(interval=None)
        mem_info = psutil.virtual_memory()
        
        try:
            disk_path = os.path.splitdrive(self.save_path_var.get())[0] + os.path.sep if self.save_path_var.get() else '/'
            disk_info = psutil.disk_usage(disk_path)
            disk_usage = disk_info.percent
            disk_stats_str = f"{disk_info.used / (1024**3):.1f}/{disk_info.total / (1024**3):.1f} GB"
        except (FileNotFoundError, Exception):
            disk_usage = 0
            disk_stats_str = "N/A"

        try:
            cpu_freq = psutil.cpu_freq()
            cpu_freq_str = f"{cpu_freq.current / 1000:.2f} GHz"
        except Exception:
            cpu_freq_str = "N/A"

        mem_stats_str = f"{mem_info.used / (1024**3):.1f}/{mem_info.total / (1024**3):.1f} GB"
        
        self._update_donut_chart(self.cpu_canvas, self.cpu_percent_label, self.cpu_arc_id, cpu_usage, is_cpu=True)
        self.cpu_stats_label.config(text=cpu_freq_str)
        
        self._update_donut_chart(self.mem_canvas, self.mem_percent_label, self.mem_arc_id, mem_info.percent)
        self.mem_stats_label.config(text=mem_stats_str)
        
        self._update_donut_chart(self.disk_canvas, self.disk_percent_label, self.disk_arc_id, disk_usage)
        self.disk_stats_label.config(text=disk_stats_str)

        app_mem_usage = self.psutil_process.memory_info().rss / (1024 * 1024)
        self.app_mem_label.config(text=f"脚本内存: {app_mem_usage:.2f} MB")
        app_cpu_usage = self.psutil_process.cpu_percent(interval=None)
        self.app_cpu_label.config(text=f"脚本CPU: {app_cpu_usage:.2f} %")

        self.root.after(1000, self.update_performance_stats)
    
    def monitor_clipboard(self):
        """监控剪贴板内容变化"""
        # 只有当开关打开时才监控
        if self.clipboard_monitor_var.get():
            self.clipboard_monitor.check_clipboard()
        
        # 每500毫秒检查一次剪贴板
        self.root.after(500, self.monitor_clipboard)
    
    def on_clipboard_url_detected(self, url, scraper_name):
        """当检测到剪贴板中的URL时的回调函数"""
        # 静默添加任务
        self.add_task_silently(url)
    
    def add_task_silently(self, user_input):
        """静默添加任务，不弹出任何界面"""
        if not user_input:
            return
            
        if not self.save_path_var.get():
            # 如果没有设置保存路径，使用默认路径
            self.save_path_var.set(os.path.join(os.path.expanduser("~"), "Desktop"))
        
        # 直接调用添加任务的核心逻辑，不进行重复检查
        self._add_task_silently(user_input, self.save_path_var.get())
    
    def _add_task_silently(self, user_input, save_path):
        """静默添加任务的核心实现"""
        # 检查URL是否有效
        scraper = self.scraper_manager.get_scraper_by_url(user_input)
        if not scraper:
            return
        
        # 检查任务队列中是否已存在相同ID的任务
        for task in self.all_tasks_map.values():
            if task.get('input') == user_input:
                # 静默模式下直接返回，不弹出提示
                return
                
        # 检查历史记录中是否已下载过相同ID的图包
        history = self.load_history_file()
        for entry in history:
            if entry.get("url") == user_input or entry.get("id") == user_input:
                # 静默模式下直接返回，不弹出提示
                return

        self.task_id_counter += 1
        task_id = f"task_{int(time.time() * 1000)}_{self.task_id_counter}"
        task_data = {
            'id': task_id, 
            'input': user_input, 
            'path': save_path, 
            'site': scraper.get_site_name(),
            'status': "⏳ 等待中", 
            'action': '', 
            'progress_text': '', 
            'operation': ''
        }
        self.all_tasks_map[task_id] = task_data
        
        self.refresh_queue_view()
    
    def load_task_states(self):
        """加载任务状态"""
        if not os.path.exists(TASK_STATE_FILE):
            self.task_states = {}
            return
            
        try:
            with open(TASK_STATE_FILE, 'r', encoding='utf-8') as f:
                self.task_states = json.load(f)
        except (json.JSONDecodeError, IOError):
            self.task_states = {}

    def save_task_states(self):
        """保存任务状态"""
        try:
            with open(TASK_STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.task_states, f, ensure_ascii=False, indent=4)
        except IOError:
            pass

    def update_task_state(self, task_id, state_info):
        """更新任务状态信息"""
        if task_id not in self.task_states:
            self.task_states[task_id] = {}
        self.task_states[task_id].update(state_info)
        self.save_task_states()

    def get_task_state(self, task_id):
        """获取任务状态信息"""
        return self.task_states.get(task_id, {})


def start_web_server():
    """启动Web服务器"""
    try:
        import threading
        import sys
        import os
        
        # 添加当前目录到Python路径
        sys.path.append(os.path.dirname(os.path.abspath(__file__)))
        
        from web_app import app
        
        # 在独立线程中启动Flask服务器
        web_thread = threading.Thread(target=lambda: app.run(debug=False, host='0.0.0.0', port=5100), daemon=True)
        web_thread.start()
        print("Web界面已启动，访问 http://localhost:5100")
        return True
    except ImportError as e:
        print(f"无法启动Web服务器: {e}")
        return False
    except Exception as e:
        print(f"Web服务器启动失败: {e}")
        return False


def main():
    """应用程序主入口函数"""
    # 启动Web服务器
    start_web_server()
    
    # 创建主窗口
    root = ttk.Window(themename="litera")
    app = MultiScraperApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()