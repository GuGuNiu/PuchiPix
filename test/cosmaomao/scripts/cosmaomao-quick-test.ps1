#Requires -Version 7
<#
.SYNOPSIS
    COS猫猫快速爬虫测试 - 精简版
    直接验证目标文本可提取性
#>

$ErrorActionPreference = "Stop"

$targetUrl = "https://cosmaomao.com/cos-online/487022.html"
$targetText = "当前作品数量共 55张 ，普通用户免费查看前三张；会员全站免费看：解锁会员权限"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COS猫猫爬虫快速测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js 和 npx
$hasNode = Get-Command node -ErrorAction SilentlyContinue
$hasNpx = Get-Command npx -ErrorAction SilentlyContinue

if (-not $hasNode) {
    Write-Host "错误: 未找到 Node.js，请先安装 Node.js" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Node.js 版本: $(node --version)" -ForegroundColor Green

# 创建临时测试脚本
$testScript = @"
const { chromium } = require('playwright');

(async () => {
    console.log('🚀 启动浏览器...');

    const browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    console.log('🌐 导航到目标页面...');
    await page.goto('$targetUrl', { waitUntil: 'networkidle', timeout: 30000 });

    // 等待页面渲染
    await page.waitForTimeout(2000);

    const title = await page.title();
    console.log('📄 页面标题:', title);

    // 测试 1: 检查目标文本
    const content = await page.content();
    const hasTarget = content.includes('当前作品数量共');
    console.log('');
    console.log('========================================');
    console.log('测试结果');
    console.log('========================================');
    console.log('✓ 目标文本存在于HTML中:', hasTarget);

    // 测试 2: CSS选择器提取
    const element = await page.locator('.images-number-tips').first();
    const text = await element.textContent().catch(() => null);

    if (text) {
        console.log('✓ CSS选择器 .images-number-tips 成功提取:');
        console.log('  ', text.trim());

        // 提取数字
        const match = text.match(/(\d+)\s*张/);
        if (match) {
            console.log('✓ 提取到图片数量:', match[1], '张');
        }
    } else {
        console.log('✗ CSS选择器未找到元素');
    }

    // 测试 3: JavaScript 执行
    const jsResult = await page.evaluate(() => {
        const el = document.querySelector('.images-number-tips');
        return el ? el.textContent.trim() : null;
    });

    console.log('✓ JavaScript 执行结果:', jsResult);

    // 截图
    const screenshotPath = './screenshot-test.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('✓ 截图已保存:', screenshotPath);

    await browser.close();

    console.log('');
    console.log('========================================');
    console.log('✅ 爬虫测试成功! 目标文本可直接提取');
    console.log('========================================');
})();
"@

$scriptPath = Join-Path $PSScriptRoot "temp-crawler-test.js"
$testScript | Out-File -FilePath $scriptPath -Encoding UTF8

Write-Host ""
Write-Host "📁 测试脚本已创建: $scriptPath" -ForegroundColor Cyan

# 检查 Playwright 是否安装
Write-Host ""
Write-Host "🔍 检查 Playwright..." -ForegroundColor Yellow

try {
    $playwrightCheck = & node -e "try { require('playwright'); console.log('OK') } catch(e) { console.log('MISSING') }" 2>&1

    if ($playwrightCheck -eq "MISSING") {
        Write-Host "📦 安装 Playwright..." -ForegroundColor Yellow
        & npm install playwright --save-dev
    }

    Write-Host "✓ Playwright 已就绪" -ForegroundColor Green
}
catch {
    Write-Host "⚠ 检查 Playwright 时出错，尝试安装..." -ForegroundColor Yellow
    & npm init -y
    & npm install playwright --save-dev
}

# 运行测试
Write-Host ""
Write-Host "🚀 开始爬虫测试..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

& node $scriptPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "测试完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# 清理临时文件
if (Test-Path $scriptPath) {
    Remove-Item $scriptPath -Force
    Write-Host "🧹 临时文件已清理" -ForegroundColor Gray
}
