# Tasks
## 环境准备与旧文件迁移
- [x] Task 1: 创建项目目录结构并迁移旧文件
  - [x] 创建 `backend/`、`frontend/`、`old/` 等目录结构
  - [x] 将所有现有 Python 文件、配置文件、静态资源等迁移至 `old/` 目录（保持原有目录结构）
  - [x] 保留 `chromedriver.exe` 在根目录
  - [x] 初始化 Go module (`backend/go.mod`)
  - [x] 初始化 Rust 项目 (`frontend/Cargo.toml`)
  - [x] 创建 `.gitignore` 忽略构建产物和临时文件

## Go 后端开发
- [x] Task 2: 实现 Go 后端基础框架
  - [x] 创建 `cmd/server/main.go` 主入口（HTTP 服务器启动，端口 10540）
  - [x] 配置路由和中间件（使用 Gin 框架）
  - [x] 实现日志模块 (`pkg/logger/`)
  - [x] 实现配置管理模块 (`internal/config/config.go`)
  - [x] 实现统一错误处理和响应格式

- [x] Task 3: 实现数据库层（SQLite，pure Go 驱动 `github.com/glebarez/sqlite`）
  - [x] 初始化 SQLite 数据库连接（GORM）
  - [x] 创建数据模型：DownloadTask、VideoInfo、AppConfig
  - [x] 实现数据库自动迁移
  - [x] 实现 CRUD 操作封装

- [x] Task 4: 实现 M3U8 下载引擎
  - [x] 实现 M3U8 播放列表解析器（支持多码率自适应）
  - [x] 实现 TS 分片下载器（支持并发下载）
  - [x] 实现分片合并器（将 TS 分片合并为完整视频文件）
  - [x] 实现断点续传功能（HTTP Range 头部）
  - [x] 实现下载进度回调

- [x] Task 5: 实现 ChromeDriver 嗅探模块
  - [x] 封装 ChromeDriver 进程管理（启动/关闭）
  - [x] 实现网络请求拦截（通过 CDP 监听 M3U8 URL）
  - [x] 实现嗅探结果回调管道
  - [x] 实现浏览器控制接口（导航、点击、滚动等）
  - [x] 支持调试模式（显示/隐藏浏览器窗口）

- [x] Task 6: 实现 FFmpeg 视频转码模块
  - [x] 封装 FFmpeg 进程调用
  - [x] 实现 TS → MP4 转码（concat demuxer）
  - [x] 实现转码进度回调
  - [x] 支持转码参数配置

- [x] Task 7: 实现任务管理 API
  - [x] 创建任务（POST /api/tasks）
  - [x] 获取任务列表（GET /api/tasks）
  - [x] 获取任务详情（GET /api/tasks/:id）
  - [x] 删除任务（DELETE /api/tasks/:id）
  - [x] 取消任务（POST /api/tasks/:id/cancel）
  - [x] 暂停/恢复任务（POST /api/tasks/:id/pause, /resume）
  - [x] 重试失败任务（POST /api/tasks/:id/retry）

- [x] Task 8: 实现嗅探管理 API
  - [x] 启动嗅探（POST /api/sniff/start）
  - [x] 停止嗅探（POST /api/sniff/stop）
  - [x] 获取嗅探状态（GET /api/sniff/status）
  - [x] 获取检测到的链接列表（GET /api/sniff/urls）
  - [x] 添加检测到的链接到下载队列（POST /api/sniff/urls/:id/download）

- [x] Task 9: 实现配置和历史记录 API
  - [x] 获取配置（GET /api/config）
  - [x] 更新配置（PUT /api/config）
  - [x] 获取下载历史（GET /api/history）
  - [x] 清空历史（DELETE /api/history）
  - [x] 获取仪表盘统计数据（GET /api/stats）

- [x] Task 10: 实现 WebSocket 实时推送
  - [x] 实现任务进度实时推送（WS /api/ws）
  - [x] 实现嗅探结果实时推送
  - [x] 实现转码进度实时推送

## Rust 前端开发（含 fallback 生产前端）
- [x] Task 11: 初始化 Rust WASM 前端项目
  - [x] 配置 Cargo.toml（Yew、wasm-bindgen、serde、yew-router 等）
  - [x] 配置 Trunk 构建工具（Trunk.toml，端口 10541）
  - [x] 实现入口文件 `main.rs`
  - [x] 实现应用根组件 `app.rs`
  - [x] 配置全局样式（DevOps 暗色主题）

- [x] Task 12: 实现 HTTP API 客户端
  - [x] 封装 fetch 请求（支持 GET/POST/PUT/DELETE）
  - [x] 实现 WebSocket 客户端
  - [x] 定义请求/响应数据类型
  - [x] 实现错误处理

- [x] Task 13: 实现布局和导航组件
  - [x] 实现侧边导航栏（仪表盘、任务管理、嗅探控制、配置、历史记录）
  - [x] 实现顶部状态栏
  - [x] 实现页面路由

- [x] Task 14: 实现仪表盘页面
  - [x] 显示统计卡片（总任务数、进行中、已完成、失败）
  - [x] 显示实时下载速度
  - [x] 显示最近任务概览

- [x] Task 15: 实现任务管理页面
  - [x] 任务列表表格（ID、URL、状态、进度、操作按钮）
  - [x] 添加任务表单（URL 输入、转码 MP4 勾选、码率选择）
  - [x] 任务操作（开始、暂停、取消、删除、重试）
  - [x] 任务详情展开面板
  - [x] 批量导入功能

- [x] Task 16: 实现嗅探控制页面
  - [x] 目标网站 URL 输入框
  - [x] 启动/停止嗅探按钮
  - [x] 检测到的 M3U8 链接列表
  - [x] 一键添加到下载队列
  - [x] 浏览器调试模式开关

- [x] Task 17: 实现配置页面
  - [x] ChromeDriver 路径配置
  - [x] FFmpeg 路径配置
  - [x] 默认下载路径配置
  - [x] 并发下载数配置
  - [x] 默认转码 MP4 开关
  - [x] 保存/重置按钮

- [x] Task 18: 实现历史记录页面
  - [x] 历史记录列表（筛选、排序、搜索）
  - [x] 历史记录详情
  - [x] 重新下载功能
  - [x] 清空历史功能

## 集成与测试
- [x] Task 19: 前后端集成与静态文件服务
  - [x] Go 后端集成前端构建产物（`backend/web/dist/`）
  - [x] 开发模式（前后端分离）和生产模式（单文件部署）均支持
  - [x] 配置 CORS 和跨域处理

- [x] Task 20: 端到端测试与验证
  - [x] Go 后端编译通过（`go build ./...`）
  - [x] 服务启动成功，端口 10540
  - [x] Health API 正常响应
  - [x] Config API 正常读写
  - [x] Stats API 返回正确数据
  - [x] Task CRUD API 正常工作
  - [x] 前端静态文件正常服务（HTTP 200）
  - [x] SQLite 数据库自动创建和迁移成功
  - [x] 纯 SQLite 驱动（无 CGO 依赖）编译运行正常

# Task Dependencies
- [Task 2-5] 依赖于 [Task 1]（项目环境准备）
- [Task 7-10] 依赖于 [Task 2, 3]（后端框架和数据库）
- [Task 6] 可独立于 [Task 4] 开发
- [Task 11-18] 依赖于 [Task 1]（前端环境准备）
- [Task 13-18] 依赖于 [Task 11, 12]（前端基础框架）
- [Task 14-18] 可并行开发
- [Task 19] 依赖于 [Task 7-10] 和 [Task 13-18]
- [Task 20] 依赖于 [Task 19]