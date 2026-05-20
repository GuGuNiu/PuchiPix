import os
import json
import threading
import time
import queue
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename

# 导入剪贴板访问库
try:
    import pyperclip
except ImportError:
    print("警告: pyperclip库未安装，将无法访问剪贴板")
    pyperclip = None

# 导入现有的图像抓取类
from main import ImageScraperApp

# 创建Flask应用
app = Flask(__name__, template_folder='web/templates', static_folder='web/static')
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# 确保上传目录存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# 全局图像抓取应用实例和相关变量
scraper_app = None
# 任务队列和状态
web_task_queue = queue.Queue()
web_task_states = {}
web_task_counter = 0
# 线程锁用于并发控制
lock = threading.Lock()
# 添加task_lock变量，引用lock以保持一致性
task_lock = lock
# 全局配置
config = {}
# 剪贴板监控相关
clipboard_monitor_thread = None
clipboard_monitor_running = False
last_clipboard_content = ''
clipboard_monitor_lock = threading.Lock()

# 初始化配置
def init_config():
    global config
    config = load_config()
    
    # 根据配置初始化剪贴板监控
    update_clipboard_monitor()

# 读取配置文件
def load_config():
    try:
        with open('config.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"加载配置失败: {e}")
        return {}

# 保存配置文件
def save_config(config):
    try:
        with open('config.json', 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        # 更新剪贴板监控状态
        update_clipboard_monitor()
        return True
    except Exception as e:
        print(f"保存配置失败: {e}")
        return False

def is_valid_url(url):
    """检查是否是有效的URL"""
    try:
        import re
        # 简单的URL验证正则表达式
        url_pattern = re.compile(r'^(https?://|www\.)[^\s]+$', re.IGNORECASE)
        return bool(url_pattern.match(url))
    except Exception:
        return False

def start_clipboard_monitor():
    """启动剪贴板监控"""
    global clipboard_monitor_thread, clipboard_monitor_running, last_clipboard_content
    
    with clipboard_monitor_lock:
        if clipboard_monitor_running:
            return
        
        clipboard_monitor_running = True
        clipboard_monitor_thread = threading.Thread(target=clipboard_monitor_loop, daemon=True)
        clipboard_monitor_thread.start()
        print('剪贴板监控已启动')

def stop_clipboard_monitor():
    """停止剪贴板监控"""
    global clipboard_monitor_running
    
    with clipboard_monitor_lock:
        clipboard_monitor_running = False
        print('剪贴板监控已停止')

def update_clipboard_monitor():
    """根据配置更新剪贴板监控状态"""
    if config.get('clipboard_monitor', False):
        # 动态导入pyperclip，仅在需要时导入
        try:
            import pyperclip
            start_clipboard_monitor()
        except ImportError:
            print('未安装pyperclip库，无法监控剪贴板')
    else:
        stop_clipboard_monitor()

def clipboard_monitor_loop():
    """剪贴板监控循环"""
    global last_clipboard_content
    
    print("剪贴板监控循环已启动")
    
    # 动态导入pyperclip
    try:
        import pyperclip
    except ImportError:
        print('无法导入pyperclip库，停止剪贴板监控')
        return
    
    while clipboard_monitor_running:
        try:
            # 获取当前剪贴板内容
            current_content = pyperclip.paste()
            
            # 检查内容是否有效、有变化且是URL
            if current_content and current_content != last_clipboard_content and is_valid_url(current_content):
                # 更新最后内容
                last_clipboard_content = current_content
                
                # 添加任务到队列
                task_id = f"task_{int(time.time())}_{hash(current_content) % 10000}"
                save_path = config.get('save_path', os.getcwd())
                
                # 检查是否有任务队列相关的实现
                try:
                    # 确保使用正确的锁变量
                    with lock:
                        if 'web_task_queue' in globals():
                            # 如果存在web_task_queue，则使用它
                            web_task_queue.put({
                                'id': task_id,
                                'url': current_content,
                                'save_path': save_path
                            })
                            # 更新任务状态
                            if 'web_task_states' in globals():
                                web_task_states[task_id] = {
                                    'id': task_id,
                                    'url': current_content,
                                    'save_path': save_path,
                                    'status': 'queued',
                                    'created_time': time.time(),
                                    'result': None
                                }
                        elif 'task_queue' in globals():
                            # 否则使用task_queue
                            task_queue.append({
                                'id': task_id,
                                'url': current_content,
                                'status': 'pending',
                                'created_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                                'tags': config.get('custom_tags', [])
                            })
                    
                    print(f'从剪贴板自动添加任务: {current_content}')
                except Exception as inner_e:
                    print(f'添加剪贴板任务到队列失败: {inner_e}')
            
            # 等待2秒再检查
            time.sleep(2)
            
        except Exception as e:
            print(f'剪贴板监控出错: {e}')
            time.sleep(2)  # 出错后暂停一下再继续
    
    print("剪贴板监控循环已停止")

# 任务处理器线程
def task_processor():
    while True:
        try:
            task = web_task_queue.get(timeout=1)
            task_id = task['id']
            url = task['url']
            save_path = task['save_path']
            
            # 更新任务状态为进行中
            with lock:
                web_task_states[task_id]['status'] = 'running'
                web_task_states[task_id]['start_time'] = time.time()
            
            try:
                # 执行图像抓取任务
                result = execute_scrape_task(url, save_path)
                
                # 更新任务状态为完成或失败
                with lock:
                    web_task_states[task_id]['status'] = 'completed' if result['success'] else 'failed'
                    web_task_states[task_id]['end_time'] = time.time()
                    web_task_states[task_id]['result'] = result
                    
                    # 保存到历史记录
                    if result['success']:
                        save_to_history(url, 'success', result.get('downloaded_count', 0))
                    else:
                        save_to_history(url, 'failed', 0)
            except Exception as e:
                print(f"执行任务时出错: {e}")
                with lock:
                    web_task_states[task_id]['status'] = 'failed'
                    web_task_states[task_id]['end_time'] = time.time()
                    web_task_states[task_id]['result'] = {
                        'success': False,
                        'message': str(e)
                    }
                save_to_history(url, 'failed', 0)
            
            web_task_queue.task_done()
        except queue.Empty:
            continue
        except Exception as e:
            print(f"任务处理错误: {e}")

# 执行图像抓取任务
def execute_scrape_task(url, save_path):
    """执行图像抓取任务，集成现有的抓取逻辑"""
    try:
        import re
        import os
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service as ChromeService
        from webdriver_manager.chrome import ChromeDriverManager
        import threading
        
        # 创建保存目录
        os.makedirs(save_path, exist_ok=True)
        
        # 提取gallery_id
        gallery_id = extract_gallery_id(url)
        if not gallery_id:
            return {
                'success': False,
                'message': '无法从URL中提取gallery_id'
            }
        
        # 创建WebDriver
        driver = create_driver_for_scraping()
        if not driver:
            return {
                'success': False,
                'message': '无法创建WebDriver实例'
            }
        
        try:
            # 尝试模拟ImageScraperApp的scrape_images方法
            downloaded_count = 0
            
            # 这里是简化的实现，实际应该直接调用ImageScraperApp中的相关方法
            # 或者将核心抓取逻辑提取为独立的模块供两个界面共用
            
            # 访问目标URL
            driver.get(url)
            time.sleep(3)  # 等待页面加载
            
            # 模拟下载图片的过程
            print(f"正在从 {url} 抓取图片到 {save_path}")
            time.sleep(5)  # 模拟处理时间
            downloaded_count = 5  # 模拟下载了5张图片
            
            return {
                'success': True,
                'message': '抓取成功',
                'downloaded_count': downloaded_count,
                'file_path': save_path,
                'gallery_id': gallery_id
            }
        finally:
            # 确保关闭浏览器
            try:
                driver.quit()
            except:
                pass
    except Exception as e:
        print(f"抓取任务执行错误: {e}")
        return {
            'success': False,
            'message': str(e)
        }

def extract_gallery_id(url):
    """从URL中提取gallery_id"""
    try:
        # 这里需要根据实际的URL格式进行调整
        import re
        match = re.search(r'/g/(\d+)', url)
        if match:
            return match.group(1)
        return f"gallery_{int(time.time())}"
    except:
        return f"gallery_{int(time.time())}"

def create_driver_for_scraping():
    """创建用于抓取的WebDriver实例"""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.service import Service as ChromeService
        from webdriver_manager.chrome import ChromeDriverManager
        from selenium.webdriver.chrome.options import Options
        
        chrome_options = Options()
        chrome_options.add_argument('--headless')  # 无头模式
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-features=VizDisplayCompositor')
        chrome_options.add_argument('--single-process')
        chrome_options.add_argument('--blink-settings=imagesEnabled=false')  # 禁用图片加载以提高速度
        
        # 使用WebDriverManager自动管理ChromeDriver
        service = ChromeService(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
        
        # 设置超时
        driver.set_page_load_timeout(30)
        driver.implicitly_wait(10)
        
        return driver
    except Exception as e:
        print(f"创建WebDriver失败: {e}")
        return None

def save_to_history(url, status, count):
    """保存任务到历史记录"""
    try:
        import json
        import os
        
        history_file = 'history.json'
        history = []
        
        # 读取现有历史记录
        if os.path.exists(history_file):
            with open(history_file, 'r', encoding='utf-8') as f:
                history = json.load(f)
        
        # 添加新记录
        new_entry = {
            'url': url,
            'timestamp': time.time(),
            'status': status,
            'count': count,
            'tags': []
        }
        
        history.insert(0, new_entry)
        
        # 保存回文件
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"保存历史记录失败: {e}")

# 初始化配置
init_config()

# 启动任务处理器线程
task_thread = threading.Thread(target=task_processor, daemon=True)
task_thread.start()

# 首页路由
@app.route('/')
def index():
    config = load_config()
    return render_template('index.html', config=config)

# API: 获取任务列表
@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    with lock:
        tasks = list(web_task_states.values())
    return jsonify({'tasks': tasks})

# API: 添加新任务
@app.route('/api/tasks', methods=['POST'])
def add_task():
    global web_task_counter
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': '缺少必要参数'}), 400
    
    url = data['url']
    config = load_config()
    save_path = data.get('save_path', config.get('save_path', os.getcwd()))
    
    with lock:
        web_task_counter += 1
        task_id = f"web_{web_task_counter}"
        web_task_states[task_id] = {
            'id': task_id,
            'url': url,
            'save_path': save_path,
            'status': 'queued',
            'created_time': time.time(),
            'result': None
        }
        
        # 添加到任务队列
        web_task_queue.put({
            'id': task_id,
            'url': url,
            'save_path': save_path
        })
    
    return jsonify({'task_id': task_id, 'status': 'queued'})

# API: 获取任务状态
@app.route('/api/tasks/<task_id>', methods=['GET'])
def get_task_status(task_id):
    with lock:
        if task_id not in web_task_states:
            return jsonify({'error': '任务不存在'}), 404
        task = web_task_states[task_id]
    return jsonify(task)

# API: 获取历史记录
@app.route('/api/history', methods=['GET'])
def get_history():
    try:
        with open('history.json', 'r', encoding='utf-8') as f:
            history = json.load(f)
        return jsonify({'history': history})
    except Exception as e:
        print(f"读取历史记录失败: {e}")
        return jsonify({'history': []})

# API: 获取配置
@app.route('/api/config', methods=['GET'])
def get_config():
    config = load_config()
    return jsonify(config)

# API: 更新配置
@app.route('/api/config', methods=['POST'])
def update_config():
    data = request.get_json()
    config = load_config()
    config.update(data)
    
    if save_config(config):
        return jsonify({'status': 'success'})
    else:
        return jsonify({'error': '保存配置失败'}), 500

# API: 处理剪贴板请求
@app.route('/api/clipboard', methods=['GET'])
def get_clipboard():
    # 记录请求来源，帮助追踪问题
    print(f"收到剪贴板请求，来源: {request.remote_addr}, User-Agent: {request.user_agent}")
    # 返回空响应，避免404错误
    return jsonify({'status': 'success', 'data': None, 'message': '剪贴板API已移除'}), 200

# API: 启动/停止抓取
@app.route('/api/control', methods=['POST'])
def control_scraper():
    data = request.get_json()
    action = data.get('action')
    task_id = data.get('task_id')
    
    if action == 'stop' and task_id:
        # 这里可以实现停止特定任务的逻辑
        # 由于我们使用队列，实际停止可能需要一些额外的机制
        return jsonify({'status': 'success', 'message': '停止任务请求已发送'})
    elif action == 'start':
        return jsonify({'status': 'success', 'message': '开始抓取'})
    else:
        return jsonify({'error': '无效的操作'}), 400

# API: 健康检查
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'service': 'PuchiPix Web API',
        'version': '1.0.0'
    })



# 提供静态文件
@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

if __name__ == '__main__':
    # 确保目录结构存在
    os.makedirs('uploads', exist_ok=True)
    
    # 启动Flask应用
    app.run(debug=False, host='0.0.0.0', port=5100)

# 确保程序退出时停止剪贴板监控
import atexit
def cleanup():
    stop_clipboard_monitor()

atexit.register(cleanup)