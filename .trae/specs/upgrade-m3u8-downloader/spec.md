# M3U8 Downloader Application Upgrade Spec

## Why
将现有的 Python 图像抓取工具（PuchiPix）全面升级为基于 Go + Rust 技术栈的专业 M3U8 视频下载应用，提供更稳定的性能、更好的用户体验和更强的扩展性。

## What Changes

### 架构变更
- **完全重写后端**：Python → Go 语言，提供高性能 API 服务和下载管理
- **完全重写前端**：Flask/Jinja2 模板 → Rust WASM (Yew/Leptos) 前端框架，提供响应式 Web 控制面板
- **数据存储升级**：JSON 文件 → SQLite 数据库（使用 GORM）
- **移除 Python 桌面 GUI**（tkinter/ttkbootstrap），仅保留 Web 控制面板

### 功能变更
- **新增 M3U8 下载器**：核心功能，支持 M3U8 视频流的解析和下载
- **新增视频转码模块**：集成 FFmpeg，支持转码为 MP4 格式
- **新增 ChromeDriver 自动化**：自动访问网站嗅探 M3U8 视频链接
- **新增数据库存储**：SQLite 记录下载历史、视频信息、配置等
- **保留并优化**：剪贴板监控、任务队列管理、并发下载等现有功能
- **移除**：图像抓取功能（不再作为核心功能）、Python 桌面 GUI

### 文件迁移
- 将所有旧文件（.py、.json、.txt 等）迁移至 `old/` 目录
- 新的项目结构以 Go module 为基础重新组织

**BREAKING**: 完全替换现有 Python 代码库，旧文件将被迁移至 `old/` 目录

## Impact
- Affected specs: 完全替换现有系统
- Affected code: 所有现有文件将被迁移至 `old/` 目录，新代码从头构建

## Architecture

```
PuchiPix/
├── data/                         # 数据存储目录
│   ├── puchipix.db               # SQLite 数据库文件
│   └── videos/                   # 下载的视频文件存储目录
│
├── old/                          # 旧版本文件迁移目录
│   ├── main.py
│   ├── web_app.py
│   ├── config.json
│   ├── history.json
│   ├── scrapers/
│   ├── web/
│   └── ...
│
├── backend/                      # Go 后端 (端口: 10540)
│   ├── cmd/
│   │   └── server/              # 主入口
│   │       └── main.go
│   ├── internal/
│   │   ├── api/                 # HTTP API 处理器
│   │   │   ├── handler.go
│   │   │   ├── task_handler.go
│   │   │   ├── config_handler.go
│   │   │   └── history_handler.go
│   │   ├── downloader/          # M3U8 下载核心
│   │   │   ├── m3u8.go          # M3U8 解析器
│   │   │   ├── downloader.go    # 下载管理器
│   │   │   └── segment.go       # TS 分片下载
│   │   ├── sniff/               # ChromeDriver 嗅探模块
│   │   │   ├── sniffer.go       # 自动化浏览器控制
│   │   │   └── interceptor.go   # 网络请求拦截
│   │   ├── transcoder/          # 视频转码模块
│   │   │   └── transcoder.go    # FFmpeg 转码封装
│   │   ├── model/               # 数据模型
│   │   │   ├── task.go          # 下载任务模型
│   │   │   ├── video.go         # 视频信息模型
│   │   │   └── config.go        # 配置模型
│   │   ├── database/            # 数据库层
│   │   │   ├── db.go            # 数据库初始化
│   │   │   └── migrations.go    # 数据库迁移
│   │   └── config/              # 配置管理
│   │       └── config.go
│   ├── pkg/
│   │   ├── logger/              # 日志模块
│   │   └── utils/               # 工具函数
│   ├── web/                     # Rust WASM 前端构建产物
│   │   └── dist/
│   ├── go.mod
│   ├── go.sum
│   └── Makefile
│
├── frontend/                    # Rust WASM 前端源码 (dev 端口: 10541)
│   ├── src/
│   │   ├── main.rs              # 入口
│   │   ├── app.rs               # 应用根组件
│   │   ├── components/          # UI 组件
│   │   │   ├── layout.rs        # 布局组件（侧边栏+顶栏）
│   │   │   ├── dashboard.rs     # 仪表盘
│   │   │   ├── task_list.rs     # 任务列表
│   │   │   ├── task_detail.rs   # 任务详情
│   │   │   ├── config_panel.rs  # 配置面板
│   │   │   ├── history.rs       # 历史记录
│   │   │   ├── sniff_panel.rs   # 嗅探控制面板
│   │   │   └── format_selector.rs # 格式选择器
│   │   ├── api/                 # API 客户端
│   │   │   └── client.rs
│   │   ├── models/              # 前端数据模型
│   │   │   └── types.rs
│   │   └── styles/              # 样式 (DevOps 工业风)
│   │       └── main.css
│   ├── Cargo.toml
│   ├── Trunk.toml               # Trunk 构建配置 (dev proxy: 10540)
│   └── index.html
│
├── chromedriver.exe             # ChromeDriver 二进制（保留）
├── README.md                    # 更新 README
└── .gitignore
```

