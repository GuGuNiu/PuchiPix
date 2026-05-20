# PuchiPix - 图像抓取工具

## 简介
PuchiPix是一个功能强大的图像抓取工具，支持从各种网站抓取图片和视频。本工具同时提供Python桌面界面和现代化的Web界面，方便用户在不同场景下使用。

## 功能特点

### 桌面界面功能
- 支持URL输入和批量导入
- 多线程下载
- 任务队列管理
- 历史记录追踪
- 自定义标签
- 视频下载和合并
- 性能监控
- 剪贴板监控

### Web界面功能
- 现代化响应式设计
- 实时任务监控
- 历史记录查看
- 配置管理
- 动画和过渡效果
- 移动设备支持

## 安装说明

### 1. 安装Python
确保您的系统已安装Python 3.8或更高版本。

### 2. 安装依赖

```bash
# 使用pip安装所有依赖
pip install -r requirements.txt
```

### 3. 安装Chrome浏览器
确保您的系统已安装Google Chrome浏览器，WebDriver将自动与您的Chrome版本匹配。

## 使用方法

### 启动应用

```bash
# 运行主程序
python main.py
```

运行后，系统将同时启动：
1. Python桌面界面
2. Web服务器（默认端口5000）

### 使用Web界面

1. 在浏览器中访问：http://localhost:5000
2. 在主页面输入要抓取的URL，点击"开始抓取"
3. 在任务管理页面查看任务进度
4. 在历史记录页面查看已完成的任务
5. 在设置页面配置下载路径、线程数等参数

### 使用桌面界面

直接使用启动后的桌面窗口，功能与Web界面类似，但提供了更多高级选项。

## 配置说明

配置文件位于 `config.json`，主要配置项包括：

- `save_path`: 下载文件保存路径
- `ffmpeg_path`: ffmpeg可执行文件路径（用于视频处理）
- `download_threads`: 下载线程数
- `concurrent_tasks`: 并发任务数
- `save_format`: 图片保存格式
- `download_video`: 是否下载视频
- `custom_tags`: 自定义标签列表
- `clipboard_monitor`: 是否启用剪贴板监控

这些配置可以通过Web界面或桌面界面的设置页面进行修改。

## 项目结构

```
PuchiPix/
├── main.py              # 主程序入口
├── web_app.py           # Web应用程序
├── config.json          # 配置文件
├── history.json         # 历史记录
├── failed_tasks.txt     # 失败任务记录
├── task_state.json      # 任务状态
├── requirements.txt     # 依赖列表
├── web/                 # Web界面文件
│   ├── templates/       # HTML模板
│   │   └── index.html   # 主页面
│   └── static/          # 静态资源
│       ├── css/         # CSS样式
│       │   └── style.css
│       └── js/          # JavaScript脚本
│           └── app.js
└── uploads/             # 上传文件目录
```

## 注意事项

1. 使用时请遵守相关网站的服务条款和版权法规
2. 大量抓取可能会导致IP被网站封禁，建议适当控制抓取频率
3. WebDriver会自动管理，但请确保Chrome浏览器已正确安装
4. 视频处理需要ffmpeg，请确保已正确配置ffmpeg路径

## 故障排除

### Web界面无法访问
- 检查端口5000是否被占用
- 检查防火墙设置
- 查看控制台输出的错误信息

### 抓取失败
- 检查URL是否正确
- 检查网络连接
- 检查Chrome浏览器是否正常安装
- 检查保存路径是否有写入权限

## 许可证

本项目仅供个人学习和研究使用。