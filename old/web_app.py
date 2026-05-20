#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import json
import time
import threading
import queue
import atexit
from datetime import datetime
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
import logging

# 添加项目根目录到Python路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 导入爬虫管理器
from scrapers.scraper_manager import ScraperManager

# 创建Flask应用
template_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'templates')
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'static')
app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
CORS(app)  # 启用跨域请求
app.config['SECRET_KEY'] = 'puchipix_secret_key'
app.config['UPLOAD_FOLDER'] = 'uploads'

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 全局变量
web_task_counter = 0
web_task_states = {}
web_task_queue = queue.Queue()
lock = threading.Lock()
scraper_manager = ScraperManager()
clipboard_monitor_thread = None
clipboard_monitoring = False

# 配置文件路径
CONFIG_FILE = 'config.json'

# 初始化配置
def init_config():
    """初始化配置文件"""
    default_config = {
        'save_path': os.path.join(os.getcwd(), 'downloads'),
        'max_workers': 4,
        'timeout': 30,
        'retry_count': 3,
        'clipboard_monitoring': False,
        'supported_sites': []
    }
    
    if not os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(default_config, f, indent=2, ensure_ascii=False)
        return default_config
    else:
        return load_config()

# 加载配置
def load_config():
    """加载配置文件"""
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        # 更新支持的网站列表
        config['supported_sites'] = scraper_manager.get_supported_sites()
        return config
    except Exception as e:
        logger.error(f"加载配置失败: {e}")
        return {
            'save_path': os.path.join(os.getcwd(), 'downloads'),
            'max_workers': 4,
            'timeout': 30,
            'retry_count': 3,
            'clipboard_monitoring': False,
            'supported_sites': []
        }

# 保存配置
def save_config(config):
    """保存配置文件"""
    try:
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        logger.error(f"保存配置失败: {e}")
        return False

# 剪贴板监控
def start_clipboard_monitor():
    """启动剪贴板监控"""
    global clipboard_monitor_thread, clipboard_monitoring
    
    if clipboard_monitoring:
        return True
    
    try:
        import pyperclip
        clipboard_monitoring = True
        clipboard_monitor_thread = threading.Thread(target=clipboard_monitor_loop, daemon=True)
        clipboard_monitor_thread.start()
        logger.info("剪贴板监控已启动")
        return True
    except ImportError:
        logger.warning("pyperclip未安装，无法启动剪贴板监控")
        return False
    except Exception as e:
        logger.error(f"启动剪贴板监控失败: {e}")
        return False

def stop_clipboard_monitor():
    """停止剪贴板监控"""
    global clipboard_monitoring
    clipboard_monitoring = False
    logger.info("剪贴板监控已停止")

def clipboard_monitor_loop():
    """剪贴板监控循环"""
    import pyperclip
    last_clipboard = ""
    
    while clipboard_monitoring:
        try:
            current_clipboard = pyperclip.paste()
            
            if current_clipboard != last_clipboard and current_clipboard.strip():
                # 检查是否是支持的URL
                if scraper_manager.is_valid_gallery_url(current_clipboard):
                    logger.info(f"检测到有效图库URL: {current_clipboard}")
                    # 这里可以自动添加任务到队列
                    # add_task_from_clipboard(current_clipboard)
                
                last_clipboard = current_clipboard
            
            time.sleep(1)  # 每秒检查一次
        except Exception as e:
            logger.error(f"剪贴板监控错误: {e}")
            time.sleep(5)  # 出错后等待5秒再继续