### Port Allocation
- **10540**: Go 后端主服务（API + 前端静态文件托管）
- **10541**: Rust 前端开发服务器（Trunk dev server，API 请求代理至 10540）

## ADDED Requirements

### Requirement: M3U8 Download Engine
The system SHALL provide a complete M3U8 video download engine.

#### Scenario: Basic M3U8 download
- **WHEN** user provides an M3U8 URL
- **THEN** the system downloads all TS segments and merges them into a single video file

#### Scenario: Multi-resolution M3U8
- **WHEN** M3U8 playlist contains multiple resolution variants
- **THEN** the system displays available qualities and allows user selection

#### Scenario: Download resume
- **WHEN** download is interrupted and restarted
- **THEN** the system resumes from where it left off (partial segment download)

### Requirement: ChromeDriver Sniffing
The system SHALL use ChromeDriver to automate website browsing and sniff M3U8 URLs.

#### Scenario: Start sniffing
- **WHEN** user enters a target website URL and starts sniffing
- **THEN** the system launches ChromeDriver, navigates to the website, and monitors network requests for M3U8 URLs

#### Scenario: M3U8 URL detected
- **WHEN** ChromeDriver intercepts an M3U8 URL during browsing
- **THEN** the system displays the detected URL and allows adding it to the download queue

### Requirement: Video Transcoding
The system SHALL support video transcoding to MP4 format via FFmpeg.

#### Scenario: Enable MP4 transcoding
- **WHEN** user checks the "转码为MP4" option before download
- **THEN** the system automatically transcodes the downloaded video to MP4 format after download completion

#### Scenario: Transcode existing video
- **WHEN** user selects an already downloaded video and requests transcoding
- **THEN** the system transcodes it to MP4 format

### Requirement: Database Storage
The system SHALL use SQLite database for persistent storage.

#### Scenario: Store download history
- **WHEN** a download task completes
- **THEN** the system stores task details (URL, file path, format, timestamp, status) in the database

#### Scenario: Retrieve history
- **WHEN** user requests download history
- **THEN** the system queries and returns all historical records from the database

#### Scenario: Store configuration
- **WHEN** user saves configuration settings
- **THEN** the system persists settings to the database

### Requirement: Web Control Panel
The system SHALL provide an intuitive web control panel built with Rust WASM, styled in a DevOps-inspired industrial design with dark color scheme and appropriate rounded corners.

#### UI Design Guidelines
- **Color palette**: Dark backgrounds (#1a1a2e, #16213e, #0f3460), accent colors in teal/cyan (#00b4d8, #48cae4), status colors (green for success, yellow for warning, red for error, blue for info), light text (#e0e0e0, #ffffff)
- **Typography**: Clean sans-serif font (system-ui, -apple-system), monospace for technical data
- **Layout**: Fixed sidebar navigation + main content area, responsive grid system
- **Components**: Rounded corners (border-radius: 6px-12px), subtle box shadows, minimal borders, card-based layout
- **Interactive elements**: Hover effects, transition animations, loading spinners, toast notifications
- **Inspiration**: Grafana, GitLab, Prometheus UI aesthetics

#### Scenario: Dashboard overview
- **WHEN** user opens the web control panel
- **THEN** the system displays a dashboard with task statistics (total, active, completed, failed)

#### Scenario: Task management
- **WHEN** user views the task list
- **THEN** the system shows all tasks with status, progress, and action buttons (start, pause, cancel, delete)

#### Scenario: Sniffing control
- **WHEN** user navigates to the sniffing control panel
- **THEN** the system provides interface to enter website URL, start/stop sniffing, and view detected M3U8 links

#### Scenario: Format selection
- **WHEN** user configures a download task
- **THEN** the system provides a checkbox option "转码为MP4" for format selection

## MODIFIED Requirements

### Requirement: Task Queue Management
[Modified from existing task queue system]
- Changed from in-memory queue + JSON persistence to database-backed task management
- Added support for task prioritization and scheduling
- Added pause/resume/cancel operations

### Requirement: Configuration Management
[Modified from existing config.json system]
- Changed from JSON file to database storage
- Added M3U8-specific configuration options
- Added format selection (MP4 transcoding toggle)

## REMOVED Requirements

### Requirement: Image Scraping
**Reason**: 项目核心功能从图像抓取迁移至 M3U8 视频下载
**Migration**: 旧版图像抓取代码迁移至 `old/` 目录备查

### Requirement: Python Desktop GUI
**Reason**: 统一使用 Web 控制面板作为唯一用户界面
**Migration**: 仅保留 Rust WASM Web 前端

### Requirement: Multi-site Scraper Plugins
**Reason**: 使用 ChromeDriver 通用嗅探方案替代特定网站爬虫
**Migration**: 旧版爬虫代码迁移至 `old/` 目录备查