#Requires -Version 7
<#
.SYNOPSIS
    下载COS猫猫图包 371946 (不呆猫-No.062)
#>

$ErrorActionPreference = "Stop"

$Config = @{
    OutputDir = "E:\data\Github\PuchiPix\test\cosmaomao\downloads\cosmaomao-371946-images"
}

# 46张图片URL
$ImageUrls = @(
    "https://cosmaomao.com/wp-content/uploads/2025/07/a4928027b41f4e7.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/f380f697ff10f2d.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/65c985e3665343c.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/69e7f24a2a725f3.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/1a00d299835e738.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/72fd1488d8d3bf5.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/6cbdd8dd9360495.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/7b13930ea3b40e0.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/781d45aeedb58ac.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/6e1c27e9e536da5.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/f4adb410edce2f2.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/c7a37443d2b6ad1.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/2dbd689bc41d092.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/f0a0dbe31a13af1.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/2960e6e3a653a20.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/cfd563da8da5a9c.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/bd323d23dc6701e.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/dcecd9387f0bd82.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/d7d4afe977cb173.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/f0bf9474cb53439.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/58838a01902ecd7.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/fcfb2eecedcc84c.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/23136242d80479d.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/b177f2577e421e6.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/eaa7e8b7350ccab.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/3ffdcb9b412a2b3.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/9859590db91fdd6.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/d437e5bac77850d.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/e15d92445f7b60d.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/ea8217637aa7104.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/eab2f41e5a7f4a8.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/72709f6b191056c.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/1e3006093dc2b79.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/b8b0046f9ee72e8.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/f3b61bd59379e4c.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/56b6710ee1acd67.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/38f9fe2fa54f607.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/2aba988b1310383.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/c300f3454742406.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/34b6ecdbbc59dfd.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/e1235b1c33e8c33.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/e1a95283f534f50.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/78d2533ccc0640b.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/97f79bc3404c462.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/8903c5854e28e20.jpg"
    "https://cosmaomao.com/wp-content/uploads/2025/07/3023e7757e5d2b6.jpg"
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COS猫猫图包下载 - 不呆猫-No.062" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 创建输出目录
if (-not (Test-Path $Config.OutputDir)) {
    New-Item -ItemType Directory -Path $Config.OutputDir -Force | Out-Null
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
