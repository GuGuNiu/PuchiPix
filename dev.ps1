<#
.SYNOPSIS
    PuchiPix 一键启动前后端开发服务器
.DESCRIPTION
    后端 (Go + Air 热重载)  → http://localhost:10541
    前端 (Vite + React)     → http://localhost:10540
    前端已配置 /api 代理到后端，无需额外设置。

    默认在两个独立终端窗口中启动，关闭窗口即停止服务。
    加 -Merged 可在当前终端合并输出（Ctrl+C 停止全部）。
.PARAMETER BackendOnly
    仅启动后端
.PARAMETER FrontendOnly
    仅启动前端
.PARAMETER NoAir
    后端使用 go run 而非 air 热重载
.PARAMETER Merged
    在当前终端合并前后端输出（而非开新窗口）
.EXAMPLE
    .\dev.ps1
    在两个新窗口中启动前后端
.EXAMPLE
    .\dev.ps1 -Merged
    在当前终端合并输出，Ctrl+C 停止全部
.EXAMPLE
    .\dev.ps1 -BackendOnly -NoAir
    仅启动后端，用 go run 而非 air
#>
param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$NoAir,
    [switch]$Merged
)

$ErrorActionPreference = "Stop"
$Root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$Back   = Join-Path $Root "backend"
$Front  = Join-Path $Root "frontend"

# ── 颜色输出 ──
function W([string]$tag, [string]$msg) {
    $c = switch ($tag) {
        "BACKEND"  { "Cyan" }
        "FRONTEND" { "Green" }
        "SYSTEM"   { "Yellow" }
        "ERROR"    { "Red" }
        default    { "White" }
    }
    Write-Host "[$(Get-Date -f 'HH:mm:ss')] [$tag] $msg" -F $c
}

# ── 依赖检查 ──
W "SYSTEM" "PuchiPix 开发服务器启动器"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    W "ERROR" "未检测到 go，请先安装 Go 1.26+"; exit 1
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    W "ERROR" "未检测到 pnpm，请运行: npm i -g pnpm"; exit 1
}

$useAir = -not $NoAir
if ($useAir -and -not (Get-Command air -ErrorAction SilentlyContinue)) {
    W "SYSTEM" "未检测到 air，回退到 go run"
    W "SYSTEM" "如需热重载: go install github.com/air-verse/air@latest"
    $useAir = $false
}

# 前端依赖检查
if (-not (Test-Path (Join-Path $Front "node_modules"))) {
    W "FRONTEND" "node_modules 不存在，执行 pnpm install..."
    Push-Location $Front; pnpm install; Pop-Location
}

# ── 构建启动命令 ──
$beCmd = if ($useAir) { "air" } else { "go run -buildvcs=false ./cmd/server" }
$feCmd = "pnpm dev"

if ($Merged) {
    # ── 合并模式：在当前终端启动，Ctrl+C 统一停止 ──
    $jobs = @()

    if (-not $FrontendOnly) {
        W "BACKEND" "启动: $beCmd"
        $jobs += Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -Command $beCmd" `
            -WorkingDirectory $Back -NoNewWindow -PassThru -RedirectStandardOutput "$Back\.tmp\be_out.log" `
            -RedirectStandardError "$Back\.tmp\be_err.log" 2>$null
        # 回退：如果重定向失败就不重定向
        if (-not $jobs[-1]) {
            $jobs += Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -Command $beCmd" `
                -WorkingDirectory $Back -NoNewWindow -PassThru
        }
        W "BACKEND" "PID $($jobs[-1].Id) → :10541"
    }
    if (-not $BackendOnly) {
        W "FRONTEND" "启动: $feCmd"
        $jobs += Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -Command $feCmd" `
            -WorkingDirectory $Front -NoNewWindow -PassThru
        W "FRONTEND" "PID $($jobs[-1].Id) → :10540"
    }

    W "SYSTEM" "Ctrl+C 停止全部服务"
    W "SYSTEM" "前端 http://localhost:10540 | 后端 http://localhost:10541"
    Write-Host ""

    try {
        while ($true) {
            Start-Sleep -Seconds 1
            $alive = $false
            foreach ($j in $jobs) {
                if ($j -and -not $j.HasExited) { $alive = $true; break }
            }
            if (-not $alive) { W "SYSTEM" "所有子进程已退出"; break }
        }
    } finally {
        foreach ($j in $jobs) {
            if ($j -and -not $j.HasExited) {
                try { Stop-Process -Id $j.Id -Force -ErrorAction SilentlyContinue } catch {}
            }
        }
        W "SYSTEM" "已退出"
    }
}
else {
    # ── 默认模式：在独立窗口启动 ──
    if (-not $FrontendOnly) {
        W "BACKEND" "在新窗口启动: $beCmd"
        Start-Process -FilePath "cmd" -ArgumentList "/k title PuchiPix Backend && cd /d `"$Back`" && $beCmd" -WindowStyle Normal
        W "BACKEND" "→ http://localhost:10541"
    }
    if (-not $BackendOnly) {
        W "FRONTEND" "在新窗口启动: $feCmd"
        Start-Process -FilePath "cmd" -ArgumentList "/k title PuchiPix Frontend && cd /d `"$Front`" && $feCmd" -WindowStyle Normal
        W "FRONTEND" "→ http://localhost:10540"
    }

    W "SYSTEM" "关闭对应窗口即停止服务"
    W "SYSTEM" "前端 http://localhost:10540 | 后端 http://localhost:10541"
    Write-Host ""
}
