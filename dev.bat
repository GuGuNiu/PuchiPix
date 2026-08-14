@echo off
chcp 65001 >nul 2>&1
title PuchiPix Dev Launcher

REM ══════════════════════════════════════════════
REM  PuchiPix 一键启动器
REM  前端 Vite  → http://localhost:10540
REM  后端 Go    → http://localhost:10541
REM  用法: 双击运行 或 命令行 .\dev.bat
REM ══════════════════════════════════════════════

cd /d "%~dp0"

echo.
echo   ╔══════════════════════════════════════════╗
echo   ║          PuchiPix 一键启动器              ║
echo   ║   前端 → :10540    后端 → :10541          ║
echo   ╚══════════════════════════════════════════╝
echo.

REM ── 依赖检查 ──
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 go，请先安装 Go 1.26+
    pause
    exit /b 1
)
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 pnpm，请运行: npm i -g pnpm
    pause
    exit /b 1
)

REM ── 前端依赖检查 ──
if not exist "frontend\node_modules" (
    echo [前端] node_modules 不存在，执行 pnpm install...
    cd frontend
    call pnpm install
    cd ..
    echo.
)

REM ── 检测 air ──
set BE_CMD=go run -buildvcs=false ./cmd/server
where air >nul 2>&1
if %errorlevel% equ 0 (
    set BE_CMD=air
    echo [后端] 使用 air 热重载
) else (
    echo [后端] air 未安装，使用 go run
    echo [提示] 如需热重载: go install github.com/air-verse/air@latest
)

echo.

REM ── 启动后端 (新窗口) ──
echo [启动] 后端...
start "PuchiPix Backend" cmd /k "cd /d %~dp0backend && %BE_CMD%"

REM 等待后端初始化
timeout /t 2 /nobreak >nul

REM ── 启动前端 (新窗口) ──
echo [启动] 前端...
start "PuchiPix Frontend" cmd /k "cd /d %~dp0frontend && pnpm dev"

echo.
echo   ────────────────────────────────────
echo   [完成] 两个服务已在新窗口中启动
echo.
echo   后端窗口: PuchiPix Backend  → :10541
echo   前端窗口: PuchiPix Frontend → :10540
echo.
echo   访问 http://localhost:10540 打开前端
echo   关闭对应窗口即可停止服务
echo   ────────────────────────────────────
echo.
pause
