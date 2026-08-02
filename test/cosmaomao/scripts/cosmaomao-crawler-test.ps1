#Requires -Version 7
<#
.SYNOPSIS
    COS猫猫 (cosmaomao.com) 爬虫测试脚本
    目标页面: https://cosmaomao.com/cos-online/487022.html
    测试目标: 提取 "当前作品数量共 55张 ，普通用户免费查看前三张；会员全站免费看：解锁会员权限"

.DESCRIPTION
    使用 Playwright + PowerShell 7 进行网页内容抓取测试
    分析页面结构，验证目标文本的可提取性

.AUTHOR
    PuchiPix Dev Team
.DATE
    2026-08-01
#>

# 设置错误处理
$ErrorActionPreference = "Stop"

# 配置参数
$script:Config = @{
    TargetUrl    = "https://cosmaomao.com/cos-online/487022.html"
    TargetText   = "当前作品数量共"
    OutputDir    = Join-Path (Split-Path $PSScriptRoot -Parent) "data"
    LogFile      = Join-Path (Split-Path $PSScriptRoot -Parent) "data\crawler-test-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
    Timeout      = 30000  # 30秒超时
    Headless     = $true  # 无头模式
}

# 初始化日志
function Write-Log {
    param(
        [Parameter(Mandatory)]
        [string]$Message,

        [ValidateSet("INFO", "WARN", "ERROR", "SUCCESS")]
        [string]$Level = "INFO"
    )

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "[$timestamp] [$Level] $Message"
    Write-Host $logEntry -ForegroundColor $(switch ($Level) {
            "INFO"    { "Cyan" }
            "WARN"    { "Yellow" }
            "ERROR"   { "Red" }
            "SUCCESS" { "Green" }
        })
    Add-Content -Path $script:Config.LogFile -Value $logEntry -Encoding UTF8
}

# 检查 Playwright 模块
function Test-PlaywrightModule {
    Write-Log "检查 Playwright 模块..."

    try {
        $module = Get-Module -ListAvailable -Name "Microsoft.Playwright"
        if (-not $module) {
            Write-Log "Playwright 模块未安装，正在安装..." "WARN"
            Install-Module -Name Microsoft.Playwright -Force -AllowClobber -Scope CurrentUser
        }
        Import-Module Microsoft.Playwright -Force
        Write-Log "Playwright 模块已加载" "SUCCESS"
        return $true
    }
    catch {
        Write-Log "Playwright 模块安装/加载失败: $_" "ERROR"
        return $false
    }
}

# 安装 Playwright 浏览器
function Install-PlaywrightBrowsers {
    Write-Log "检查 Playwright 浏览器..."

    try {
        # 检查 playwright.ps1 脚本
        $playwrightScript = Join-Path (Get-Module Microsoft.Playwright).ModuleBase "playwright.ps1"

        if (Test-Path $playwrightScript) {
            & $playwrightScript install chromium
            Write-Log "Playwright 浏览器已安装/更新" "SUCCESS"
            return $true
        }

        # 备用方案: 使用 npx
        Write-Log "使用 npx 安装 Playwright 浏览器..." "WARN"
        npx playwright install chromium
        return $true
    }
    catch {
        Write-Log "浏览器安装失败: $_" "ERROR"
        return $false
    }
}

