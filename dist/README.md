# PuchiPix - 噗呲专用 🖼️✨

[![Python](https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Selenium](https://img.shields.io/badge/Selenium-Automation-green?style=for-the-badge&logo=selenium&logoColor=white)](https://www.selenium.dev/)
[![Tkinter](https://img.shields.io/badge/Tkinter-GUI-orange?style=for-the-badge&logo=tkinter&logoColor=white)](https://docs.python.org/3/library/tkinter.html)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-Video-blueviolet?style=for-the-badge&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)

**PuchiPix** 是为“爱妹子”写真站开发的自动图包下载器
---

![img](https://s2.loli.net/2025/09/17/RCNrzbMaKXWf5Qs.png)

## ✨ 核心功能

*   **多任务队列**: 一次添加，批量处理。轻松管理的下载列表。
*   **智能媒体识别**: 无论是图片集还是视频，PuchiPix都能自动识别并采用最佳下载策略。
*   **无忧浏览器自动化**:
    *   **全自动驱动管理**
    *   **动态内容克星**
*   **视频下载 & 合并**: 内置强大的 **FFmpeg** 支持，自动将M3U8视频流合并为完整的 `.mp4` 文件。
*   **强大的历史管理**:
    *   所有下载记录一目了然。
    *   通过标题或Tags进行**实时搜索**。
    *   **标签筛选系统**，预设与自定义标签让分类和查找变得前所未有的简单。
*   **高度自定义**:
    *   灵活的**文件重命名**规则。
    *   **调试模式**开关，自由选择是否显示浏览器工作窗口。

---

## 🚀 快速开始

### 1. 安装依赖

确保已安装 Python 3.10+，然后在命令行运行：

```bash
pip install --upgrade selenium requests beautifulsoup4 ttkbootstrap Pillow webdriver-manager
```

### 2. (可选) 准备 FFmpeg

如需下载视频，请从 [FFmpeg 官网](https://ffmpeg.org/download.html) 下载，并将 `ffmpeg.exe` 的路径配置在程序界面中。

### 3. 运行

```bash
python main.py
```

---

## 📝 使用须知

本项目仅供学习和技术交流。请在遵守网站用户协议的前提下使用。

## 📦 打包说明

如果需要将此应用程序打包为独立的可执行文件，请参考 [README_PACKAGING.md](README_PACKAGING.md) 文件获取详细说明。

推荐使用 `build.ps1` PowerShell脚本来进行打包。
