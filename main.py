import os
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog
import ttkbootstrap as ttk
from ttkbootstrap.constants import *
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
import threading
import re
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin
from collections import deque
import time
import subprocess
import shutil
import random
import webbrowser
import psutil
import queue

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager

try:
    from PIL import Image, UnidentifiedImageError
    import pillow_avif
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False

HISTORY_FILE = 'history.json'
CONFIG_FILE = 'config.json'
FAILED_TASKS_FILE = 'failed_tasks.txt'

class ImageScraperApp:
    def __init__(self, root):
        self.root = root
        self.root.title("PuchiPix-噗呲专用 v1.9.2")
        self.root.geometry("1500x800")
        
        self.setup_styles()
        
        self.task_queue = deque()
        self.all_tasks_map = {}
        self.failed_tasks_list = []
        self.is_running = False
        self.stop_requested = False
        self.task_thread = None
        self.driver_pool = None
        self.driver_instances = []
        self.base_headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'}
        self.custom_tags = []
        self.session = self.create_robust_session()
        self.is_batch_mode = False
        self.batch_start_time = None
        self.task_id_counter = 0
        self.success_count = 0
        self.failed_count = 0
        self.current_queue_filter = "All"
        self.batch_window = None
        self.unattended_timer = None

        self.psutil_process = psutil.Process(os.getpid())
        self.total_bytes_downloaded = 0
        self.last_check_time = time.time()
        self.last_check_bytes = 0
        self.byte_counter_lock = threading.Lock()

        main_container = ttk.Frame(root)
        main_container.pack(fill=BOTH, expand=True, padx=10, pady=10)

        main_container.grid_columnconfigure(0, weight=2, minsize=300)
        main_container.grid_columnconfigure(1, weight=2, minsize=400)
        main_container.grid_columnconfigure(2, weight=3, minsize=500)
        main_container.grid_rowconfigure(0, weight=1)

        left_pane = ttk.Frame(main_container)
        left_pane.grid(row=0, column=0, sticky="nsew")
        
        middle_pane = ttk.Frame(main_container)
        middle_pane.grid(row=0, column=1, sticky="nsew", padx=(10, 10))

        right_pane = ttk.Frame(main_container)
        right_pane.grid(row=0, column=2, sticky="nsew")

        search_frame = ttk.Frame(left_pane)
        search_frame.pack(fill=X, pady=(0, 5))
        ttk.Label(search_frame, text="搜索历史:").pack(side=LEFT, padx=(0, 5))
        self.search_var = tk.StringVar()
        self.search_var.trace("w", self.filter_history)
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var)
        self.search_entry.pack(fill=X, expand=True, side=LEFT)
        ttk.Button(search_frame, text="清空历史", command=self.clear_history, bootstyle="outline-danger").pack(side=RIGHT, padx=(5,0))

        self.history_frame_container = ttk.Labelframe(left_pane, text="下载历史", padding=5)
        self.history_frame_container.pack(fill=BOTH, expand=True)
        
        history_tree_frame = ttk.Frame(self.history_frame_container)
        history_tree_frame.pack(fill=BOTH, expand=True)

        cols = ("标题", "数量", "Tags")
        self.history_tree = ttk.Treeview(history_tree_frame, columns=cols, show='headings')
        self.history_tree.column("标题", width=180); self.history_tree.heading("标题", text="标题")
        self.history_tree.column("数量", width=100, anchor='center'); self.history_tree.heading("数量", text="数量")
        self.history_tree.column("Tags", width=120); self.history_tree.heading("Tags", text="Tags")
        self.history_tree.pack(side=LEFT, fill=BOTH, expand=True)
        self.history_tree.bind("<Button-3>", self.copy_history_url)
        scrollbar = ttk.Scrollbar(history_tree_frame, orient=VERTICAL, command=self.history_tree.yview); scrollbar.pack(side=RIGHT, fill=Y); self.history_tree.config(yscrollcommand=scrollbar.set)

        self.tags_filter_frame = ttk.Labelframe(left_pane, text="标签筛选", padding=10); self.tags_filter_frame.pack(fill=X, pady=(10,0))
        self.tags_buttons_frame = ttk.Frame(self.tags_filter_frame); self.tags_buttons_frame.pack(fill=X, pady=(0, 5))
        
        manage_tags_btn = ttk.Button(self.tags_filter_frame, text="管理自定义标签", command=self.open_tag_manager, bootstyle="outline-primary"); manage_tags_btn.pack(anchor='w')
        self.manage_tags_btn_ref = manage_tags_btn

        controls_frame = ttk.Frame(middle_pane); controls_frame.pack(fill=X, padx=5, pady=5)
        input_group = ttk.Frame(controls_frame); input_group.pack(fill=X, pady=(0,5))
        ttk.Label(input_group, text="ID/网址:", font=("Microsoft YaHei UI", 11)).pack(side=LEFT, padx=(5,2))
        self.url_entry = ttk.Entry(input_group)
        self.url_entry.pack(side=LEFT, expand=True, fill=X)
        self.add_task_button = ttk.Button(input_group, text="添加", command=self.add_task_from_entry); self.add_task_button.pack(side=LEFT, padx=(5,5))
        self.batch_add_button = ttk.Button(input_group, text="批量导入", command=self.open_batch_import_window); self.batch_add_button.pack(side=LEFT, padx=(0,5))
        self.batch_add_button_ref = self.batch_add_button
        self.settings_button = ttk.Button(input_group, text="高级设置", command=self.open_settings_window, bootstyle="outline-info"); self.settings_button.pack(side=LEFT)
        self.url_entry.bind("<Return>", self.add_task_from_entry)
        
        self.url_entry_menu = tk.Menu(self.root, tearoff=0)
        self.url_entry_menu.add_command(label="粘贴", command=self.paste_into_url_entry)
        self.url_entry.bind("<Button-3>", self.show_url_entry_menu)

        path_group = ttk.Frame(controls_frame); path_group.pack(fill=X, pady=(0,5))
        ttk.Label(path_group, text="保存位置:", font=("Microsoft YaHei UI", 11)).pack(side=LEFT, padx=(5,2))
        self.save_path_var = tk.StringVar(); self.save_path_entry = ttk.Entry(path_group, textvariable=self.save_path_var); self.save_path_entry.pack(side=LEFT, expand=True, fill=X, padx=(0, 5)); ttk.Button(path_group, text="...", command=self.select_save_path, width=4).pack(side=LEFT)

        main_options_frame = ttk.Frame(controls_frame); main_options_frame.pack(fill=X, pady=(5,10))
        self.download_video_var = tk.BooleanVar(value=True)
        self.debug_mode_var = tk.BooleanVar()
        self.unattended_mode_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(main_options_frame, text="下载视频", variable=self.download_video_var, bootstyle="round-toggle").pack(side=LEFT, padx=(5,10))
        ttk.Checkbutton(main_options_frame, text="调试模式(显示浏览器)", variable=self.debug_mode_var, bootstyle="round-toggle").pack(side=LEFT, padx=(0,10))
        ttk.Checkbutton(main_options_frame, text="无人值守", variable=self.unattended_mode_var, bootstyle="round-toggle").pack(side=LEFT, padx=(0,10))
        self.delay_label = ttk.Label(main_options_frame, text="任务延时: N/A")
        self.delay_label.pack(side=LEFT, padx=(10,0))
        
        self.ffmpeg_path_var = tk.StringVar()
        self.chromedriver_path_var = tk.StringVar()
        self.browser_var = tk.StringVar()
        self.threads_var = tk.StringVar(value="16")
        self.rename_format_var = tk.StringVar()
        self.concurrent_tasks_var = tk.StringVar(value="3")
        self.save_format_var = tk.StringVar(value="原始格式")
        
        task_buttons_group = ttk.Frame(middle_pane); task_buttons_group.pack(fill=X, padx=5, pady=5)
        self.start_tasks_button = ttk.Button(task_buttons_group, text="开始任务", command=self.start_task_processor, bootstyle=SUCCESS); self.start_tasks_button.pack(side=LEFT, expand=True, fill=X, padx=(0,5))
        self.stop_tasks_button = ttk.Button(task_buttons_group, text="停止任务", command=self.stop_task_processor, bootstyle=DANGER, state=tk.DISABLED); self.stop_tasks_button.pack(side=LEFT, expand=True, fill=X)
        
        progress_frame = ttk.Frame(middle_pane, padding=(5, 5))
        progress_frame.pack(fill=X)
        self.parse_progress = ttk.Progressbar(progress_frame, mode='determinate', bootstyle="info-striped")
        self.parse_progress.pack(fill=X, pady=(0, 2))
        self.download_progress = ttk.Progressbar(progress_frame, mode='determinate', bootstyle="success-striped")
        self.download_progress.pack(fill=X, pady=(2, 0))

        log_frame = ttk.Labelframe(middle_pane, text="日志输出", padding=10); log_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)
        self.log_area = tk.Text(log_frame, height=10, font=("Consolas", 10), relief="flat"); self.log_area.pack(side=LEFT, fill=BOTH, expand=True)
        log_scrollbar = ttk.Scrollbar(log_frame, orient=VERTICAL, command=self.log_area.yview); log_scrollbar.pack(side=RIGHT, fill=Y); self.log_area.config(yscrollcommand=log_scrollbar.set)
        clear_log_btn = ttk.Button(log_frame, text="清理", command=self.clear_log, bootstyle="secondary-outline", width=5)
        clear_log_btn.place(relx=1.0, rely=0, x=-5, y=5, anchor="ne")

        perf_frame = ttk.Labelframe(middle_pane, text="性能监控", padding=10)
        perf_frame.pack(fill=X, padx=5, pady=5)
        self.speed_label = ttk.Label(perf_frame, text="速度: 0 B/s")
        self.speed_label.pack(side=LEFT, padx=5)
        self.data_label = ttk.Label(perf_frame, text="已用流量: 0 B")
        self.data_label.pack(side=LEFT, padx=5)
        self.mem_label = ttk.Label(perf_frame, text="内存: 0 MB")
        self.mem_label.pack(side=LEFT, padx=5)
        self.cpu_label = ttk.Label(perf_frame, text="CPU: 0 %")
        self.cpu_label.pack(side=LEFT, padx=5)

        queue_top_bar = ttk.Frame(right_pane)
        queue_top_bar.pack(fill=X, padx=5, pady=5)
        self.queue_frame_label = ttk.Label(queue_top_bar, text="任务队列 (0)")
        self.queue_frame_label.pack(side=LEFT)
        self.stats_label_success = ttk.Label(queue_top_bar, text="成功: 0", foreground="green")
        self.stats_label_success.pack(side=LEFT, padx=(10, 5))
        self.stats_label_failed = ttk.Label(queue_top_bar, text="失败: 0", foreground="red", cursor="hand2")
        self.stats_label_failed.pack(side=LEFT, padx=5)
        self.stats_label_failed.bind("<Button-1>", self.open_failed_tasks_manager)

        filter_frame = ttk.Frame(right_pane)
        filter_frame.pack(fill=X, padx=5, pady=(0, 5))
        ttk.Button(filter_frame, text="全部", command=lambda: self.filter_queue_view("All"), bootstyle="primary-outline").pack(side=LEFT)
        ttk.Button(filter_frame, text="完成", command=lambda: self.filter_queue_view("✅ 完成"), bootstyle="success-outline").pack(side=LEFT, padx=5)
        ttk.Button(filter_frame, text="失败", command=lambda: self.filter_queue_view("❌"), bootstyle="danger-outline").pack(side=LEFT)
        ttk.Button(filter_frame, text="一键重试全部", command=self.retry_all_failed, bootstyle="danger").pack(side=LEFT, padx=(0,5))
        ttk.Button(filter_frame, text="等待中", command=lambda: self.filter_queue_view("⏳ 等待中"), bootstyle="secondary-outline").pack(side=LEFT, padx=5)

        self.queue_frame = ttk.Frame(right_pane); self.queue_frame.pack(fill=BOTH, expand=True, padx=5, pady=0)
        queue_cols = ("#", "ID", "当前操作", "进度", "状态", "可用操作")
        self.queue_tree = ttk.Treeview(self.queue_frame, columns=queue_cols, show='headings', height=5)
        self.queue_tree.pack(fill=BOTH, expand=True)
        for col in queue_cols: self.queue_tree.heading(col, text=col)
        self.queue_tree.column("#", width=40, anchor='center'); self.queue_tree.column("ID", width=80, anchor='center'); self.queue_tree.column("当前操作", width=80, anchor='center'); self.queue_tree.column("进度", width=60, anchor='center'); self.queue_tree.column("状态", width=100, anchor='center'); self.queue_tree.column("可用操作", width=80, anchor='center')
        self.queue_tree.bind("<Button-3>", self.show_queue_context_menu)
        self.queue_tree.bind("<Button-1>", self.on_queue_action_click)
        
        self.history_data = []; self.load_config(); self.load_and_display_history(); self.create_tags_buttons()
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.update_performance_stats()
    
    def setup_styles(self):
        style = ttk.Style.get_instance(); font_family = "Microsoft YaHei UI"; font_size = 10
        style.configure('.', font=(font_family, font_size)); style.configure('Treeview.Heading', font=(font_family, font_size, 'bold')); style.configure('TLabelframe.Label', font=(font_family, font_size, 'bold'))

    def create_robust_session(self):
        session = requests.Session(); retry_strategy = Retry(total=5, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["HEAD", "GET", "OPTIONS"])
        adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=100, pool_maxsize=100); session.mount("https://", adapter); session.mount("http://", adapter)
        return session

    def on_closing(self):
        self.stop_requested = True
        self.stop_task_processor(called_by_system=True)
        self.save_config()
        self.root.destroy()

    def load_config(self):
        defaults = {"save_path": os.path.join(os.path.expanduser("~"), "Desktop"), "ffmpeg_path": "", "chromedriver_path": "", "browser": "Chrome", "rename_format": "{id}_{num}", "custom_tags": [], "download_threads": "16", "debug_mode": False, "download_video": True, "concurrent_tasks": "3", "save_format": "原始格式", "unattended_mode": False}
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f: defaults.update(json.load(f))
        except (json.JSONDecodeError, IOError): pass
        self.save_path_var.set(defaults["save_path"]); self.ffmpeg_path_var.set(defaults["ffmpeg_path"]); self.chromedriver_path_var.set(defaults["chromedriver_path"]); self.browser_var.set(defaults["browser"]); self.rename_format_var.set(defaults["rename_format"]); self.custom_tags = defaults["custom_tags"]; self.threads_var.set(defaults["download_threads"]); self.debug_mode_var.set(defaults["debug_mode"]); self.download_video_var.set(defaults["download_video"]); self.concurrent_tasks_var.set(defaults["concurrent_tasks"]); self.save_format_var.set(defaults["save_format"]); self.unattended_mode_var.set(defaults["unattended_mode"])

    def save_config(self):
        config = {"save_path": self.save_path_var.get(), "ffmpeg_path": self.ffmpeg_path_var.get(), "chromedriver_path": self.chromedriver_path_var.get(), "browser": self.browser_var.get(), "rename_format": self.rename_format_var.get(), "custom_tags": self.custom_tags, "download_threads": self.threads_var.get(), "debug_mode": self.debug_mode_var.get(), "download_video": self.download_video_var.get(), "concurrent_tasks": self.concurrent_tasks_var.get(), "save_format": self.save_format_var.get(), "unattended_mode": self.unattended_mode_var.get()}
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f: json.dump(config, f, ensure_ascii=False, indent=4)
        except IOError: pass
    
    def open_settings_window(self):
        self.root.update_idletasks()
        settings_window = tk.Toplevel(self.root)
        settings_window.title("高级设置")
        settings_window.transient(self.root)
        btn_x, btn_y = self.settings_button.winfo_rootx(), self.settings_button.winfo_rooty()
        settings_window.geometry(f"550x520+{btn_x - 550 - 5}+{btn_y}")
        settings_window.grab_set()
        def on_close():
            settings_window.grab_release()
            settings_window.destroy()
        settings_window.protocol("WM_DELETE_WINDOW", on_close)
        main_frame = ttk.Frame(settings_window, padding=15)
        main_frame.pack(fill=BOTH, expand=True)
        dependency_paths_frame = ttk.Labelframe(main_frame, text="依赖路径设置", padding=10); dependency_paths_frame.pack(fill=X, pady=5)
        ffmpeg_frame = ttk.Frame(dependency_paths_frame); ffmpeg_frame.pack(fill=X, pady=2)
        ttk.Label(ffmpeg_frame, text="FFmpeg路径:", width=15, anchor="e").pack(side=LEFT, padx=(5,2))
        self.ffmpeg_entry = ttk.Entry(ffmpeg_frame, textvariable=self.ffmpeg_path_var); self.ffmpeg_entry.pack(side=LEFT, expand=True, fill=X, padx=(0, 5)); ttk.Button(ffmpeg_frame, text="...", command=self.select_ffmpeg_path, width=4).pack(side=LEFT)
        driver_frame = ttk.Frame(dependency_paths_frame); driver_frame.pack(fill=X, pady=2)
        ttk.Label(driver_frame, text="ChromeDriver路径:", width=15, anchor="e").pack(side=LEFT, padx=(5,2))
        self.driver_entry = ttk.Entry(driver_frame, textvariable=self.chromedriver_path_var); self.driver_entry.pack(side=LEFT, expand=True, fill=X, padx=(0, 5)); ttk.Button(driver_frame, text="...", command=self.select_driver_path, width=4).pack(side=LEFT)
        download_settings_frame = ttk.Labelframe(main_frame, text="下载设置", padding=10); download_settings_frame.pack(fill=X, pady=5)
        rename_frame = ttk.Frame(download_settings_frame); rename_frame.pack(fill=X, pady=2)
        ttk.Label(rename_frame, text="重命名格式:", width=15, anchor="e").pack(side=LEFT, padx=(5,2))
        rename_presets = ["{id}_{num}", "{title}_{num}", "{num}"]
        self.rename_combobox = ttk.Combobox(rename_frame, textvariable=self.rename_format_var, values=rename_presets, state="readonly", width=15); self.rename_combobox.pack(side=LEFT)
        format_frame = ttk.Frame(download_settings_frame); format_frame.pack(fill=X, pady=2)
        ttk.Label(format_frame, text="图片保存格式:", width=15, anchor="e").pack(side=LEFT, padx=(5,2))
        format_presets = ["原始格式", "JPG", "PNG"]
        self.format_combobox = ttk.Combobox(format_frame, textvariable=self.save_format_var, values=format_presets, state="readonly", width=15); self.format_combobox.pack(side=LEFT)
        if not PILLOW_AVAILABLE:
            self.format_combobox.config(state="disabled")
            ttk.Label(format_frame, text=" (需安装Pillow库)", foreground="red").pack(side=LEFT)
        adv_settings_group = ttk.Frame(download_settings_frame); adv_settings_group.pack(fill=X, pady=2)
        ttk.Label(adv_settings_group, text="图片下载线程数:", width=15, anchor="e").pack(side=LEFT, padx=(5,2)); self.threads_spinbox = ttk.Spinbox(adv_settings_group, from_=1, to=64, textvariable=self.threads_var, width=8); self.threads_spinbox.pack(side=LEFT)
        concurrent_tasks_frame = ttk.Frame(download_settings_frame); concurrent_tasks_frame.pack(fill=X, pady=2)
        ttk.Label(concurrent_tasks_frame, text="最大同时下载任务:", width=15, anchor="e").pack(side=LEFT, padx=(5,2)); self.concurrent_tasks_spinbox = ttk.Spinbox(concurrent_tasks_frame, from_=1, to=5, textvariable=self.concurrent_tasks_var, width=8); self.concurrent_tasks_spinbox.pack(side=LEFT)
        browser_frame = ttk.Frame(download_settings_frame); browser_frame.pack(fill=X, pady=2)
        ttk.Label(browser_frame, text="浏览器:", width=15, anchor="e").pack(side=LEFT, padx=(5,2))
        self.browser_combobox = ttk.Combobox(browser_frame, textvariable=self.browser_var, values=['Chrome'], state="readonly", width=10); self.browser_combobox.pack(side=LEFT)
        button_frame = ttk.Frame(main_frame); button_frame.pack(fill=X, side=BOTTOM, pady=(10,0))
        info_frame = ttk.Frame(main_frame); info_frame.pack(side=BOTTOM, fill=X, pady=(10, 0))
        ttk.Label(info_frame, text="咕咕牛撸管专用下载器 @2025").pack()
        repo_frame = ttk.Frame(info_frame); repo_frame.pack()
        ttk.Label(repo_frame, text="Github仓库地址:").pack(side=LEFT)
        link = ttk.Label(repo_frame, text="https://github.com/GuGuNiu/PuchiPix/", foreground="blue", cursor="hand2")
        link.pack(side=LEFT)
        link.bind("<Button-1>", lambda e: webbrowser.open_new("https://github.com/GuGuNiu/PuchiPix/"))
        ttk.Button(button_frame, text="关闭", command=on_close, bootstyle=PRIMARY).pack(side=RIGHT)
        self.root.wait_window(settings_window)

    def create_tags_buttons(self):
        for widget in self.tags_buttons_frame.winfo_children(): widget.destroy()
        preset_tags = ["黑丝", "白丝", "兔女郎", "Cos"]; all_tags = preset_tags + self.custom_tags
        row_frame = ttk.Frame(self.tags_buttons_frame); row_frame.pack(fill=X)
        for tag in all_tags:
            btn = ttk.Button(row_frame, text=tag, bootstyle="outline-secondary", command=lambda t=tag: self.search_by_tag(t)); btn.pack(side=LEFT, padx=2, pady=2)
    
    def open_tag_manager(self):
        self.root.update_idletasks()
        manager_window = tk.Toplevel(self.root); manager_window.title("管理自定义标签"); manager_window.transient(self.root)
        x = self.tags_filter_frame.winfo_rootx(); y = self.tags_filter_frame.winfo_rooty()
        manager_window.geometry(f"400x350+{x}+{y - 350 - 5}")
        manager_window.bind("<FocusOut>", lambda e: manager_window.destroy())
        main_frame = ttk.Frame(manager_window, padding=10); main_frame.pack(fill=tk.BOTH, expand=True); ttk.Label(main_frame, text="自定义标签列表:").pack(anchor='w')
        list_frame = ttk.Frame(main_frame); list_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        list_scrollbar = ttk.Scrollbar(list_frame); list_scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        tag_listbox = tk.Listbox(list_frame, yscrollcommand=list_scrollbar.set, selectmode=tk.EXTENDED); tag_listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True); list_scrollbar.config(command=tag_listbox.yview)
        def populate_listbox():
            tag_listbox.delete(0, tk.END)
            for tag in sorted(self.custom_tags): tag_listbox.insert(tk.END, tag)
        add_frame = ttk.Frame(main_frame, padding=(0, 10, 0, 5)); add_frame.pack(fill=X); ttk.Label(add_frame, text="添加新标签:").pack(anchor='w', pady=(0,5))
        new_tag_entry = ttk.Entry(add_frame); new_tag_entry.pack(side=LEFT, fill=X, expand=True, padx=(0, 10))
        def add_new_tag():
            new_tag = new_tag_entry.get().strip()
            if new_tag and new_tag not in self.custom_tags: self.custom_tags.append(new_tag); new_tag_entry.delete(0, tk.END); populate_listbox()
        add_button = ttk.Button(add_frame, text="添加", command=add_new_tag); add_button.pack(side=LEFT)
        new_tag_entry.bind("<Return>", lambda e: add_new_tag())
        button_frame = ttk.Frame(main_frame); button_frame.pack(fill=tk.X, pady=(10, 0))
        def delete_selected_tags():
            if not (selected_indices := tag_listbox.curselection()): return
            for tag in [tag_listbox.get(i) for i in selected_indices]:
                if tag in self.custom_tags: self.custom_tags.remove(tag)
            populate_listbox()
        delete_button = ttk.Button(button_frame, text="删除选中", command=delete_selected_tags, bootstyle=DANGER); delete_button.pack(side=LEFT)
        def on_manager_close(): self.save_config(); self.create_tags_buttons(); manager_window.destroy()
        close_button = ttk.Button(button_frame, text="关闭", command=on_manager_close, bootstyle=PRIMARY); close_button.pack(side=RIGHT)
        manager_window.protocol("WM_DELETE_WINDOW", on_manager_close); populate_listbox()

    def filter_history(self, *args):
        for item in self.history_tree.get_children(): self.history_tree.delete(item)
        search_term = self.search_var.get().lower()
        if not self.history_data: return
        filtered_data = [item for item in self.history_data if search_term in item.get('title', '').lower() or search_term in item.get('tags', '').lower() or search_term in str(item.get('id', '')).lower()]
        for item in reversed(filtered_data):
            gallery_id = item.get('id')
            if not gallery_id: continue
            image_count = item.get('image_count', -1); video_count = item.get('video_count', -1)
            if image_count != -1 and video_count != -1: quantity_str = f"{image_count} / {video_count}"
            else: quantity_str = f"{item.get('completed_count', 0)}/{item.get('total_count', 0)}"
            values = (item.get('title', ''), quantity_str, item.get('tags', '')); self.history_tree.insert("", "end", iid=gallery_id, values=values)

    def clear_history(self):
        if messagebox.askyesno("确认", "确定要清空所有下载历史记录吗？\n此操作不可恢复。"):
            self.history_data = [];
            if os.path.exists(HISTORY_FILE):
                try: os.remove(HISTORY_FILE)
                except OSError: pass
            self.filter_history(); self.log("下载历史已清空。", is_detail=False)

    def scrape_images(self, driver, task_id, gallery_id, save_path):
        try:
            if self.stop_requested: return False
            base_domain = "https://xx.knit.bid"; base_url = f"https://xx.knit.bid/article/{gallery_id}/"
            self.update_task_details(task_id, status="⚙️ 解析中", action="解析中...")
            driver.get(base_url)
            WebDriverWait(driver, 15).until(lambda d: d.execute_script('return document.readyState') == 'complete' and d.find_element(By.CSS_SELECTOR, "h1.focusbox-title"))
            if self.stop_requested: return False
            soup = BeautifulSoup(driver.page_source, 'html.parser'); title = soup.find('h1', class_='focusbox-title').get_text().strip()
            valid_title = re.sub(r'[\\/*?:"<>|]', '', title); gallery_path = os.path.join(save_path, valid_title); os.makedirs(gallery_path, exist_ok=True)
            tags_elements = soup.find('div', class_='article-tags'); tags = [a.get_text() for a in tags_elements.find_all('a')] if tags_elements else []
            image_urls, video_urls = set(), set()
            page_urls_tuples = []
            if pagination_container := soup.find('div', class_='pagination-container'):
                for link in pagination_container.select('a[data-page]'):
                    if (page_num_str := link.get('data-page')) and page_num_str.isdigit(): page_urls_tuples.append((int(page_num_str), f"{base_url}page/{page_num_str}/"))
            page_urls_tuples.sort(); sorted_urls = [base_url] + [url for _, url in page_urls_tuples]
            for i, url in enumerate(sorted_urls):
                if self.stop_requested: return False
                if i != 0: 
                    driver.get(url)
                    WebDriverWait(driver, 10).until(lambda d: d.execute_script('return document.readyState') == 'complete' and d.find_element(By.CSS_SELECTOR, "article.article-content"))
                if self.stop_requested: return False
                page_soup = BeautifulSoup(driver.page_source, 'html.parser')
                if video_source := page_soup.select_one('video > source[src*=".m3u8"]'): video_urls.add(urljoin(base_domain, video_source['src']))
                for img in page_soup.select('article.article-content img[data-src]'):
                    if '/static/images/' in img['data-src']: image_urls.add(urljoin(base_domain, img['data-src']))
                self.parse_progress['value'] = (i + 1) / len(sorted_urls) * 100
            if not video_urls and not image_urls: return False
            all_downloads, video_segment_map, temp_dir = [], {}, None
            download_headers = self.base_headers.copy(); download_headers['Referer'] = base_url
            if video_urls and self.download_video_var.get():
                video_url = list(video_urls)[0]; temp_dir = os.path.join(gallery_path, f"temp_{int(time.time())}"); os.makedirs(temp_dir, exist_ok=True)
                m3u8_content = self.session.get(video_url, headers=download_headers, timeout=15).text
                ts_urls = [urljoin(video_url, line.strip()) for line in m3u8_content.split('\n') if line and not line.startswith('#')]
                video_segment_map['output_path'] = os.path.join(gallery_path, f"{valid_title}.mp4"); video_segment_map['ts_paths'] = []
                for i, ts_url in enumerate(ts_urls):
                    ts_path = os.path.join(temp_dir, f"{i:05d}.ts"); all_downloads.append({'url': ts_url, 'path': ts_path, 'is_video': True}); video_segment_map['ts_paths'].append(ts_path)
            for i, img_url in enumerate(sorted(list(image_urls))):
                filename_base = self.rename_format_var.get().format(id=gallery_id, num=f"{i+1:03d}", title=valid_title)
                full_path_base = os.path.join(gallery_path, filename_base); all_downloads.append({'url': img_url, 'path': full_path_base, 'is_video': False})
            completed_count, total_downloads = 0, len(all_downloads)
            self.update_task_details(task_id, status="⚙️ 下载中", action="下载中...", progress_text=f"0/{total_downloads}")
            threads = int(self.threads_var.get())
            with ThreadPoolExecutor(max_workers=threads) as executor:
                for result in executor.map(self._execute_download_task, all_downloads):
                    if self.stop_requested: break
                    if result: completed_count += 1
                    self.update_task_details(task_id, progress_text=f"{completed_count}/{total_downloads}")
                    self.download_progress['value'] = (completed_count / total_downloads) * 100 if total_downloads > 0 else 0
            if video_segment_map and not self.stop_requested:
                self.update_task_details(task_id, status="⚙️ 合并中", action="合并视频...")
                ts_list_path = os.path.join(temp_dir, "filelist.txt")
                with open(ts_list_path, 'w', encoding='utf-8') as f:
                    for ts_path in video_segment_map['ts_paths']: f.write(f"file '{os.path.abspath(ts_path)}'\n")
                if not self._merge_ts_files_with_ffmpeg(ts_list_path, video_segment_map['output_path']): completed_count -= len(video_segment_map['ts_paths'])
            if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir)
            if self.stop_requested: return False
            if completed_count > 0:
                self.save_history({"id": gallery_id, "title": valid_title, "tags": ", ".join(tags), "path": gallery_path, "total_count": total_downloads, "completed_count": completed_count, "image_count": len(image_urls), "video_count": len(video_urls)})
            return completed_count > 0
        except Exception:
            return False

    def _transcode_image(self, source_path, target_format):
        if not PILLOW_AVAILABLE: return source_path
        try:
            img = Image.open(source_path)
            base_path, _ = os.path.splitext(source_path)
            new_path = source_path
            if target_format.lower() == 'jpg':
                if img.mode in ('RGBA', 'LA', 'P'): img = img.convert('RGB')
                new_path = base_path + '.jpg'; img.save(new_path, 'jpeg', quality=95)
            elif target_format.lower() == 'png':
                new_path = base_path + '.png'; img.save(new_path, 'png')
            if new_path != source_path: os.remove(source_path)
            return new_path
        except (UnidentifiedImageError, OSError, ValueError):
            return source_path

    def _execute_download_task(self, task):
        final_path = None
        try:
            if self.stop_requested: return None
            with self.session.get(task['url'], headers=self.base_headers, timeout=20, stream=True) as r:
                r.raise_for_status()
                base_path = task['path']
                content_type = r.headers.get('content-type', '').lower()
                ext_map = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif'}
                ext = ext_map.get(content_type, '.jpg')
                if any(base_path.lower().endswith(e) for e in ext_map.values()): base_path = os.path.splitext(base_path)[0]
                final_path = base_path + ext
                expected_size = int(r.headers.get('content-length', 0))
                with open(final_path, 'wb') as f:
                    downloaded_size = 0
                    for chunk in r.iter_content(chunk_size=8192):
                        if self.stop_requested: raise Exception("Task stopped by user")
                        f.write(chunk); downloaded_size += len(chunk)
                        with self.byte_counter_lock: self.total_bytes_downloaded += len(chunk)
                if expected_size != 0 and downloaded_size != expected_size: os.remove(final_path); return None
            target_format = self.save_format_var.get()
            if target_format != "原始格式": final_path = self._transcode_image(final_path, target_format)
            return final_path
        except Exception as e:
            if final_path and os.path.exists(final_path):
                try: os.remove(final_path)
                except OSError: pass
            if not isinstance(e, Exception) or str(e) != "Task stopped by user": self.log(f"下载失败: {os.path.basename(task['path'])}", is_detail=False)
            return None

    def _merge_ts_files_with_ffmpeg(self, ts_files_list_path, output_path):
        ffmpeg_path = self.ffmpeg_path_var.get()
        if not os.path.exists(ffmpeg_path): return False
        command = [ffmpeg_path, '-y', '-f', 'concat', '-safe', '0', '-i', ts_files_list_path, '-c', 'copy', output_path]
        try:
            subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW)
            return True
        except (subprocess.CalledProcessError, Exception):
            return False
        
    def load_and_display_history(self):
        self.history_data = self.load_history_file(); self.filter_history()
        
    def start_task_processor(self):
        if self.is_running: return
        tasks_to_run = [t for t in self.all_tasks_map.values() if t['status'] == "⏳ 等待中"]
        if not tasks_to_run: self.log("没有等待中的任务。", is_detail=False); return
        if self.unattended_timer: self.root.after_cancel(self.unattended_timer); self.unattended_timer = None
        self.is_running, self.stop_requested = True, False
        self.start_tasks_button.config(state=tk.DISABLED); self.stop_tasks_button.config(state=tk.NORMAL)
        self.is_batch_mode = len(self.all_tasks_map) > 1; self.batch_start_time = time.time()
        self.task_thread = threading.Thread(target=self.process_queue, args=(tasks_to_run,), daemon=True); self.task_thread.start()
        
    def stop_task_processor(self, called_by_system=False):
        if not self.is_running and not called_by_system: return
        self.stop_requested = True
        if not called_by_system: self.log(">>> 用户请求停止任务...", is_detail=False)
        self.stop_tasks_button.config(state=tk.DISABLED)
        self._shutdown_driver_pool(force=True)
                
    def process_queue(self, tasks_to_process):
        max_workers = int(self.concurrent_tasks_var.get())
        self._initialize_driver_pool(max_workers)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(self._task_worker, task) for task in tasks_to_process}
            for future in as_completed(futures):
                if self.stop_requested:
                    for f in futures: f.cancel()
                    break
        self.on_queue_finished()

    def on_queue_finished(self):
        self.is_running = False
        self._shutdown_driver_pool()
        self.root.after(0, lambda: (self.start_tasks_button.config(state=tk.NORMAL), self.stop_tasks_button.config(state=tk.DISABLED), self.delay_label.config(text="任务延时: N/A")))
        self.save_failed_tasks_to_file()
        if self.unattended_mode_var.get() and self.failed_tasks_list and not self.stop_requested:
            self.schedule_unattended_retry()

    def schedule_unattended_retry(self):
        if self.unattended_timer: self.root.after_cancel(self.unattended_timer)
        delay_seconds = random.randint(1800, 3600); minutes, seconds = divmod(delay_seconds, 60)
        self.log(f"无人值守：将在 {minutes}分{seconds}秒 后自动重试失败任务。", is_detail=False)
        self.unattended_timer = self.root.after(delay_seconds * 1000, self.retry_all_failed)
        
    def _task_worker(self, task):
        try:
            if self.stop_requested: return
            self.update_task_details(task['id'], status="⚙️ 进行中")
            gallery_id = task.get('gallery_id')
            if gallery_id:
                driver = self.driver_pool.get()
                try:
                    if self.stop_requested: return
                    success = self.scrape_images(driver, task['id'], gallery_id, task['path'])
                finally:
                    self.driver_pool.put(driver)
                if self.stop_requested: return
                if success:
                    self.update_task_details(task['id'], status="✅ 完成", action="", operation="打开")
                    with self.byte_counter_lock: self.success_count += 1
                else:
                    self.update_task_details(task['id'], status="❌", action="", operation="重试")
                    with self.byte_counter_lock:
                        if task not in self.failed_tasks_list: self.failed_tasks_list.append(task)
                        self.failed_count += 1
            else:
                self.update_task_details(task['id'], status="❌", action="")
                with self.byte_counter_lock: self.failed_count += 1
            self.root.after(0, self._update_stats_labels)
        finally:
            if self.is_running and not self.stop_requested:
                delay = random.randint(3, 30)
                self.root.after(0, lambda: self.delay_label.config(text=f"任务延时: {delay}s"))
                for _ in range(delay):
                    if self.stop_requested: break
                    time.sleep(1)

    def _initialize_driver_pool(self, size):
        self.driver_instances.clear()
        self.driver_pool = queue.Queue(maxsize=size)
        for _ in range(size):
            if self.stop_requested: break
            chromedriver_path, local_driver_path = self.chromedriver_path_var.get(), os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chromedriver.exe')
            options = webdriver.ChromeOptions(); options.add_argument('--ignore-certificate-errors'); options.add_argument('--log-level=3')
            if not self.debug_mode_var.get(): options.add_argument('--headless'); options.add_argument('--disable-gpu')
            try:
                service = None
                if chromedriver_path and os.path.exists(chromedriver_path): service = ChromeService(executable_path=chromedriver_path)
                elif os.path.exists(local_driver_path): service = ChromeService(executable_path=local_driver_path)
                else: service = ChromeService(ChromeDriverManager().install())
                if not service: raise Exception("无法初始化ChromeDriver服务。")
                driver = webdriver.Chrome(service=service, options=options)
                self.driver_pool.put(driver)
                self.driver_instances.append(driver)
            except Exception: pass

    def _shutdown_driver_pool(self, force=False):
        for driver in self.driver_instances:
            try: driver.quit()
            except Exception: pass
        self.driver_instances.clear()
        if self.driver_pool:
            while not self.driver_pool.empty():
                try: self.driver_pool.get_nowait()
                except queue.Empty: break

    def add_task_from_entry(self, event=None):
        user_input = self.url_entry.get().strip()
        if not user_input: return
        if not self.save_path_var.get(): messagebox.showerror("错误", "请先选择保存位置"); return
        self._add_task(user_input, self.save_path_var.get()); self.url_entry.delete(0, tk.END)

    def _add_task(self, user_input, save_path):
        self.task_id_counter += 1
        task_id = f"task_{int(time.time() * 1000)}_{self.task_id_counter}"
        gallery_id = None
        if match := re.search(r'/article/(\d+)', user_input): gallery_id = match.group(1)
        elif user_input.isdigit(): gallery_id = user_input
        task_data = {'id': task_id, 'input': user_input, 'path': save_path, 'gallery_id': gallery_id, 'status': "⏳ 等待中", 'action': '', 'progress_text': '', 'operation': ''}
        self.all_tasks_map[task_id] = task_data
        task_num = len(self.all_tasks_map)
        self.queue_tree.insert("", "end", iid=task_id, values=(task_num, gallery_id or "N/A", "", "", "⏳ 等待中", ""))
        self._update_task_count_label()

    def _update_task_count_label(self):
        count = len(self.all_tasks_map)
        self.queue_frame_label.config(text=f"任务队列 ({count})")

    def _update_stats_labels(self):
        self.stats_label_success.config(text=f"成功: {self.success_count}")
        self.stats_label_failed.config(text=f"失败: {self.failed_count}")

    def open_batch_import_window(self):
        if self.batch_window and self.batch_window.winfo_exists():
            self.batch_window.lift(); self.batch_window.focus_set(); return
        self.root.update_idletasks()
        self.batch_window = tk.Toplevel(self.root); self.batch_window.title("批量导入任务"); self.batch_window.transient(self.root)
        btn_x, btn_y = self.batch_add_button_ref.winfo_rootx(), self.batch_add_button_ref.winfo_rooty()
        self.batch_window.geometry(f"500x400+{btn_x - 500 - 5}+{btn_y}")
        self.batch_window.grab_set()
        def on_close(): self.batch_window.grab_release(); self.batch_window.destroy(); self.batch_window = None
        self.batch_window.protocol("WM_DELETE_WINDOW", on_close)
        main_frame = ttk.Frame(self.batch_window, padding=15); main_frame.pack(fill=tk.BOTH, expand=True)
        ttk.Label(main_frame, text="请每行粘贴一个ID或网址（可在此处编辑）：").pack(anchor='w', pady=(0, 5))
        button_frame = ttk.Frame(main_frame, padding=(0, 15, 0, 0)); button_frame.pack(fill=tk.X, side=BOTTOM)
        status_frame = ttk.Frame(main_frame, padding=(0,5,0,0)); status_frame.pack(fill=X, side=BOTTOM)
        line_count_label = ttk.Label(status_frame, text="检测到 0 个有效任务"); line_count_label.pack(side=LEFT)
        text_frame = ttk.Frame(main_frame); text_frame.pack(fill=tk.BOTH, expand=True)
        scrollbar = ttk.Scrollbar(text_frame); scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        text_widget = tk.Text(text_frame, yscrollcommand=scrollbar.set, relief="solid", borderwidth=1); text_widget.pack(side=tk.LEFT, fill=tk.BOTH, expand=True); scrollbar.config(command=text_widget.yview)
        def update_line_count(event=None):
            valid_lines = len([line for line in text_widget.get("1.0", tk.END).splitlines() if line.strip()])
            line_count_label.config(text=f"检测到 {valid_lines} 个有效任务")
        text_widget.bind("<KeyRelease>", update_line_count)
        def process_import():
            if not self.save_path_var.get(): messagebox.showerror("错误", "请先在主界面选择保存位置", parent=self.batch_window); return
            urls = text_widget.get("1.0", tk.END).splitlines(); imported_count = 0
            for url in urls:
                user_input = url.strip()
                if user_input: self._add_task(user_input, self.save_path_var.get()); imported_count += 1
            if imported_count > 0: self.log(f"成功批量导入 {imported_count} 个任务。", is_detail=False)
            on_close()
        text_widget.bind("<Control-Return>", lambda e: process_import())
        ttk.Button(button_frame, text="导入任务队列 (Ctrl+Enter)", command=process_import, bootstyle=SUCCESS).pack(side=RIGHT)
        ttk.Button(button_frame, text="取消", command=on_close, bootstyle=SECONDARY).pack(side=RIGHT, padx=(0, 10))
        update_line_count()
        self.root.wait_window(self.batch_window)

    def log(self, message, is_detail=True):
        if self.is_batch_mode and is_detail: return
        self.root.after(0, self._log, message)

    def _log(self, message):
        self.log_area.insert(tk.END, f"[{time.strftime('%H:%M:%S')}] {message}\n"); self.log_area.see(tk.END)
        
    def select_save_path(self):
        if path := filedialog.askdirectory(): self.save_path_var.set(path)
            
    def select_ffmpeg_path(self):
        if path := filedialog.askopenfilename(title="选择ffmpeg.exe", filetypes=[("Executable", "*.exe")]): self.ffmpeg_path_var.set(path)

    def select_driver_path(self):
        if path := filedialog.askopenfilename(title="选择chromedriver.exe", filetypes=[("Executable", "*.exe")]): self.chromedriver_path_var.set(path)
        
    def load_history_file(self):
        if not os.path.exists(HISTORY_FILE): return []
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f: return json.load(f)
        except (json.JSONDecodeError, IOError): return []
        
    def save_history(self, new_entry):
        history = self.load_history_file(); found = False
        for i, entry in enumerate(history):
            if entry.get("id") == new_entry["id"]: history[i], found = new_entry, True; break
        if not found: history.append(new_entry)
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f: json.dump(history, f, ensure_ascii=False, indent=4)
        self.root.after(0, self.load_and_display_history)
        
    def update_task_details(self, task_id, **kwargs):
        task = self.all_tasks_map.get(task_id)
        if task: task.update(kwargs)
        def _update():
            try:
                if self.queue_tree.exists(task_id):
                    col_map = {"action": "当前操作", "progress_text": "进度", "status": "状态", "operation": "可用操作"}
                    for key, value in kwargs.items():
                        if col_name := col_map.get(key): self.queue_tree.set(task_id, column=col_name, value=value)
            except tk.TclError: pass
        self.root.after(0, _update)
        
    def search_by_tag(self, tag): self.search_var.set(tag)

    def show_toast(self, message, event):
        toast = tk.Toplevel(self.root); toast.overrideredirect(True); toast.attributes("-alpha", 0.9)
        label = ttk.Label(toast, text=message, padding=10, bootstyle="inverse-primary"); label.pack()
        toast.update_idletasks()
        x = event.x_root - toast.winfo_width() // 2; y = event.y_root - toast.winfo_height() - 10
        toast.geometry(f"+{x}+{y}"); toast.after(1500, toast.destroy)

    def show_url_entry_menu(self, event): self.url_entry_menu.post(event.x_root, event.y_root)

    def paste_into_url_entry(self):
        try: self.url_entry.delete(0, tk.END); self.url_entry.insert(0, self.root.clipboard_get())
        except tk.TclError: pass

    def clear_log(self): self.log_area.delete('1.0', tk.END)

    def open_failed_tasks_manager(self, event=None):
        if not self.failed_tasks_list:
            if event: self.show_toast("当前没有失败的任务", event)
            return
        manager = tk.Toplevel(self.root); manager.title("失败任务管理"); manager.transient(self.root); manager.grab_set()
        width, height = 600, 400; x = event.x_root - width - 10; y = event.y_root - 20
        manager.geometry(f"{width}x{height}+{x}+{y}"); manager.bind("<FocusOut>", lambda e: manager.destroy())
        main_frame = ttk.Frame(manager, padding=10); main_frame.pack(fill=BOTH, expand=True)
        list_frame = ttk.Frame(main_frame); list_frame.pack(fill=BOTH, expand=True, pady=5)
        scrollbar = ttk.Scrollbar(list_frame); scrollbar.pack(side=RIGHT, fill=Y)
        listbox = tk.Listbox(list_frame, yscrollcommand=scrollbar.set); listbox.pack(side=LEFT, fill=BOTH, expand=True); scrollbar.config(command=listbox.yview)
        for task in self.failed_tasks_list: listbox.insert(tk.END, task['input'])
        button_frame = ttk.Frame(main_frame); button_frame.pack(fill=X, pady=(10, 0))
        def copy_all_failed():
            all_urls = "\n".join([task['input'] for task in self.failed_tasks_list])
            self.root.clipboard_clear(); self.root.clipboard_append(all_urls)
            self.show_toast("已复制所有失败链接", event)
        ttk.Button(button_frame, text="一键复制全部链接", command=copy_all_failed).pack(side=LEFT, expand=True, fill=X, padx=(0, 5))
        ttk.Button(button_frame, text="关闭", command=manager.destroy).pack(side=LEFT, expand=True, fill=X)

    def retry_all_failed(self):
        if self.is_running: messagebox.showerror("错误", "任务处理器正在运行中，请先停止。"); return
        if not self.failed_tasks_list: self.log("没有失败的任务可重试。", is_detail=False); return
        tasks_to_retry = list(self.failed_tasks_list); self.failed_tasks_list.clear()
        self.failed_count = 0; self._update_stats_labels()
        for task in tasks_to_retry: self.update_task_details(task['id'], status="⏳ 等待中", action="", operation="")
        self.log(f"已将 {len(tasks_to_retry)} 个失败任务重新加入队列。", is_detail=False)
        self.filter_queue_view(self.current_queue_filter); self.start_task_processor()
    
    def save_failed_tasks_to_file(self):
        failed_urls = [task['input'] for task in self.all_tasks_map.values() if task['status'] == '❌']
        if not failed_urls:
            if os.path.exists(FAILED_TASKS_FILE):
                try: os.remove(FAILED_TASKS_FILE)
                except OSError: pass
            return
        try:
            with open(FAILED_TASKS_FILE, 'w', encoding='utf-8') as f:
                for url in failed_urls: f.write(url + '\n')
            self.log(f"已将 {len(failed_urls)} 个失败任务网址备份到 failed_tasks.txt", is_detail=False)
        except IOError:
            self.log("备份失败任务列表时发生错误。", is_detail=False)

    def show_queue_context_menu(self, event):
        item_id = self.queue_tree.identify_row(event.y)
        if not item_id: return
        self.queue_tree.selection_set(item_id)
        menu = tk.Menu(self.root, tearoff=0); col_id = self.queue_tree.identify_column(event.x)
        if col_id == "#2": menu.add_command(label="复制完整网址", command=lambda: self.copy_queue_url(event))
        else: menu.add_command(label="修改链接", command=self.modify_selected_task)
        menu.add_separator(); menu.add_command(label="上移", command=self.move_task_up); menu.add_command(label="下移", command=self.move_task_down)
        menu.post(event.x_root, event.y_root)

    def copy_history_url(self, event):
        item_id = self.history_tree.identify_row(event.y)
        if not item_id: return
        url = f"https://xx.knit.bid/article/{item_id}/"; self.root.clipboard_clear(); self.root.clipboard_append(url); self.show_toast("已复制到剪贴板", event)

    def copy_queue_url(self, event):
        if not (item_id := self.queue_tree.identify_row(event.y)): return
        if not (task := self.all_tasks_map.get(item_id)): return
        self.root.clipboard_clear(); self.root.clipboard_append(task['input']); self.show_toast("已复制到剪贴板", event)

    def modify_selected_task(self):
        selected_items = self.queue_tree.selection()
        if not selected_items: return
        item_id = selected_items[0]
        task = self.all_tasks_map.get(item_id)
        if not task: return
        dialog = tk.Toplevel(self.root); dialog.title("修改链接"); dialog.geometry("500x120"); dialog.transient(self.root); dialog.grab_set()
        ttk.Label(dialog, text="请输入新的ID或完整网址:").pack(padx=10, pady=5, anchor='w')
        url_var = tk.StringVar(value=task['input']); entry = ttk.Entry(dialog, textvariable=url_var, width=80); entry.pack(padx=10, pady=5, fill=X, expand=True)
        entry.focus_set(); entry.selection_range(0, tk.END); result = {"value": None}
        def on_ok(): result["value"] = url_var.get(); dialog.destroy()
        def on_cancel(): dialog.destroy()
        btn_frame = ttk.Frame(dialog); btn_frame.pack(padx=10, pady=10, fill=X)
        ttk.Button(btn_frame, text="确定", command=on_ok, bootstyle=SUCCESS).pack(side=RIGHT)
        ttk.Button(btn_frame, text="取消", command=on_cancel).pack(side=RIGHT, padx=5)
        self.root.wait_window(dialog)
        new_url = result["value"]
        if new_url and new_url.strip() != task['input']:
            new_url = new_url.strip(); task['input'] = new_url
            gallery_id = None
            if match := re.search(r'/article/(\d+)', new_url): gallery_id = match.group(1)
            elif new_url.isdigit(): gallery_id = new_url
            task['gallery_id'] = gallery_id
            self.queue_tree.set(item_id, column="ID", value=gallery_id or "N/A")

    def move_task_up(self):
        selected_items = self.queue_tree.selection()
        if not selected_items: return
        item_id = selected_items[0]
        self.queue_tree.move(item_id, self.queue_tree.parent(item_id), self.queue_tree.index(item_id) - 1)
        self.renumber_queue_view()

    def move_task_down(self):
        selected_items = self.queue_tree.selection()
        if not selected_items: return
        item_id = selected_items[0]
        self.queue_tree.move(item_id, self.queue_tree.parent(item_id), self.queue_tree.index(item_id) + 1)
        self.renumber_queue_view()

    def renumber_queue_view(self):
        for i, item_id in enumerate(self.queue_tree.get_children()): self.queue_tree.set(item_id, column="#", value=i + 1)

    def filter_queue_view(self, status_filter):
        self.current_queue_filter = status_filter
        for item in self.queue_tree.get_children(): self.queue_tree.delete(item)
        task_num = 0
        for task_id, task in self.all_tasks_map.items():
            current_status = task.get('status', '')
            show = (status_filter == "All" or (status_filter == "❌" and "❌" in current_status) or status_filter == current_status)
            if show:
                task_num += 1
                values = (task_num, task.get('gallery_id', 'N/A'), task.get('action', ''), task.get('progress_text', ''), current_status, task.get('operation', ''))
                self.queue_tree.insert("", "end", iid=task_id, values=values)

    def on_queue_action_click(self, event):
        region = self.queue_tree.identify_region(event.x, event.y)
        if region != "cell": return
        item_id = self.queue_tree.identify_row(event.y); col_id = self.queue_tree.identify_column(event.x)
        if col_id == "#6":
            action = self.queue_tree.item(item_id, "values")[5]
            task = self.all_tasks_map.get(item_id)
            if not task: return
            if action == "打开":
                try: os.startfile(task['path'])
                except Exception: pass
            elif action == "重试":
                if self.is_running: self.show_toast("请等待当前任务队列完成", event); return
                task_to_retry = next((t for t in self.failed_tasks_list if t['id'] == item_id), None)
                if task_to_retry:
                    self.failed_tasks_list.remove(task_to_retry); self.failed_count -= 1; self._update_stats_labels()
                    self.update_task_details(item_id, status="⏳ 等待中", action="", operation=""); self.start_task_processor()

    def format_bytes(self, size):
        if size < 1024: return f"{size} B"
        elif size < 1024**2: return f"{size/1024:.2f} KB"
        elif size < 1024**3: return f"{size/1024**2:.2f} MB"
        else: return f"{size/1024**3:.2f} GB"

    def update_performance_stats(self):
        current_time = time.time(); time_delta = current_time - self.last_check_time
        with self.byte_counter_lock: bytes_delta = self.total_bytes_downloaded - self.last_check_bytes; total_bytes = self.total_bytes_downloaded
        if time_delta > 0: speed = bytes_delta / time_delta; self.speed_label.config(text=f"速度: {self.format_bytes(speed)}/s")
        self.data_label.config(text=f"已用流量: {self.format_bytes(total_bytes)}")
        self.last_check_time = current_time; self.last_check_bytes = total_bytes
        mem_usage = self.psutil_process.memory_info().rss / (1024 * 1024)
        self.mem_label.config(text=f"内存: {mem_usage:.2f} MB")
        cpu_usage = self.psutil_process.cpu_percent(interval=None)
        self.cpu_label.config(text=f"CPU: {cpu_usage:.2f} %")
        self.root.after(1000, self.update_performance_stats)

if __name__ == "__main__":
    root = ttk.Window(themename="litera")
    app = ImageScraperApp(root)
    root.mainloop()