# 任务处理器
def task_processor():
    """处理任务队列"""
    while True:
        try:
            # 从队列获取任务
            task = web_task_queue.get(timeout=1)
            task_id = task['id']
            
            # 更新任务状态为运行中
            with lock:
                web_task_states[task_id]['status'] = 'running'
                web_task_states[task_id]['start_time'] = time.time()
            
            try:
                # 执行爬取任务
                result = execute_scrape_task(task['url'], task['save_path'])
                
                # 更新任务状态为完成或失败
                with lock:
                    web_task_states[task_id]['status'] = 'completed' if result['success'] else 'failed'
                    web_task_states[task_id]['end_time'] = time.time()
                    web_task_states[task_id]['result'] = result
                    
                    # 保存到历史记录
                    if result['success']:
                        save_to_history(task['url'], 'success', result.get('downloaded_count', 0))
                    else:
                        save_to_history(task['url'], 'failed', 0)
            except Exception as e:
                logger.error(f"执行任务时出错: {e}")
                with lock:
                    web_task_states[task_id]['status'] = 'failed'
                    web_task_states[task_id]['end_time'] = time.time()
                    web_task_states[task_id]['result'] = {
                        'success': False,
                        'message': str(e)
                    }
                save_to_history(task['url'], 'failed', 0)
            
            web_task_queue.task_done()
        except queue.Empty:
            continue
        except Exception as e:
            logger.error(f"任务处理错误: {e}")

# 执行爬取任务
def execute_scrape_task(url, save_path):
    """执行爬取任务，使用爬虫管理器"""
    try:
        # 创建保存目录
        os.makedirs(save_path, exist_ok=True)
        
        # 获取适当的爬虫实例
        scraper = scraper_manager.get_scraper_for_url(url)
        if not scraper:
            return {
                'success': False,
                'message': f'不支持的URL或无法识别网站: {url}'
            }
        
        # 创建WebDriver
        driver = scraper.create_driver()
        if not driver:
            return {
                'success': False,
                'message': '无法创建WebDriver实例'
            }
        
        try:
            # 提取图库ID
            gallery_id = scraper.extract_gallery_id(url)
            if not gallery_id:
                return {
                    'success': False,
                    'message': '无法从URL中提取图库ID'
                }
            
            # 执行爬取
            logger.info(f"开始爬取 {url} 到 {save_path}")
            result = scraper.scrape_gallery(driver, gallery_id, save_path)
            
            return {
                'success': True,
                'message': '爬取成功',
                'downloaded_count': result.get('downloaded_count', 0),
                'file_path': save_path,
                'gallery_id': gallery_id,
                'site_name': scraper.get_site_name()
            }
        finally:
            # 确保关闭浏览器
            try:
                driver.quit()
            except:
                pass
    except Exception as e:
        logger.error(f"爬取任务执行错误: {e}")
        return {
            'success': False,
            'message': str(e)
        }

def save_to_history(url, status, count):
    """保存任务到历史记录"""
    try:
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
        logger.error(f"保存历史记录失败: {e}")

# 初始化配置
config = init_config()

# 启动任务处理器线程
task_thread = threading.Thread(target=task_processor, daemon=True)
task_thread.start()

# 首页路由
@app.route('/')
def index():
    config_data = load_config()
    return render_template('dashboard.html', config=config_data)

@app.route('/dashboard')
def dashboard():
    config_data = load_config()
    return render_template('dashboard.html', config=config_data)

@app.route('/tasks')
def tasks():
    config_data = load_config()
    return render_template('tasks.html', config=config_data)

@app.route('/history')
def history():
    config_data = load_config()
    return render_template('history.html', config=config_data)

@app.route('/settings')
def settings():
    config_data = load_config()
    return render_template('settings.html', config=config_data)

# API: 获取支持的网站列表
@app.route('/api/sites', methods=['GET'])
def get_supported_sites():
    """获取支持的网站列表"""
    sites = scraper_manager.get_supported_sites()
    return jsonify({'sites': sites})

# API: 获取任务列表
@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    """获取当前任务列表"""
    with lock:
        tasks = list(web_task_states.values())
    return jsonify({'tasks': tasks})

# API: 添加新任务
@app.route('/api/tasks', methods=['POST'])
def add_task():
    """添加新的爬取任务"""
    global web_task_counter
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': '缺少必要参数'}), 400
    
    url = data['url']
    config_data = load_config()
    save_path = data.get('save_path', config_data.get('save_path', os.getcwd()))
    
    # 验证URL是否支持
    if not scraper_manager.is_valid_gallery_url(url):
        return jsonify({'error': f'不支持的URL格式: {url}'}), 400
    
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
    """获取特定任务的状态"""
    with lock:
        if task_id not in web_task_states:
            return jsonify({'error': '任务不存在'}), 404
        task = web_task_states[task_id]
    return jsonify(task)

