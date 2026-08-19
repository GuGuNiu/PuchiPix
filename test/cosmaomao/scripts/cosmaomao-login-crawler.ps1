#Requires -Version 7
<#
.SYNOPSIS
    COS猫猫登录后爬取脚本
    说明：需要有效的 VIP/永久会员账号才能爬取全部55张图片

.DESCRIPTION
    使用 Playwright 模拟登录，然后爬取完整图片列表
    仅前3张可免费获取，其余52张需要登录权限

.NOTES
    需要安装 Playwright: npm install playwright
    需要 Chromium 浏览器: npx playwright install chromium
#>

$ErrorActionPreference = "Stop"

# 配置
$Config = @{
    TargetUrl    = "https://cosmaomao.com/cos-online/487022.html"
    LoginUrl     = "https://cosmaomao.com/login"
    Username     = ""  # 填写你的账号
    Password     = ""  # 填写你的密码
    OutputDir    = Join-Path (Split-Path $PSScriptRoot -Parent) "data"
    Headless     = $false  # 设置为 $true 可无头运行，但首次建议 $false 以便观察
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COS猫猫登录爬取脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查配置
if ([string]::IsNullOrEmpty($Config.Username) -or [string]::IsNullOrEmpty($Config.Password)) {
    Write-Host "错误: 请先填写账号和密码" -ForegroundColor Red
    Write-Host "编辑脚本中的 `$Config.Username 和 `$Config.Password" -ForegroundColor Yellow
    exit 1
}

# 创建 Node.js 脚本
$nodeScript = @"
const { chromium } = require('playwright');

(async () => {
    console.log('🚀 启动浏览器...');

    const browser = await chromium.launch({
        headless: $($Config.Headless.ToString().ToLower()),
        args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    // 1. 访问登录页面
    console.log('🔐 访问登录页面...');
    await page.goto('$($Config.LoginUrl)', { waitUntil: 'networkidle' });

    // 2. 填写登录表单
    console.log('📝 填写登录信息...');

    // 尝试多种可能的表单字段名
    try {
        await page.fill('input[name="username"], input[name="log"], input[type="text"]', '$($Config.Username)');
        await page.fill('input[name="password"], input[name="pwd"], input[type="password"]', '$($Config.Password)');
    } catch (e) {
        console.log('⚠️ 无法自动填写表单，请手动登录');
        console.log('等待60秒...');
        await page.waitForTimeout(60000);
    }

    // 3. 点击登录按钮
    try {
        await Promise.any([
            page.click('button[type="submit"], input[type="submit"], .login-btn'),
            page.waitForTimeout(5000)
        ]);
    } catch (e) {
        console.log('请手动点击登录按钮...');
        await page.waitForTimeout(10000);
    }

    // 4. 等待登录完成
    console.log('⏳ 等待登录完成...');
    await page.waitForTimeout(5000);

    // 检查是否登录成功
    const currentUrl = page.url();
    console.log('📍 当前页面:', currentUrl);

    if (currentUrl.includes('login')) {
        console.log('⚠️ 可能登录失败，请检查账号密码');
        console.log('按任意键继续...');
        await page.waitForTimeout(30000);
    }

    // 5. 访问目标页面
    console.log('🌐 访问目标页面...');
    await page.goto('$($Config.TargetUrl)', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 6. 提取图片
    console.log('📸 提取图片...');

    const result = await page.evaluate(() => {
        // 获取所有图片
        const allImages = Array.from(document.querySelectorAll('img'));

        // 筛选内容图片
        const contentImages = allImages.filter(img => {
            const src = img.src || img.dataset.lazySrc || '';
            return src.includes('wp-content/uploads') &&
                   !src.includes('logo') &&
                   !src.includes('favicon') &&
                   !src.includes('Sidebar') &&
                   !src.includes('Customer');
        });

        // 提取URL
        const imageUrls = contentImages.map(img => ({
            src: img.src || img.dataset.lazySrc,
            alt: img.alt,
            width: img.naturalWidth,
            height: img.naturalHeight
        }));

        // 获取页面信息
        const title = document.title;
        const imageCountText = document.querySelector('.images-number-tips')?.textContent || '';

        return {
            title: title,
            imageCountText: imageCountText,
            totalImages: contentImages.length,
            images: imageUrls
        };
    });

    console.log('');
    console.log('========================================');
    console.log('爬取结果');
    console.log('========================================');
    console.log('页面标题:', result.title);
    console.log('图片数量:', result.imageCountText);
    console.log('找到图片:', result.totalImages, '张');
    console.log('');

    if (result.totalImages > 0) {
        console.log('图片列表:');
        result.images.forEach((img, idx) => {
            console.log(`\${idx + 1}. \${img.src}`);
        });

        // 保存到文件
        const fs = require('fs');
        const output = {
            url: '$($Config.TargetUrl)',
            title: result.title,
            imageCount: result.totalImages,
            images: result.images.map(img => img.src),
            timestamp: new Date().toISOString()
        };

        fs.writeFileSync('./cosmaomao-images.json', JSON.stringify(output, null, 2));
        console.log('');
        console.log('✅ 结果已保存到 cosmaomao-images.json');

        // 也保存为纯URL列表
        const urlList = result.images.map(img => img.src).join('\n');
        fs.writeFileSync('./cosmaomao-image-urls.txt', urlList);
        console.log('✅ URL列表已保存到 cosmaomao-image-urls.txt');
    } else {
        console.log('❌ 未找到图片，可能需要检查登录状态');
    }

    // 截图
    await page.screenshot({ path: './cosmaomao-result.png', fullPage: true });
    console.log('✅ 截图已保存到 cosmaomao-result.png');

    await browser.close();

    console.log('');
    console.log('========================================');
    console.log('爬取完成!');
    console.log('========================================');
})();
"@

$scriptPath = Join-Path $PSScriptRoot "temp-login-crawler.js"
$nodeScript | Out-File -FilePath $scriptPath -Encoding UTF8

Write-Host "📁 临时脚本已创建: $scriptPath" -ForegroundColor Cyan
Write-Host ""

# 检查 Playwright
Write-Host "🔍 检查 Playwright..." -ForegroundColor Yellow

try {
    & node -e "require('playwright')" 2>$null
    Write-Host "✓ Playwright 已安装" -ForegroundColor Green
}
catch {
    Write-Host "📦 安装 Playwright..." -ForegroundColor Yellow
    & npm install playwright
}

# 运行脚本
Write-Host ""
Write-Host "🚀 开始爬取..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

& node $scriptPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "脚本执行完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# 清理
if (Test-Path $scriptPath) {
    Remove-Item $scriptPath -Force
    Write-Host "🧹 临时文件已清理" -ForegroundColor Gray
}

# 显示结果
if (Test-Path "./cosmaomao-images.json") {
    Write-Host ""
    Write-Host "📄 生成的文件:" -ForegroundColor Cyan
    Get-ChildItem "./cosmaomao-*" | ForEach-Object {
        Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1KB, 2)) KB)"
    }
}
