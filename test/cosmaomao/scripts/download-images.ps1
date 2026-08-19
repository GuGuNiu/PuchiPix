#Requires -Version 7
<#
.SYNOPSIS
    下载COS猫猫图片到本地文件夹

.DESCRIPTION
    从WordPress REST API获取的图片URL列表下载到本地
#>

$ErrorActionPreference = "Stop"

# 配置
$Config = @{
    OutputDir = "E:\data\Github\PuchiPix\test\cosmaomao\downloads\cosmaomao-images"
    BaseUrl   = "https://cosmaomao.com"
}

# 图片URL列表 (37张)
$ImageUrls = @(
    "https://cosmaomao.com/wp-content/uploads/2026/07/275768795872641.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/06a89f92339f57a.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/90c029158cdfeeb.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/fff3bf06ce92acc.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/14582ab345f1f0f.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/cb95da69533f984.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/f538f6052179332.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/0cdf70abadcd215.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/edc2bc5e650ed1f.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/35bc4b152e41dc1.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/dde38b3a14e93e4.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/dae89358754859d.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/21bcf301f0ee252.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/c667410fbe35538.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/34cbe61272ec44d.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/806e42d84820472.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/996d9b3701ce321.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/c505f669f76b191.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/9dc2ad0300952de.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/4efaed5e1931c57.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/8b828c64f63d501.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/ac611e26d245ba5.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/3340b6e23015919.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/d1a520153f1ee7a.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/51ecd9f32fecde7.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/bdcd63d1bb3a868.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/5ad3d1344105d64.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/a3aeec1a9b68223.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/b8ade3e078df25a.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/1d04fa51ed04c0c.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/82abacb6ecd1d4b.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/37f674f40d21719.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/4cffcd5887ba1f6.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/91823d1903f115a.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/0c88e279fccc14d.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/5b93fc43bf9c25a.jpg"
    "https://cosmaomao.com/wp-content/uploads/2026/07/7ac9f6a90ecb4d1.jpg"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COS猫猫图片下载工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 创建输出目录
if (-not (Test-Path $Config.OutputDir)) {
    New-Item -ItemType Directory -Path $Config.OutputDir -Force | Out-Null
    Write-Host "✓ 创建目录: $($Config.OutputDir)" -ForegroundColor Green
}

Write-Host "📁 下载目录: $($Config.OutputDir)" -ForegroundColor Cyan
Write-Host "🖼️  图片数量: $($ImageUrls.Count) 张" -ForegroundColor Cyan
Write-Host ""

# 下载统计
$SuccessCount = 0
$FailCount = 0
$TotalSize = 0

# 下载图片
for ($i = 0; $i -lt $ImageUrls.Count; $i++) {
    $url = $ImageUrls[$i]
    $filename = [System.IO.Path]::GetFileName($url)
    $filepath = Join-Path $Config.OutputDir $filename
    $progress = "[$($i + 1)/$($ImageUrls.Count)]"

    Write-Host "$progress 下载 $filename ... " -NoNewline

    try {
        $response = Invoke-WebRequest -Uri $url -OutFile $filepath -ErrorAction Stop
        $fileInfo = Get-Item $filepath
        $sizeKB = [math]::Round($fileInfo.Length / 1KB, 2)
        $TotalSize += $fileInfo.Length

        Write-Host "✓ ($sizeKB KB)" -ForegroundColor Green
        $SuccessCount++
    }
    catch {
        Write-Host "✗ 失败: $_" -ForegroundColor Red
        $FailCount++
    }

    # 添加延迟避免请求过快
    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "下载完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "成功: $SuccessCount 张" -ForegroundColor Green
Write-Host "失败: $FailCount 张" -ForegroundColor $(if ($FailCount -gt 0) { "Red" } else { "Green" })
Write-Host "总大小: $([math]::Round($TotalSize / 1MB, 2)) MB" -ForegroundColor Cyan
Write-Host "保存位置: $($Config.OutputDir)" -ForegroundColor Cyan

# 列出下载的文件
Write-Host ""
Write-Host "📂 下载的文件列表:" -ForegroundColor Yellow
Get-ChildItem $Config.OutputDir -Filter *.jpg | ForEach-Object {
    $size = [math]::Round($_.Length / 1KB, 2)
    Write-Host "  - $($_.Name) ($size KB)"
}
