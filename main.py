import os
import tkinter as tk
from tkinter import filedialog, messagebox
import ttkbootstrap as ttk
from ttkbootstrap.constants import *
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup
import threading
import re
import json
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin
from collections import deque
import time
import subprocess
import shutil
import random

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager

HISTORY_FILE = 'history.json'
CONFIG_FILE = 'config.json'

class ImageScraperApp:
    def __init__(self, root):
        self.root = root
        self.root.title("PuchiPix-噗呲专用 v1.7.0")
        self.root.geometry("1300x800")
        
        self.setup_styles()
        
        self.task_queue = deque()
        self.is_running = False
        self.stop_requested = False
        self.task_thread = None
        self.base_headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'}
        self.custom_tags = []
        self.session = self.create_robust_session()
        self.is_batch_mode = False
        self.batch_start_time = None
        self.task_id_counter = 0 

        main_paned_window = ttk.PanedWindow(root, orient=HORIZONTAL)
        main_paned_window.pack(fill=BOTH, expand=True, padx=10, pady=10)
        
        left_pane = ttk.Frame(main_paned_window)
        main_paned_window.add(left_pane, weight=2)
        
        search_frame = ttk.Frame(left_pane)
        search_frame.pack(fill=X, pady=(0, 5))
        ttk.Label(search_frame, text="搜索历史:").pack(side=LEFT, padx=(0, 5))
        self.search_var = tk.StringVar()
        self.search_var.trace("w", self.filter_history)
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var)
        self.search_entry.pack(fill=X, expand=True, side=LEFT)
        ttk.Button(search_frame, text="清空历史", command=self.clear_history, bootstyle="outline-danger").pack(side=RIGHT, padx=(5,0))

        history_frame_container = ttk.Labelframe(left_pane, text="下载历史", padding=5)
        history_frame_container.pack(fill=BOTH, expand=True)
        
        history_tree_frame = ttk.Frame(history_frame_container)
        history_tree_frame.pack(fill=BOTH, expand=True)

        cols = ("ID", "标题", "数量", "Tags")
        self.history_tree = ttk.Treeview(history_tree_frame, columns=cols, show='headings')
        self.history_tree.column("ID", width=40, anchor='center'); self.history_tree.heading("ID", text="ID")
        self.history_tree.column("标题", width=200); self.history_tree.heading("标题", text="标题")
        self.history_tree.column("数量", width=50, anchor='center'); self.history_tree.heading("数量", text="数量")
        self.history_tree.column("Tags", width=150); self.history_tree.heading("Tags", text="Tags")
        self.history_tree.pack(side=LEFT, fill=BOTH, expand=True)
        scrollbar = ttk.Scrollbar(history_tree_frame, orient=VERTICAL, command=self.history_tree.yview); scrollbar.pack(side=RIGHT, fill=Y); self.history_tree.config(yscrollcommand=scrollbar.set)

        tags_filter_frame = ttk.Labelframe(left_pane, text="标签筛选", padding=10); tags_filter_frame.pack(fill=X, pady=(10,0))
        self.tags_buttons_frame = ttk.Frame(tags_filter_frame); self.tags_buttons_frame.pack(fill=X, pady=(0, 5))
        
        manage_tags_btn = ttk.Button(tags_filter_frame, text="管理自定义标签", command=self.open_tag_manager, bootstyle="outline-primary"); manage_tags_btn.pack(anchor='w')
        self.manage_tags_btn_ref = manage_tags_btn

        right_pane = ttk.Frame(main_paned_window); main_paned_window.add(right_pane, weight=3)
        controls_frame = ttk.Frame(right_pane); controls_frame.pack(fill=X, padx=5, pady=5)
        input_group = ttk.Frame(controls_frame); input_group.pack(fill=X, pady=(0,5))
        ttk.Label(input_group, text="ID/网址:", font=("Microsoft YaHei UI", 11)).pack(side=LEFT, padx=(5,2))
        self.url_entry = ttk.Entry(input_group); self.url_entry.pack(side=LEFT, expand=True, fill=X)
        self.add_task_button = ttk.Button(input_group, text="添加", command=self.add_task_from_entry); self.add_task_button.pack(side=LEFT, padx=(5,5))
        self.batch_add_button = ttk.Button(input_group, text="批量导入", command=self.open_batch_import_window); self.batch_add_button.pack(side=LEFT, padx=(0,5))
        self.batch_add_button_ref = self.batch_add_button
        self.settings_button = ttk.Button(input_group, text="高级设置", command=self.open_settings_window, bootstyle="outline-info"); self.settings_button.pack(side=LEFT)
        self.url_entry.bind("<Return>", self.add_task_from_entry)
        
        path_group = ttk.Frame(controls_frame); path_group.pack(fill=X, pady=(0,5))
        ttk.Label(path_group, text="保存位置:", font=("Microsoft YaHei UI", 11)).pack(side=LEFT, padx=(5,2))
        self.save_path_var = tk.StringVar(); self.save_path_entry = ttk.Entry(path_group, textvariable=self.save_path_var); self.save_path_entry.pack(side=LEFT, expand=True, fill=X, padx=(0, 5)); ttk.Button(path_group, text="...", command=self.select_save_path, width=4).pack(side=LEFT)

        main_options_frame = ttk.Frame(controls_frame); main_options_frame.pack(fill=X, pady=(5,10))
        self.download_video_var = tk.BooleanVar(value=True)
        self.debug_mode_var = tk.BooleanVar()
        ttk.Checkbutton(main_options_frame, text="下载视频", variable=self.download_video_var, bootstyle="round-toggle").pack(side=LEFT, padx=(5,10))
        ttk.Checkbutton(main_options_frame, text="调试模式(显示浏览器)", variable=self.debug_mode_var, bootstyle="round-toggle").pack(side=LEFT, padx=(0,10))
        ttk.Label(main_options_frame, text="任务延时: 自动(3-30s)").pack(side=LEFT, padx=(10,0))
        
        self.ffmpeg_path_var = tk.StringVar()
        self.chromedriver_path_var = tk.StringVar()
        self.browser_var = tk.StringVar()
        self.threads_var = tk.StringVar(value="16")
        self.rename_format_var = tk.StringVar()
        
        task_buttons_group = ttk.Frame(right_pane); task_buttons_group.pack(fill=X, padx=5, pady=5)
        self.start_tasks_button = ttk.Button(task_buttons_group, text="开始任务", command=self.start_task_processor, bootstyle=SUCCESS); self.start_tasks_button.pack(side=LEFT, expand=True, fill=X, padx=(0,5))
        self.stop_tasks_button = ttk.Button(task_buttons_group, text="停止任务", command=self.stop_task_processor, bootstyle=DANGER, state=tk.DISABLED); self.stop_tasks_button.pack(side=LEFT, expand=True, fill=X)
        
        log_frame = ttk.Labelframe(right_pane, text="日志输出", padding=10); log_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)
        self.log_area = tk.Text(log_frame, height=10, font=("Consolas", 10), relief="flat"); self.log_area.pack(side=LEFT, fill=BOTH, expand=True)
        log_scrollbar = ttk.Scrollbar(log_frame, orient=VERTICAL, command=self.log_area.yview); log_scrollbar.pack(side=RIGHT, fill=Y); self.log_area.config(yscrollcommand=log_scrollbar.set)
        
        self.queue_frame = ttk.Labelframe(right_pane, text="任务队列 (0)", padding=10); self.queue_frame.pack(fill=X, padx=5, pady=5)
        queue_cols = ("ID/网址", "保存路径", "状态"); self.queue_tree = ttk.Treeview(self.queue_frame, columns=queue_cols, show='headings', height=5); self.queue_tree.pack(fill=BOTH, expand=True)
        for col in queue_cols: self.queue_tree.heading(col, text=col)
        self.queue_tree.column("ID/网址", width=200); self.queue_tree.column("保存路径", width=300); self.queue_tree.column("状态", width=100, anchor='center')
        
        self.progress = ttk.Progressbar(right_pane, mode='determinate', bootstyle="striped"); self.progress.pack(fill=X, padx=5, pady=(5,5))
        
        self.history_data = []; self.load_config(); self.load_and_display_history(); self.create_tags_buttons()
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
    
    def setup_styles(self):
        style = ttk.Style.get_instance(); font_family = "Microsoft YaHei UI"; font_size = 10
        style.configure('.', font=(font_family, font_size)); style.configure('Treeview.Heading', font=(font_family, font_size, 'bold')); style.configure('TLabelframe.Label', font=(font_family, font_size, 'bold'))

    def create_robust_session(self):
        session = requests.Session(); retry_strategy = Retry(total=5, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["HEAD", "GET", "OPTIONS"])
        adapter = HTTPAdapter(max_retries=retry_strategy); session.mount("https://", adapter); session.mount("http://", adapter)
        return session

    def on_closing(self): self.save_config(); self.root.destroy()

    def load_config(self):
        defaults = {"save_path": os.path.join(os.path.expanduser("~"), "Desktop"), "ffmpeg_path": "", "chromedriver_path": "", "browser": "Chrome", "rename_format": "{id}_{num}", "custom_tags": [], "download_threads": "16", "debug_mode": False, "download_video": True}
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f: defaults.update(json.load(f))
        except (json.JSONDecodeError, IOError): self.log("配置文件读取失败，使用默认设置。", is_detail=False)
        self.save_path_var.set(defaults["save_path"]); self.ffmpeg_path_var.set(defaults["ffmpeg_path"]); self.chromedriver_path_var.set(defaults["chromedriver_path"]); self.browser_var.set(defaults["browser"]); self.rename_format_var.set(defaults["rename_format"]); self.custom_tags = defaults["custom_tags"]; self.threads_var.set(defaults["download_threads"]); self.debug_mode_var.set(defaults["debug_mode"]); self.download_video_var.set(defaults["download_video"])

    def save_config(self):
        config = {"save_path": self.save_path_var.get(), "ffmpeg_path": self.ffmpeg_path_var.get(), "chromedriver_path": self.chromedriver_path_var.get(), "browser": self.browser_var.get(), "rename_format": self.rename_format_var.get(), "custom_tags": self.custom_tags, "download_threads": self.threads_var.get(), "debug_mode": self.debug_mode_var.get(), "download_video": self.download_video_var.get()}
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f: json.dump(config, f, ensure_ascii=False, indent=4)
        except IOError: self.log("保存配置失败！", is_detail=False)
    
    def open_settings_window(self):
        settings_window = tk.Toplevel(self.root)
        settings_window.title("高级设置")
        settings_window.transient(self.root)
        settings_window.grab_set()
        
        btn_x, btn_y, btn_w, btn_h = self.settings_button.winfo_rootx(), self.settings_button.winfo_rooty(), self.settings_button.winfo_width(), self.settings_button.winfo_height()
        settings_window.geometry(f"550x400+{btn_x - 550 + btn_w}+{btn_y + btn_h + 5}")

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

        adv_settings_group = ttk.Frame(download_settings_frame); adv_settings_group.pack(fill=X, pady=2)
        ttk.Label(adv_settings_group, text="下载线程数:", width=15, anchor="e").pack(side=LEFT, padx=(5,2)); self.threads_spinbox = ttk.Spinbox(adv_settings_group, from_=1, to=64, textvariable=self.threads_var, width=8); self.threads_spinbox.pack(side=LEFT)
        
        browser_frame = ttk.Frame(download_settings_frame); browser_frame.pack(fill=X, pady=2)
        ttk.Label(browser_frame, text="浏览器:", width=15, anchor="e").pack(side=LEFT, padx=(5,2))
        self.browser_combobox = ttk.Combobox(browser_frame, textvariable=self.browser_var, values=['Chrome'], state="readonly", width=10); self.browser_combobox.pack(side=LEFT)
        
        button_frame = ttk.Frame(main_frame); button_frame.pack(fill=X, side=BOTTOM, pady=(10,0))
        ttk.Button(button_frame, text="关闭", command=settings_window.destroy, bootstyle=PRIMARY).pack(side=RIGHT)

    def create_tags_buttons(self):
        for widget in self.tags_buttons_frame.winfo_children(): widget.destroy()
        preset_tags = ["黑丝", "白丝", "兔女郎", "Cos"]; all_tags = preset_tags + self.custom_tags
        row_frame = ttk.Frame(self.tags_buttons_frame); row_frame.pack(fill=X)
        for tag in all_tags:
            btn = ttk.Button(row_frame, text=tag, bootstyle="outline-secondary", command=lambda t=tag: self.search_by_tag(t)); btn.pack(side=LEFT, padx=2, pady=2)
    
    def open_tag_manager(self):
        manager_window = tk.Toplevel(self.root); manager_window.title("管理自定义标签"); manager_window.transient(self.root); manager_window.grab_set()
        btn_x, btn_y, btn_h = self.manage_tags_btn_ref.winfo_rootx(), self.manage_tags_btn_ref.winfo_rooty(), self.manage_tags_btn_ref.winfo_height()
        manager_window.geometry(f"400x350+{btn_x}+{btn_y + btn_h + 5}")
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
        for item in reversed(filtered_data): self.history_tree.insert("", "end", values=(item.get('id', ''), item.get('title', ''), f"{item.get('completed_count', 0)}/{item.get('total_count', 0)}", item.get('tags', '')))

    def clear_history(self):
        if messagebox.askyesno("确认", "确定要清空所有下载历史记录吗？\n此操作不可恢复。"):
            self.history_data = [];
            if os.path.exists(HISTORY_FILE):
                try: os.remove(HISTORY_FILE)
                except OSError as e: self.log(f"清空历史失败: {e}", is_detail=False); return
            self.filter_history(); self.log("下载历史已清空。", is_detail=False)

    def scrape_images(self, gallery_id, save_path):
        driver = None
        try:
            base_domain = "https://xx.knit.bid"; base_url = f"https://xx.knit.bid/article/{gallery_id}/"
            self.log(f"开始爬取: {gallery_id}", is_detail=False); self.progress['value'] = 0
            chromedriver_path, local_driver_path = self.chromedriver_path_var.get(), os.path.join(os.path.dirname(os.path.abspath(__file__)), 'chromedriver.exe')
            options = webdriver.ChromeOptions();
            if not self.debug_mode_var.get(): options.add_argument('--headless')
            try:
                service = None
                if chromedriver_path and os.path.exists(chromedriver_path): service = ChromeService(executable_path=chromedriver_path); self.log(f"使用手动指定的ChromeDriver", is_detail=True)
                elif os.path.exists(local_driver_path): service = ChromeService(executable_path=local_driver_path); self.log(f"在程序目录下找到并使用ChromeDriver", is_detail=True)
                else: self.log("未找到本地ChromeDriver，尝试从网络自动下载...", is_detail=True); service = ChromeService(ChromeDriverManager().install())
                if not service: raise Exception("无法初始化ChromeDriver服务。")
                driver = webdriver.Chrome(service=service, options=options)
            except Exception as e: self.log(f"驱动启动失败: {e}", is_detail=False); return False
            driver.get(base_url); WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.CSS_SELECTOR, "h1.focusbox-title")))
            soup = BeautifulSoup(driver.page_source, 'html.parser'); title = soup.find('h1', class_='focusbox-title').get_text().strip()
            valid_title = re.sub(r'[\\/*?:"<>|]', '', title); gallery_path = os.path.join(save_path, valid_title); os.makedirs(gallery_path, exist_ok=True)
            tags = [a.get_text() for a in soup.find('div', class_='article-tags').find_all('a')]
            image_urls, video_urls = set(), set()
            page_urls_tuples = []
            if pagination_container := soup.find('div', class_='pagination-container'):
                for link in pagination_container.select('a[data-page]'):
                    if (page_num_str := link.get('data-page')) and page_num_str.isdigit(): page_urls_tuples.append((int(page_num_str), f"{base_url}page/{page_num_str}/"))
            page_urls_tuples.sort(); sorted_urls = [base_url] + [url for _, url in page_urls_tuples]
            self.log(f"发现 {len(sorted_urls)} 页，开始遍历所有页面获取链接...");
            for i, url in enumerate(sorted_urls):
                if self.stop_requested: self.log("任务已停止。", is_detail=False); return False
                if i != 0: driver.get(url); WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.CSS_SELECTOR, "article.article-content")))
                page_soup = BeautifulSoup(driver.page_source, 'html.parser')
                if video_source := page_soup.select_one('video > source[src*=".m3u8"]'): video_urls.add(urljoin(base_domain, video_source['src']))
                for img in page_soup.select('article.article-content img[data-src]'):
                    if '/static/images/' in img['data-src']: image_urls.add(urljoin(base_domain, img['data-src']))
            driver.quit(); driver = None
            self.log(f"解析完成，共找到 {len(video_urls)} 个视频，{len(image_urls)} 个图片。", is_detail=False)
            if not video_urls and not image_urls: self.log("错误：未找到任何有效链接。", is_detail=False); return False
            all_downloads, video_segment_map, temp_dir = [], {}, None
            download_headers = self.base_headers.copy(); download_headers['Referer'] = base_url
            if video_urls and self.download_video_var.get():
                video_url = list(video_urls)[0]; temp_dir = os.path.join(gallery_path, f"temp_{int(time.time())}"); os.makedirs(temp_dir, exist_ok=True)
                m3u8_content = self.session.get(video_url, headers=download_headers, timeout=15).text
                ts_urls = [urljoin(video_url, line.strip()) for line in m3u8_content.split('\n') if line and not line.startswith('#')]
                video_segment_map['output_path'] = os.path.join(gallery_path, f"{valid_title}.mp4"); video_segment_map['ts_paths'] = []
                for i, ts_url in enumerate(ts_urls):
                    ts_path = os.path.join(temp_dir, f"{i:05d}.ts"); all_downloads.append({'url': ts_url, 'path': ts_path}); video_segment_map['ts_paths'].append(ts_path)
            for i, img_url in enumerate(sorted(list(image_urls))):
                ext = os.path.splitext(img_url.split('?')[0])[-1] or '.jpg'; filename = self.rename_format_var.get().format(id=gallery_id, num=f"{i+1:03d}", title=valid_title) + ext
                all_downloads.append({'url': img_url, 'path': os.path.join(gallery_path, filename)})
            completed_count, total_downloads = 0, len(all_downloads)
            self.log(f"开始并行下载 {total_downloads} 个文件...", is_detail=False); threads = int(self.threads_var.get())
            with ThreadPoolExecutor(max_workers=threads) as executor:
                for result in executor.map(self._execute_download_task, all_downloads):
                    if self.stop_requested: break
                    if result: completed_count += 1
                    self.set_progress((completed_count / total_downloads) * 100 if total_downloads > 0 else 0)
            if video_segment_map and not self.stop_requested:
                ts_list_path = os.path.join(temp_dir, "filelist.txt")
                with open(ts_list_path, 'w', encoding='utf-8') as f:
                    for ts_path in video_segment_map['ts_paths']: f.write(f"file '{os.path.abspath(ts_path)}'\n")
                if self._merge_ts_files_with_ffmpeg(ts_list_path, video_segment_map['output_path']): self.log("视频处理完成。")
                else: self.log("视频合并失败。", is_detail=False); completed_count -= len(video_segment_map['ts_paths'])
            if temp_dir and os.path.exists(temp_dir): shutil.rmtree(temp_dir)
            if self.stop_requested: self.log(f"任务 {gallery_id} 被中途停止。", is_detail=False); return False
            self.log(f"下载完成！成功 {completed_count}/{total_downloads} 个。", is_detail=False)
            if completed_count > 0:
                with open(os.path.join(gallery_path, 'tags.txt'), 'w', encoding='utf-8') as f: f.write(', '.join(tags))
                self.save_history({"id": gallery_id, "title": valid_title, "tags": ", ".join(tags), "path": gallery_path, "total_count": total_downloads, "completed_count": completed_count})
            return completed_count > 0
        except Exception as e: self.log(f"ID {gallery_id} 发生致命错误: {e}", is_detail=False); return False
        finally:
            if driver: driver.quit()

    def _execute_download_task(self, task):
        try:
            if self.stop_requested: return None
            
            with self.session.get(task['url'], headers=self.base_headers, timeout=20, stream=True) as r:
                r.raise_for_status()
                
                expected_size = int(r.headers.get('content-length', 0))
                
                with open(task['path'], 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        if self.stop_requested: return None
                        f.write(chunk)
                
                downloaded_size = os.path.getsize(task['path'])
                if expected_size != 0 and downloaded_size != expected_size:
                    os.remove(task['path'])
                    self.log(f"下载失败(文件不完整): {os.path.basename(task['path'])} 预期: {expected_size}, 实际: {downloaded_size}")
                    return None
            return task['path']
        except requests.exceptions.RequestException as e:
            self.log(f"下载失败: {os.path.basename(task['path'])} - {e}")
            return None
        except Exception as e:
            self.log(f"下载时发生未知错误: {os.path.basename(task['path'])} - {e}")
            return None

    def _merge_ts_files_with_ffmpeg(self, ts_files_list_path, output_path):
        self.log("所有分片下载完毕，开始使用FFmpeg进行本地合并..."); ffmpeg_path = self.ffmpeg_path_var.get()
        if not os.path.exists(ffmpeg_path): self.log("FFmpeg路径无效，跳过合并。", is_detail=False); return False
        command = [ffmpeg_path, '-y', '-f', 'concat', '-safe', '0', '-i', ts_files_list_path, '-c', 'copy', output_path]
        try:
            subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW); self.log("视频合并成功！"); return True
        except subprocess.CalledProcessError as e: self.log(f"视频合并失败，FFmpeg返回代码: {e.returncode}\n{e.stderr}", is_detail=False); return False
        except Exception as e: self.log(f"FFmpeg合并时发生错误: {e}", is_detail=False); return False
        
    def load_and_display_history(self): self.history_data = self.load_history_file(); self.filter_history()
        
    def start_task_processor(self):
        if self.is_running: self.log("任务处理器已在运行中。", is_detail=False); return
        if not self.task_queue: self.log("任务队列为空，无需启动。", is_detail=False); return
        self.is_running, self.stop_requested = True, False; self.start_tasks_button.config(state=tk.DISABLED); self.stop_tasks_button.config(state=tk.NORMAL)
        self.is_batch_mode = len(self.task_queue) > 1; self.batch_start_time = time.time()
        self.task_thread = threading.Thread(target=self.process_queue, daemon=True); self.task_thread.start()
        
    def stop_task_processor(self):
        if self.is_running: self.log(">>> 用户请求停止任务...", is_detail=False); self.stop_requested = True; self.stop_tasks_button.config(state=tk.DISABLED)
                
    def process_queue(self):
        total_tasks = len(self.task_queue); current_task_num = 0
        while self.task_queue:
            if self.stop_requested: break
            current_task_num += 1; task = self.task_queue.popleft(); self._update_task_count_label()
            self.update_task_status(task['id'], "⚙️ 进行中")
            if self.is_batch_mode: self.log(f"开始执行任务 {current_task_num}/{total_tasks}...", is_detail=False)
            gallery_id = None
            if match := re.search(r'/article/(\d+)', task['input']): gallery_id = match.group(1)
            elif task['input'].isdigit(): gallery_id = task['input']
            if gallery_id: status = "✅ 完成" if self.scrape_images(gallery_id, task['path']) else "❌ 失败"
            else: self.log(f"任务 '{task['input']}' 的ID无效，已跳过。", is_detail=False); status = "❌ 失败"
            self.update_task_status(task['id'], status)
            if self.task_queue and not self.stop_requested:
                delay = random.randint(3, 30)
                self.log(f"任务完成，随机延时 {delay} 秒后开始下一个...", is_detail=False); time.sleep(delay)
        if self.batch_start_time and not self.stop_requested:
            elapsed_time = time.time() - self.batch_start_time; minutes, seconds = divmod(int(elapsed_time), 60)
            self.log(f"全部任务已处理完毕。总耗时: {minutes} 分 {seconds} 秒。", is_detail=False)
        else: self.log("所有任务已处理完毕。" if not self.stop_requested else "任务队列已停止。", is_detail=False)
        self.is_running = False; self.is_batch_mode = False; self.batch_start_time = None
        self.root.after(0, lambda: (self.start_tasks_button.config(state=tk.NORMAL), self.stop_tasks_button.config(state=tk.DISABLED)))
        
    def add_task_from_entry(self, event=None):
        user_input = self.url_entry.get().strip()
        if not user_input: return
        if not self.save_path_var.get(): messagebox.showerror("错误", "请先选择保存位置"); return
        self._add_task(user_input, self.save_path_var.get()); self.url_entry.delete(0, tk.END)

    def _add_task(self, user_input, save_path):
        self.task_id_counter += 1
        task_id = f"task_{int(time.time() * 1000)}_{self.task_id_counter}"
        self.task_queue.append({'id': task_id, 'input': user_input, 'path': save_path, 'status': '⏳ 等待中'})
        self.queue_tree.insert("", "end", iid=task_id, values=(user_input, save_path, "⏳ 等待中"))
        self.log(f"任务 '{user_input}' 已添加到队列。", is_detail=False); self._update_task_count_label()

    def _update_task_count_label(self):
        count = len(self.task_queue)
        self.queue_frame.config(text=f"任务队列 ({count})")

    def open_batch_import_window(self):
        batch_window = tk.Toplevel(self.root); batch_window.title("批量导入任务")
        btn_x, btn_y, btn_h = self.batch_add_button_ref.winfo_rootx(), self.batch_add_button_ref.winfo_rooty(), self.batch_add_button_ref.winfo_height()
        batch_window.geometry(f"500x400+{btn_x - 400}+{btn_y + btn_h + 5}")
        main_frame = ttk.Frame(batch_window, padding=15); main_frame.pack(fill=tk.BOTH, expand=True)
        ttk.Label(main_frame, text="请每行粘贴一个ID或网址：").pack(anchor='w', pady=(0, 5))
        
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
            if not (save_path := self.save_path_var.get()): messagebox.showerror("错误", "请先在主界面选择保存位置", parent=batch_window); return
            urls = text_widget.get("1.0", tk.END).splitlines(); imported_count = 0
            for url in urls:
                if user_input := url.strip(): self._add_task(user_input, save_path); imported_count += 1
            if imported_count > 0: self.log(f"成功批量导入 {imported_count} 个任务。", is_detail=False)
            batch_window.destroy()
        
        text_widget.bind("<Control-Return>", lambda e: process_import())
        ttk.Button(button_frame, text="导入任务队列 (Ctrl+Enter)", command=process_import, bootstyle=SUCCESS).pack(side=RIGHT)
        ttk.Button(button_frame, text="取消", command=batch_window.destroy, bootstyle=SECONDARY).pack(side=RIGHT, padx=(0, 10))
        update_line_count()

    def log(self, message, is_detail=True):
        if self.is_batch_mode and is_detail: return
        self.root.after(0, self._log, message)
    def _log(self, message): self.log_area.insert(tk.END, f"[{time.strftime('%H:%M:%S')}] {message}\n"); self.log_area.see(tk.END)
    def set_progress(self, value): self.root.after(0, self.progress.config, {'value': value})
        
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
        
    def update_task_status(self, task_id, status):
        def _update():
            try:
                if self.queue_tree.exists(task_id): self.queue_tree.set(task_id, column="状态", value=status)
            except tk.TclError: pass
        self.root.after(0, _update)
        
    def search_by_tag(self, tag): self.search_var.set(tag)

if __name__ == "__main__":
    root = ttk.Window(themename="litera")
    app = ImageScraperApp(root)
    root.mainloop()