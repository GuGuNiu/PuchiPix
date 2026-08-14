# PuchiPix 一键启动

## 快速开始

### 方式一：双击运行（最简单）

双击根目录下的 `dev.bat`，会在两个独立窗口中启动前后端。

### 方式二：PowerShell（功能更多）

```powershell
# 默认：两个新窗口启动
.\dev.ps1

# 在当前终端合并输出，Ctrl+C 统一停止
.\dev.ps1 -Merged

# 仅启动后端
.\dev.ps1 -BackendOnly

# 仅启动前端
.\dev.ps1 -FrontendOnly

# 后端用 go run 而非 air 热重载
.\dev.ps1 -NoAir
```

### 方式三：命令行直接运行

```bat
dev.bat
```

## 端口

| 服务 | 端口   | 地址                    |
| ---- | ------ | ----------------------- |
| 前端 | 10540  | http://localhost:10540  |
| 后端 | 10541  | http://localhost:10541  |

前端 Vite 已配置 `/api` 代理到后端，开发时无需关心跨域。

## 前置依赖

| 工具  | 版本  | 安装命令                              |
| ----- | ----- | ------------------------------------- |
| Go    | 1.26+ | https://go.dev/dl/                    |
| pnpm  | 10+   | `npm i -g pnpm`                       |
| air   | 可选  | `go install github.com/air-verse/air@latest` |

> air 未安装时会自动回退到 `go run`，只是没有热重载。