# 主爬虫测试函数
function Start-CrawlerTest {
    [CmdletBinding()]
    param()

    Write-Log "========================================"
    Write-Log "COS猫猫爬虫测试开始"
    Write-Log "目标URL: $($script:Config.TargetUrl)"
    Write-Log "========================================"

    $browser = $null
    $context = $null
    $page = $null

    try {
        # 启动浏览器
        Write-Log "正在启动 Chromium 浏览器..."
        $launchOptions = @{
            Headless = $script:Config.Headless
            Timeout  = $script:Config.Timeout
        }

        # 添加用户代理和额外参数以绕过检测
        $launchOptions['Args'] = @(
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--window-size=1920,1080'
        )

        $browser = New-PlaywrightBrowser -BrowserType Chromium -LaunchOptions $launchOptions
        Write-Log "浏览器启动成功" "SUCCESS"

        # 创建浏览器上下文
        $contextOptions = @{
            UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            Viewport  = @{ Width = 1920; Height = 1080 }
            Locale    = 'zh-CN'
        }
        $context = $browser.NewContextAsync($contextOptions).Result
        Write-Log "浏览器上下文创建成功" "SUCCESS"

        # 创建新页面
        $page = $context.NewPageAsync().Result
        Write-Log "新页面创建成功" "SUCCESS"

        # 导航到目标页面
        Write-Log "正在导航到目标页面..."
        $gotoOptions = @{
            WaitUntil = 'networkidle'
            Timeout   = $script:Config.Timeout
        }
        $response = $page.GotoAsync($script:Config.TargetUrl, $gotoOptions).Result
        Write-Log "页面加载完成，状态码: $($response.Status)" "SUCCESS"

        # 等待页面内容加载
        Write-Log "等待页面内容渲染..."
        Start-Sleep -Seconds 3

        # 获取页面标题
        $title = $page.TitleAsync().Result
        Write-Log "页面标题: $title" "INFO"

        # 测试 1: 直接检查目标文本是否存在
        Write-Log "========================================"
        Write-Log "测试 1: 直接文本检测"
        Write-Log "========================================"

        $content = $page.ContentAsync().Result
        $hasTargetText = $content.Contains($script:Config.TargetText)

        if ($hasTargetText) {
            Write-Log "✓ 目标文本存在于页面HTML中" "SUCCESS"
        }
        else {
            Write-Log "✗ 目标文本未找到" "ERROR"
        }

        # 测试 2: 使用 CSS 选择器提取
        Write-Log ""
        Write-Log "========================================"
        Write-Log "测试 2: CSS 选择器提取"
        Write-Log "========================================"

        # 主要选择器: .images-number-tips
        $selectors = @(
            '.images-number-tips',
            'div.images-number-tips',
            '[class*="images-number"]',
            '.entry-desc',
            'div.entry-desc'
        )

        foreach ($selector in $selectors) {
            try {
                $element = $page.QuerySelectorAsync($selector).Result
                if ($element) {
                    $text = $element.TextContentAsync().Result
                    Write-Log "选择器 '$selector' 找到内容:"
                    Write-Log "  内容: $text" "SUCCESS"

                    if ($text -match '(\d+)\s*张') {
                        $imageCount = $Matches[1]
                        Write-Log "  ✓ 提取到图片数量: $imageCount 张" "SUCCESS"
                    }
                }
                else {
                    Write-Log "选择器 '$selector' 未找到元素" "WARN"
                }
            }
            catch {
                Write-Log "选择器 '$selector' 出错: $_" "WARN"
            }
        }

        # 测试 3: 使用 XPath 提取
        Write-Log ""
        Write-Log "========================================"
        Write-Log "测试 3: XPath 提取"
        Write-Log "========================================"

        $xpathExpressions = @(
            "//*[contains(text(), '当前作品数量共')]",
            "//div[contains(@class, 'images-number-tips')]",
            "//div[contains(@class, 'entry-desc')]"
        )

        foreach ($xpath in $xpathExpressions) {
            try {
                $elements = $page.QuerySelectorAllAsync($xpath).Result
                if ($elements -and $elements.Count -gt 0) {
                    Write-Log "XPath '$xpath' 找到 $($elements.Count) 个元素" "SUCCESS"
                    for ($i = 0; $i -lt [Math]::Min(3, $elements.Count); $i++) {
                        $text = $elements[$i].TextContentAsync().Result
                        Write-Log "  [$i] $text"
                    }
                }
                else {
                    Write-Log "XPath '$xpath' 未找到元素" "WARN"
                }
            }
            catch {
                Write-Log "XPath '$xpath' 出错: $_" "WARN"
            }
        }

        # 测试 4: JavaScript 执行提取
        Write-Log ""
        Write-Log "========================================"
        Write-Log "测试 4: JavaScript 执行提取"
        Write-Log "========================================"

        $jsScript = @'
() => {
    // 方法1: 通过类名查找
    const byClass = document.querySelector('.images-number-tips');
    
    // 方法2: 通过文本内容查找
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    const textResults = [];
    let node;
    while (node = walker.nextNode()) {
        if (node.textContent.includes('当前作品数量共')) {
            textResults.push({
                text: node.textContent.trim(),
                parentTag: node.parentElement?.tagName,
                parentClass: node.parentElement?.className
            });
        }
    }
    
    // 方法3: 正则提取图片数量
    const pageText = document.body.innerText;
    const match = pageText.match(/当前作品数量共\s*(\d+)\s*张/);
    const imageCount = match ? match[1] : null;
    
    return {
        byClassText: byClass ? byClass.textContent.trim() : null,
        textResults: textResults.slice(0, 5),
        extractedImageCount: imageCount,
        pageTitle: document.title,
        url: window.location.href
    };
}
'@

        $jsResult = $page.EvaluateAsync($jsScript).Result
        Write-Log "JavaScript 执行结果:"
        Write-Log "  页面标题: $($jsResult.pageTitle)"
        Write-Log "  当前URL: $($jsResult.url)"

        if ($jsResult.byClassText) {
            Write-Log "  ✓ 通过类名提取: $($jsResult.byClassText)" "SUCCESS"
        }

        if ($jsResult.extractedImageCount) {
            Write-Log "  ✓ 提取到图片数量: $($jsResult.extractedImageCount) 张" "SUCCESS"
        }

        Write-Log "  文本查找结果数: $($jsResult.textResults.Count)"
        foreach ($result in $jsResult.textResults | Select-Object -First 3) {
            Write-Log "    - [$($result.parentTag).$($result.parentClass)]: $($result.text.Substring(0, [Math]::Min(80, $result.text.Length)))..."
        }

        # 测试 5: 截图保存
        Write-Log ""
        Write-Log "========================================"
        Write-Log "测试 5: 页面截图"
        Write-Log "========================================"

        $screenshotPath = Join-Path $script:Config.OutputDir "screenshot-$(Get-Date -Format 'yyyyMMdd-HHmmss').png"
        $screenshotOptions = @{
            Path     = $screenshotPath
            FullPage = $true
        }
        $page.ScreenshotAsync($screenshotOptions).Wait()
        Write-Log "✓ 截图已保存: $screenshotPath" "SUCCESS"

        # 生成测试报告
        Write-Log ""
        Write-Log "========================================"
        Write-Log "测试报告生成"
        Write-Log "========================================"

        $report = @{
            TestTime       = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            TargetUrl      = $script:Config.TargetUrl
            PageTitle      = $title
            TargetTextFound = $hasTargetText
            ImageCount     = if ($jsResult.extractedImageCount) { $jsResult.extractedImageCount } else { "未提取到" }
            Selectors      = @{
                Primary   = '.images-number-tips'
                Secondary = '.entry-desc'
            }
            Screenshot     = $screenshotPath
            LogFile        = $script:Config.LogFile
            Conclusion     = if ($hasTargetText -and $jsResult.extractedImageCount) {
                "✓ 爬虫测试成功！目标文本可直接提取，图片数量可解析。"
            }
            else {
                "⚠ 爬虫测试部分成功，可能需要进一步优化选择器。"
            }
        }

        $reportPath = Join-Path $script:Config.OutputDir "report-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
        $report | ConvertTo-Json -Depth 10 | Out-File -FilePath $reportPath -Encoding UTF8
        Write-Log "✓ 测试报告已保存: $reportPath" "SUCCESS"

        Write-Log ""
        Write-Log "========================================"
        Write-Log $report.Conclusion
        Write-Log "========================================"

        return $report
    }
    catch {
        Write-Log "爬虫测试过程中发生错误: $_" "ERROR"
        Write-Log $_.ScriptStackTrace "ERROR"
        throw
    }
    finally {
        # 清理资源
        Write-Log "正在清理资源..."
        if ($page) { $page.CloseAsync().Wait() }
        if ($context) { $context.CloseAsync().Wait() }
        if ($browser) { $browser.CloseAsync().Wait() }
        Write-Log "资源清理完成" "SUCCESS"
    }
}

