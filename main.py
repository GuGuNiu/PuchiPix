import os
import tkinter as tk
from tkinter import filedialog, messagebox
import ttkbootstrap as ttk
from ttkbootstrap.constants import *
import requests
from bs4 import BeautifulSoup
import threading
import re
import json
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin
from PIL import Image, ImageTk
from collections import deque

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager
import time
import subprocess

HISTORY_FILE = 'history.json'
CONFIG_FILE = 'config.json'

class ImageScraperApp:
    def __init__(self, root):
        self.root = root
        self.root.title("PuchiPix-噗呲专用 v16.0 (最终版)")
        self.root.geometry("1300x800")
        
        self.task_queue = deque()
        self.is_running = False
        self.stop_requested = False
        self.task_thread = None
        self.base_headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'}
        self.custom_tags = []

        main_paned_window = ttk.PanedWindow(root, orient=HORIZONTAL); main_paned_window.pack(fill=BOTH, expand=True, padx=10, pady=10)
        
        left_pane = ttk.Frame(main_paned_window); main_paned_window.add(left_pane, weight=2)
        
        search_frame = ttk.Frame(left_pane); search_frame.pack(fill=X, pady=(0, 5))
        ttk.Label(search_frame, text="搜索历史:").pack(side=LEFT, padx=(0, 5))
        self.search_var = tk.StringVar(); self.search_var.trace("w", self.filter_history)
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var); self.search_entry.pack(fill=X, expand=True)
        
        history_frame = ttk.Labelframe(left_pane, text="下载历史", padding=5); history_frame.pack(fill=BOTH, expand=True)
        
        cols = ("ID", "标题", "数量", "Tags"); self.history_tree = ttk.Treeview(history_frame, columns=cols, show='headings')
        self.history_tree.column("ID", width=60, anchor='center'); self.history_tree.heading("ID", text="ID")
        self.history_tree.column("标题", width=200); self.history_tree.heading("标题", text="标题")
        self.history_tree.column("数量", width=60, anchor='center'); self.history_tree.heading("数量", text="数量")
        self.history_tree.column("Tags", width=150); self.history_tree.heading("Tags", text="Tags")
        self.history_tree.pack(side=LEFT, fill=BOTH, expand=True)
        scrollbar = ttk.Scrollbar(history_frame, orient=VERTICAL, command=self.history_tree.yview); scrollbar.pack(side=RIGHT, fill=Y); self.history_tree.config(yscrollcommand=scrollbar.set)

        tags_filter_frame = ttk.Labelframe(left_pane, text="标签筛选", padding=10); tags_filter_frame.pack(fill=X, pady=(10,0))
        self.tags_buttons_frame = ttk.Frame(tags_filter_frame); self.tags_buttons_frame.pack(fill=X)
        
        add_tag_frame = ttk.Frame(tags_filter_frame); add_tag_frame.pack(fill=X, pady=(10,0))
        self.new_tag_entry = ttk.Entry(add_tag_frame, font=("-size", 10)); self.new_tag_entry.pack(side=LEFT, expand=True, fill=X)
        ttk.Button(add_tag_frame, text="添加标签", command=self.add_custom_tag, bootstyle="outline-info").pack(side=LEFT, padx=(5,0))
        
        right_pane = ttk.Frame(main_paned_window); main_paned_window.add(right_pane, weight=3)
        controls_frame = ttk.Frame(right_pane); controls_frame.pack(fill=X, padx=5, pady=5)
        input_group = ttk.Frame(controls_frame); input_group.pack(fill=X, pady=(0,5))
        ttk.Label(input_group, text="ID/网址:", font=("-size", 12)).pack(side=LEFT, padx=(5,2))
        self.url_entry = ttk.Entry(input_group, font=("-size", 12)); self.url_entry.pack(side=LEFT, expand=True, fill=X)
        self.add_task_button = ttk.Button(input_group, text="添加", command=self.add_task_to_queue, bootstyle=INFO); self.add_task_button.pack(side=LEFT, padx=(5,0))
        self.url_entry.bind("<Return>", self.add_task_to_queue)
        path_group = ttk.Frame(controls_frame); path_group.pack(fill=X, pady=(0,5))
        ttk.Label(path_group, text="保存位置:", font=("-size", 12)).pack(side=LEFT, padx=(5,2))
        self.save_path_var = tk.StringVar(); self.save_path_entry = ttk.Entry(path_group, textvariable=self.save_path_var, font=("-size", 12)); self.save_path_entry.pack(side=LEFT, expand=True, fill=X, padx=(0, 5)); ttk.Button(path_group, text="...", command=self.select_save_path, bootstyle=SECONDARY, width=4).pack(side=LEFT)
        ffmpeg_frame = ttk.Frame(controls_frame); ffmpeg_frame.pack(fill=X, pady=(0,5))
        ttk.Label(ffmpeg_frame, text="FFmpeg路径:", font=("-size", 12)).pack(side=LEFT, padx=(5,2))
        self.ffmpeg_path_var = tk.StringVar()
        self.ffmpeg_entry = ttk.Entry(ffmpeg_frame, textvariable=self.ffmpeg_path_var, font=("-size", 11)); self.ffmpeg_entry.pack(side=LEFT, expand=True, fill=X, padx=(0, 5))
        ttk.Button(ffmpeg_frame, text="...", command=self.select_ffmpeg_path, bootstyle=SECONDARY, width=4).pack(side=LEFT)
        rename_group = ttk.Frame(controls_frame); rename_group.pack(fill=X, pady=(0,5))
        ttk.Label(rename_group, text="重命名格式:", font=("-size", 12)).pack(side=LEFT, padx=(5,2))
        rename_presets = ["{id}_{num}", "{title}_{num}", "{num}"]; self.rename_format_var = tk.StringVar()
        self.rename_combobox = ttk.Combobox(rename_group, textvariable=self.rename_format_var, values=rename_presets, font=("-size", 11)); self.rename_combobox.pack(side=LEFT, expand=True, fill=X)
        settings_group = ttk.Frame(controls_frame); settings_group.pack(fill=X, pady=(0,10))
        ttk.Label(settings_group, text="浏览器:", font=("-size", 12)).pack(side=LEFT, padx=(5,2))
        self.browser_var = tk.StringVar(); self.browser_combobox = ttk.Combobox(settings_group, textvariable=self.browser_var, values=['Chrome', 'Firefox', 'Edge'], state="readonly", font=("-size", 11), width=8); self.browser_combobox.pack(side=LEFT, padx=(0,10))
        self.debug_mode_var = tk.BooleanVar(); ttk.Checkbutton(settings_group, text="调试模式 (显示浏览器)", variable=self.debug_mode_var, bootstyle="round-toggle").pack(side=LEFT)
        task_buttons_group = ttk.Frame(right_pane); task_buttons_group.pack(fill=X, padx=5, pady=5)
        self.start_tasks_button = ttk.Button(task_buttons_group, text="开始任务", command=self.start_task_processor, bootstyle=SUCCESS); self.start_tasks_button.pack(side=LEFT, expand=True, fill=X, padx=(0,5))
        self.stop_tasks_button = ttk.Button(task_buttons_group, text="停止任务", command=self.stop_task_processor, bootstyle=DANGER, state=tk.DISABLED); self.stop_tasks_button.pack(side=LEFT, expand=True, fill=X)
        log_frame = ttk.Labelframe(right_pane, text="日志输出", padding=10); log_frame.pack(fill=BOTH, expand=True, padx=5, pady=5)
        self.log_area = tk.Text(log_frame, height=10, font=("Consolas", 10), relief="flat"); self.log_area.pack(side=LEFT, fill=BOTH, expand=True)
        log_scrollbar = ttk.Scrollbar(log_frame, orient=VERTICAL, command=self.log_area.yview); log_scrollbar.pack(side=RIGHT, fill=Y); self.log_area.config(yscrollcommand=log_scrollbar.set)
        queue_frame = ttk.Labelframe(right_pane, text="任务队列", padding=10); queue_frame.pack(fill=X, padx=5, pady=5)
        queue_cols = ("ID/网址", "保存路径", "状态"); self.queue_tree = ttk.Treeview(queue_frame, columns=queue_cols, show='headings', height=5)
        for col in queue_cols: self.queue_tree.heading(col, text=col)
        self.queue_tree.column("ID/网址", width=200); self.queue_tree.column("保存路径", width=300); self.queue_tree.column("状态", width=100, anchor='center')
        self.queue_tree.pack(side=LEFT, fill=X, expand=True)
        self.progress = ttk.Progressbar(right_pane, mode='determinate', bootstyle="striped"); self.progress.pack(fill=X, padx=5, pady=(5,5))
        
        self.history_data = []; self.load_config(); self.load_and_display_history(); self.create_tags_buttons()
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

    def load_config(self):
        defaults = {
            "save_path": os.path.join(os.path.expanduser("~"), "Desktop"),
            "ffmpeg_path": os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ffmpeg.exe'),
            "browser": "Chrome",
            "rename_format": "{id}_{num}",
            "custom_tags": []
        }
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    defaults.update(config)
        except (json.JSONDecodeError, IOError):
            self.log("配置文件读取失败，使用默认设置。")
        
        self.save_path_var.set(defaults["save_path"])
        self.ffmpeg_path_var.set(defaults["ffmpeg_path"])
        self.browser_var.set(defaults["browser"])
        self.rename_format_var.set(defaults["rename_format"])
        self.custom_tags = defaults["custom_tags"]

    def save_config(self):
        config = {
            "save_path": self.save_path_var.get(),
            "ffmpeg_path": self.ffmpeg_path_var.get(),
            "browser": self.browser_var.get(),
            "rename_format": self.rename_format_var.get(),
            "custom_tags": self.custom_tags
        }
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=4)
        except IOError:
            self.log("保存配置失败！")

    def on_closing(self):
        self.save_config()
        self.root.destroy()

    def create_tags_buttons(self):
        for widget in self.tags_buttons_frame.winfo_children(): widget.destroy()
        preset_tags = ["黑丝", "白丝", "兔女郎", "Cos"]
        all_tags = preset_tags + self.custom_tags
        for tag in all_tags:
            tag_frame = ttk.Frame(self.tags_buttons_frame)
            tag_frame.pack(side=LEFT, padx=2, pady=2)
            btn = ttk.Button(tag_frame, text=tag, bootstyle="outline-secondary", command=lambda t=tag: self.search_by_tag(t))
            btn.pack(side=LEFT)
            if tag not in preset_tags:
                del_btn = ttk.Button(tag_frame, text="x", bootstyle="outline-danger", width=2, command=lambda t=tag: self.remove_custom_tag(t))
                del_btn.pack(side=LEFT, padx=(2,0))
    
    def add_custom_tag(self):
        new_tag = self.new_tag_entry.get().strip()
        if new_tag and new_tag not in self.custom_tags:
            self.custom_tags.append(new_tag)
            self.create_tags_buttons()
            self.new_tag_entry.delete(0, tk.END)

    def remove_custom_tag(self, tag_to_remove):
        if tag_to_remove in self.custom_tags:
            self.custom_tags.remove(tag_to_remove)
            self.create_tags_buttons()

    def filter_history(self, *args):
        self.history_tree.delete(*self.history_tree.get_children())
        search_term = self.search_var.get().lower()
        filtered_data = [item for item in self.history_data if search_term in item.get('title', '').lower() or search_term in item.get('tags', '').lower()]
        for item in reversed(filtered_data):
            total, completed = item.get('total_count', 0), item.get('completed_count', 0); count_str = f"{completed}/{total}"
            item_id_in_tree = self.history_tree.insert("", "end", text="")
            self.history_tree.set(item_id_in_tree, "ID", item.get('id', ''))
            self.history_tree.set(item_id_in_tree, "标题", item.get('title', ''))
            self.history_tree.set(item_id_in_tree, "数量", count_str)
            self.history_tree.set(item_id_in_tree, "Tags", item.get('tags', ''))

    def scrape_images(self, gallery_id, save_path):
        driver = None
        try:
            base_domain = "https://xx.knit.bid"; base_url = f"https://xx.knit.bid/article/{gallery_id}/"
            self.log(f"开始爬取: {gallery_id}"); self.progress['value'] = 0
            selected_browser = self.browser_var.get()
            try:
                if selected_browser == 'Chrome': 
                    options = webdriver.ChromeOptions()
                    if not self.debug_mode_var.get(): options.add_argument('--headless')
                    service = ChromeService(ChromeDriverManager().install())
                    driver = webdriver.Chrome(service=service, options=options)
            except Exception as e: self.log(f"驱动自动安装失败: {e}"); return False
            
            driver.get(base_url); WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.CSS_SELECTOR, "h1.focusbox-title")))
            soup = BeautifulSoup(driver.page_source, 'html.parser')
            title = soup.find('h1', class_='focusbox-title').get_text().strip()
            valid_title = re.sub(r'[\\/*?:"<>|]', '', title); gallery_path = os.path.join(save_path, valid_title)
            os.makedirs(gallery_path, exist_ok=True)
            tags = [a.get_text() for a in soup.find('div', class_='article-tags').find_all('a')]
            image_urls, video_urls = set(), set()
            
            page_urls_tuples = []
            pagination_container = soup.find('div', class_='pagination-container')
            if pagination_container:
                page_links = pagination_container.select('a[data-page]')
                for link in page_links:
                    page_num_str = link.get('data-page')
                    if page_num_str and page_num_str.isdigit(): page_urls_tuples.append((int(page_num_str), f"{base_url}page/{page_num_str}/"))
            page_urls_tuples.sort(); sorted_urls = [base_url] + [url for num, url in page_urls_tuples]
            self.log(f"发现 {len(sorted_urls)} 页，开始遍历。")
            for i, url in enumerate(sorted_urls):
                if self.stop_requested: self.log("任务已停止。"); return False
                self.log(f"解析第 {i+1}/{len(sorted_urls)} 页...")
                if i != 0: driver.get(url); WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.CSS_SELECTOR, "article.article-content")))
                page_soup = BeautifulSoup(driver.page_source, 'html.parser')
                if page_soup.select_one('video > source[src*=".m3u8"]'): video_urls.add(urljoin(base_domain, page_soup.select_one('video > source[src*=".m3u8"]')['src']))
                for img in page_soup.select('article.article-content img[data-src]'):
                    if '/static/images/' in img['data-src']: image_urls.add(urljoin(base_domain, img['data-src']))
            driver.quit(); driver = None
            
            download_headers = self.base_headers.copy(); download_headers['Referer'] = base_url
            completed_count, first_media_path, total_media = 0, None, 0
            
            if video_urls:
                total_media = len(video_urls); self.log(f"解析完成，共找到 {total_media} 个视频，开始下载...")
                video_url = list(video_urls)[0]; video_path = os.path.join(gallery_path, f"{valid_title}.mp4")
                if self.download_m3u8_video(video_url, video_path, download_headers): completed_count = 1
            elif image_urls:
                total_media = len(image_urls); self.log(f"解析完成，共找到 {total_media} 个图片，开始下载...")
                tasks = []
                rename_format = self.rename_format_var.get()
                for i, url in enumerate(sorted(list(image_urls))):
                    try:
                        ext = os.path.splitext(url.split('?')[0])[-1] or '.jpg'
                        new_filename = rename_format.format(id=gallery_id, num=f"{i+1:03d}", title=valid_title) + ext
                        tasks.append((url, os.path.join(gallery_path, new_filename), download_headers))
                    except Exception:
                        tasks.append((url, os.path.join(gallery_path, f"{gallery_id}_{i+1:03d}.jpg"), download_headers)); rename_format = "{id}_{num}"
                with ThreadPoolExecutor(max_workers=10) as executor:
                    for result_path in executor.map(self.download_single_image, tasks):
                        if self.stop_requested: break
                        if result_path:
                            completed_count += 1;
                            if first_media_path is None: first_media_path = result_path
                        self.set_progress(completed_count * 100 / total_media)
            else: self.log("错误：未找到任何有效链接。"); return False

            if self.stop_requested: self.log(f"任务 {gallery_id} 被中途停止。"); return False
            self.log(f"下载完成！成功 {completed_count}/{total_media} 个。")
            if completed_count > 0:
                with open(os.path.join(gallery_path, 'tags.txt'), 'w', encoding='utf-8') as f: f.write(', '.join(tags))
                self.save_history({"id": gallery_id, "title": valid_title, "tags": ", ".join(tags), "path": gallery_path, "thumbnail_path": first_media_path, "total_count": total_media, "completed_count": completed_count})
            return completed_count > 0
        except Exception as e:
            self.log(f"ID {gallery_id} 发生致命错误: {e}")
            if driver: driver.quit()
            return False
            
    def download_m3u8_video(self, m3u8_url, output_path, headers):
        self.log("开始下载M3U8视频...")
        ffmpeg_path = self.ffmpeg_path_var.get()
        if not os.path.exists(ffmpeg_path): self.log("错误: FFmpeg路径无效！"); messagebox.showerror("依赖缺失", f"找不到ffmpeg.exe"); return False
        try:
            referer = headers.get('Referer', ''); user_agent = headers.get('User-Agent', '')
            header_str = f"Referer: {referer}\r\nUser-Agent: {user_agent}\r\n"
            self.log(f"使用 FFmpeg: {ffmpeg_path}")
            command = [ ffmpeg_path, '-y', '-headers', header_str, '-i', m3u8_url, '-c', 'copy', '-bsf:a', 'aac_adtstoasc', output_path ]
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, encoding='utf-8', creationflags=subprocess.CREATE_NO_WINDOW)
            for line in process.stdout: self.log(f"  [FFmpeg]: {line.strip()}")
            process.wait()
            if process.returncode == 0: self.log("视频合并成功！"); return True
            else: self.log(f"视频合并失败，FFmpeg返回代码: {process.returncode}"); return False
        except Exception as e: self.log(f"下载视频时发生错误: {e}"); return False

    def download_single_image(self, args):
        img_url, img_path, headers = args
        try:
            img_response = requests.get(img_url, headers=headers, timeout=20, stream=True); img_response.raise_for_status()
            with open(img_path, 'wb') as f:
                for chunk in img_response.iter_content(chunk_size=8192): f.write(chunk)
            return img_path
        except requests.exceptions.RequestException as e: self.log(f"  下载失败: {img_url} ({e})"); return None
        
    def load_and_display_history(self):
        self.history_data = self.load_history_file(); self.filter_history()
    def start_task_processor(self):
        if self.is_running: self.log("任务处理器已在运行中。"); return
        if not self.task_queue: self.log("任务队列为空，无需启动。"); return
        self.is_running = True; self.stop_requested = False
        self.start_tasks_button.config(state=tk.DISABLED); self.stop_tasks_button.config(state=tk.NORMAL)
        self.task_thread = threading.Thread(target=self.process_queue, daemon=True); self.task_thread.start()
    def stop_task_processor(self):
        if self.is_running: self.log(">>> 用户请求停止任务，将在当前任务完成后停止。"); self.stop_requested = True; self.stop_tasks_button.config(state=tk.DISABLED)
    def process_queue(self):
        while self.task_queue:
            if self.stop_requested: break
            task = self.task_queue.popleft(); self.update_task_status(task['id'], "进行中")
            gallery_id = None; match = re.search(r'/article/(\d+)', task['input'])
            if match: gallery_id = match.group(1)
            elif task['input'].isdigit(): gallery_id = task['input']
            if gallery_id: success = self.scrape_images(gallery_id, task['path']); status = "完成" if success else "失败"
            else: self.log(f"任务 '{task['input']}' 的ID无效，已跳过。"); status = "失败"
            self.update_task_status(task['id'], status)
        self.is_running = False
        self.root.after(0, lambda: (self.start_tasks_button.config(state=tk.NORMAL), self.stop_tasks_button.config(state=tk.DISABLED)))
        self.log("所有任务已处理完毕。" if not self.stop_requested else "任务队列已停止。")
    def add_task_to_queue(self, event=None):
        user_input = self.url_entry.get().strip(); save_path = self.save_path_var.get()
        if not user_input or not save_path: messagebox.showerror("错误", "请输入图包ID/网址和选择保存位置"); return
        task_id = f"task_{int(time.time() * 1000)}"; task = {'id': task_id, 'input': user_input, 'path': save_path, 'status': '等待中'}
        self.task_queue.append(task); self.queue_tree.insert("", "end", iid=task_id, values=(user_input, save_path, "等待中"))
        self.url_entry.delete(0, tk.END); self.log(f"任务 '{user_input}' 已添加到队列。")
    def log(self, message): self.root.after(0, self._log, message)
    def _log(self, message): self.log_area.insert(tk.END, message + "\n"); self.log_area.see(tk.END)
    def set_progress(self, value): self.root.after(0, self.progress.config, {'value': value})
    def select_save_path(self):
        path = filedialog.askdirectory()
        if path: self.save_path_var.set(path)
    def select_ffmpeg_path(self):
        path = filedialog.askopenfilename(title="选择ffmpeg.exe", filetypes=[("Executable", "*.exe")])
        if path: self.ffmpeg_path_var.set(path)
    def load_history_file(self):
        if not os.path.exists(HISTORY_FILE): return []
        try:
            with open(HISTORY_FILE, 'r', encoding='utf-8') as f: return json.load(f)
        except (json.JSONDecodeError, IOError): return []
    def save_history(self, new_entry):
        history = self.load_history_file(); found = False
        for i, entry in enumerate(history):
            if entry.get("id") == new_entry["id"]: history[i] = new_entry; found = True; break
        if not found: history.append(new_entry)
        with open(HISTORY_FILE, 'w', encoding='utf-8') as f: json.dump(history, f, ensure_ascii=False, indent=4)
        self.root.after(0, self.load_and_display_history)
    def update_task_status(self, task_id, status):
        def _update():
            try: values = list(self.queue_tree.item(task_id, 'values')); values[2] = status; self.queue_tree.item(task_id, values=values)
            except tk.TclError: pass
        self.root.after(0, _update)
    def search_by_tag(self, tag):
        self.search_var.set(tag)

if __name__ == "__main__":
    root = ttk.Window(themename="litera")
    app = ImageScraperApp(root)
    root.mainloop()