import os
import sys
import json

def get_resource_path(relative_path):
    """获取资源文件的绝对路径"""
    try:
        # PyInstaller创建的临时文件夹
        base_path = sys._MEIPASS
    except Exception:
        # 开发环境
        base_path = os.path.abspath(".")
    
    return os.path.join(base_path, relative_path)

def load_config():
    """加载配置文件"""
    config_path = get_resource_path("config.json")
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    else:
        # 返回默认配置
        return {
            "ffmpeg_path": "",
            "chromedriver_path": "",
            "browser": "chrome",
            "rename_format": "{title}_{index}",
            "save_format": "原始格式",
            "threads": "16",
            "concurrent_tasks": "3"
        }

def save_config(config):
    """保存配置文件"""
    config_path = get_resource_path("config.json")
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=4)

# 全局变量，用于存储数据文件的实际路径
HISTORY_FILE = get_resource_path("history.json")
CONFIG_FILE = get_resource_path("config.json")
FAILED_TASKS_FILE = get_resource_path("failed_tasks.txt")
TASK_STATE_FILE = get_resource_path("task_state.json")

if __name__ == "__main__":
    # 运行主应用程序
    from main import main
    main()