# 备用方案: 使用原生 .NET HttpClient (静态HTML抓取)
function Test-StaticCrawl {
    Write-Log ""
    Write-Log "========================================"
    Write-Log "备用测试: 静态HTML抓取 (HttpClient)"
    Write-Log "========================================"

    try {
        $httpClient = [System.Net.Http.HttpClient]::new()
        $httpClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        $httpClient.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
        $httpClient.DefaultRequestHeaders.Add("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        $httpClient.Timeout = [TimeSpan]::FromSeconds(30)

        Write-Log "发送HTTP请求..."
        $response = $httpClient.GetAsync($script:Config.TargetUrl).Result
        $html = $response.Content.ReadAsStringAsync().Result

        Write-Log "响应状态: $($response.StatusCode)"
        Write-Log "内容长度: $($html.Length) 字符"

        # 检查目标文本
        $hasText = $html.Contains($script:Config.TargetText)
        Write-Log "目标文本存在于静态HTML中: $hasText" $(if ($hasText) { "SUCCESS" } else { "WARN" })

        # 尝试正则提取
        $regex = [regex]::new('当前作品数量共\s*(\d+)\s*张')
        $match = $regex.Match($html)
        if ($match.Success) {
            Write-Log "✓ 正则提取到图片数量: $($match.Groups[1].Value) 张" "SUCCESS"
        }
        else {
            Write-Log "⚠ 正则未匹配到图片数量" "WARN"
        }

        $httpClient.Dispose()
    }
    catch {
        Write-Log "静态抓取失败: $_" "ERROR"
    }
}

# 主入口
function Main {
    param()

    # 确保输出目录存在
    if (-not (Test-Path $script:Config.OutputDir)) {
        New-Item -ItemType Directory -Path $script:Config.OutputDir -Force | Out-Null
    }

    Write-Log "脚本启动 - PowerShell 版本: $($PSVersionTable.PSVersion)"
    Write-Log "输出目录: $($script:Config.OutputDir)"
    Write-Log "日志文件: $($script:Config.LogFile)"

    # 检查 Playwright
    if (Test-PlaywrightModule) {
        Install-PlaywrightBrowsers | Out-Null

        # 运行主要爬虫测试
        $result = Start-CrawlerTest

        # 也运行静态抓取测试作为对比
        Test-StaticCrawl

        Write-Log ""
        Write-Log "========================================"
        Write-Log "所有测试完成!"
        Write-Log "========================================"

        return $result
    }
    else {
        Write-Log "Playwright 不可用，仅运行静态抓取测试" "WARN"
        Test-StaticCrawl
    }
}

# 执行主函数
Main