# API: 获取历史记录
@app.route('/api/history', methods=['GET'])
def get_history():
    """获取爬取历史记录"""
    try:
        with open('history.json', 'r', encoding='utf-8') as f:
            history = json.load(f)
        return jsonify({'history': history})
    except Exception as e:
        logger.error(f"读取历史记录失败: {e}")
        return jsonify({'history': []})

# API: 清空历史记录
@app.route('/api/history', methods=['DELETE'])
def clear_history():
    """清空所有历史记录"""
    try:
        # 创建空的历史记录文件
        with open('history.json', 'w', encoding='utf-8') as f:
            json.dump([], f, indent=2, ensure_ascii=False)
        return jsonify({'status': 'success', 'message': '历史记录已清空'})
    except Exception as e:
        logger.error(f"清空历史记录失败: {e}")
        return jsonify({'error': '清空历史记录失败'}), 500

# API: 获取配置
@app.route('/api/config', methods=['GET'])
def get_config():
    """获取当前配置"""
    config_data = load_config()
    return jsonify(config_data)

# API: 更新配置
@app.route('/api/config', methods=['POST'])
def update_config():
    """更新配置"""
    data = request.get_json()
    config_data = load_config()
    config_data.update(data)
    
    if save_config(config_data):
        # 如果剪贴板监控设置发生变化，更新监控状态
        if 'clipboard_monitoring' in data:
            if data['clipboard_monitoring'] and not clipboard_monitoring:
                start_clipboard_monitor()
            elif not data['clipboard_monitoring'] and clipboard_monitoring:
                stop_clipboard_monitor()
        
        return jsonify({'status': 'success'})
    else:
        return jsonify({'error': '保存配置失败'}), 500

# API: 处理剪贴板请求
@app.route('/api/clipboard', methods=['GET'])
def get_clipboard():
    """获取剪贴板内容"""
    try:
        import pyperclip
        clipboard_content = pyperclip.paste()
        return jsonify({'status': 'success', 'data': clipboard_content})
    except ImportError:
        return jsonify({'status': 'error', 'message': 'pyperclip未安装'}), 500
    except Exception as e:
        logger.error(f"获取剪贴板内容失败: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500

# API: 启动/停止剪贴板监控
@app.route('/api/clipboard/monitor', methods=['POST'])
def toggle_clipboard_monitor():
    """启动或停止剪贴板监控"""
    data = request.get_json()
    action = data.get('action')
    
    if action == 'start':
        if start_clipboard_monitor():
            return jsonify({'status': 'success', 'message': '剪贴板监控已启动'})
        else:
            return jsonify({'status': 'error', 'message': '启动剪贴板监控失败'}), 500
    elif action == 'stop':
        stop_clipboard_monitor()
        return jsonify({'status': 'success', 'message': '剪贴板监控已停止'})
    else:
        return jsonify({'error': '无效的操作'}), 400

# API: 启动/停止抓取
@app.route('/api/control', methods=['POST'])
def control_scraper():
    """控制爬虫操作"""
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
    """健康检查端点"""
    return jsonify({
        'status': 'healthy',
        'service': 'PuchiPix Web API',
        'version': '2.0.0',
        'supported_sites': scraper_manager.get_supported_sites()
    })

# 提供静态文件
@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    """提供上传文件访问"""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

if __name__ == '__main__':
    # 确保目录结构存在
    os.makedirs('uploads', exist_ok=True)
    os.makedirs('downloads', exist_ok=True)
    
    # 启动Flask应用
    app.run(debug=False, host='0.0.0.0', port=5100)

# 确保程序退出时停止剪贴板监控
def cleanup():
    """清理资源"""
    stop_clipboard_monitor()

atexit.register(cleanup)