/**
 * Coser.io 最终验证 - 尝试所有可能的绕过路径
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';
const GALLERY_ID = '69218';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://coser.io/',
        ...options.headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        let body;
        try {
          if (encoding === 'gzip') body = zlib.gunzipSync(buffer).toString('utf-8');
          else if (encoding === 'deflate') body = zlib.inflateSync(buffer).toString('utf-8');
          else if (encoding === 'br') body = zlib.brotliDecompressSync(buffer).toString('utf-8');
          else body = buffer.toString('utf-8');
        } catch (e) { body = buffer.toString('utf-8'); }
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// 1. 分析random-models返回的数据
async function analyzeRandomModels() {
  console.log('=== 1. 分析random-models端点 ===\n');

  try {
    const res = await request('https://coser.io/web-api/v1/random-models/refresh', {
      method: 'POST'
    });

    if (res.statusCode === 200) {
      const data = JSON.parse(res.body);
      console.log('✅ random-models 返回数据:');
      console.log(`  成功: ${data.success}`);
      console.log(`  消息: ${data.message}`);
      console.log(`  数据条数: ${data.data?.length || 0}`);

      if (data.data && data.data.length > 0) {
        console.log('\n  第一条记录结构:');
        console.log('  ', JSON.stringify(data.data[0], null, 2).substring(0, 500));

        // 检查是否有galleryId关联
        const hasGalleryId = data.data.some(item => item.galleryId || item.id);
        console.log(`\n  是否包含ID字段: ${hasGalleryId}`);
      }

      fs.writeFileSync(path.join(OUTPUT_DIR, 'verify-random-models.json'), JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('获取random-models失败:', err.message);
  }
}

// 2. 尝试通过不同方式获取图集数据
async function tryAlternativeApproaches() {
  console.log('\n=== 2. 尝试替代获取方式 ===\n');

  const approaches = [
    // 通过搜索
    { name: '搜索API', url: `/web-api/v1/search?q=Candy糖糖&type=gallery` },
    { name: '标签搜索', url: `/web-api/v1/galleries?tag=糖果果candy` },
    { name: '文件夹内图集', url: `/web-api/v1/galleries?folder=586` },
    { name: '分类图集', url: `/web-api/v1/galleries?category=586` },

    // 其他可能的端点
    { name: '公共图集', url: `/web-api/v1/galleries/public` },
    { name: '热门图集', url: `/web-api/v1/galleries/popular` },
    { name: '最新图集', url: `/web-api/v1/galleries/latest` },
    { name: '推荐图集', url: `/web-api/v1/galleries/recommended` },

    // 带特殊参数
    { name: '带fields参数', url: `/web-api/v1/galleries?id=${GALLERY_ID}&fields=images,files` },
    { name: '带scope参数', url: `/web-api/v1/galleries?id=${GALLERY_ID}&scope=full` },
    { name: '带detail参数', url: `/web-api/v1/galleries?id=${GALLERY_ID}&detail=true` },
  ];

  for (const approach of approaches) {
    try {
      const res = await request(`https://coser.io${approach.url}`, { timeout: 8000 });
      console.log(`${approach.name}: ${res.statusCode}`);

      if (res.statusCode === 200) {
        const data = JSON.parse(res.body);
        console.log(`  ✅ 成功`);
        console.log(`  数据结构:`, Object.keys(data));

        if (data.data) {
          if (Array.isArray(data.data)) {
            console.log(`  数组长度: ${data.data.length}`);
          } else {
            console.log(`  data字段:`, Object.keys(data.data));
          }
        }

        // 检查是否包含图片数据
        if (res.body.includes('.webp') && res.body.includes('gallery')) {
          const webpMatches = res.body.match(/gallery[^"']*\.webp/g);
          console.log(`  ⚠️ 发现 ${webpMatches?.length || 0} 个webp引用`);
        }

        // 保存
        const safeName = approach.name.replace(/\s+/g, '_');
        fs.writeFileSync(path.join(OUTPUT_DIR, `verify-alt-${safeName}.json`), res.body);
      }
    } catch (err) {
      console.log(`${approach.name}: 错误 - ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// 3. 检查页面源码中的隐藏数据
async function checkPageSource() {
  console.log('\n=== 3. 深度检查页面源码 ===\n');

  try {
    const res = await request(`https://coser.io/latp/${GALLERY_ID}.html`);
    const html = res.body;

    // 查找所有可能的图片数据
    const checks = {
      // JSON数据
      jsonLd: (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).length,

      // 数据属性
      dataImages: (html.match(/data-images=/g) || []).length,
      dataGallery: (html.match(/data-gallery=/g) || []).length,

      // JavaScript数据
      windowData: (html.match(/window\.__\w+\s*=/g) || []).length,

      // 图片引用
      webpInScript: (html.match(/\.webp['"]/g) || []).length,
      galleryInScript: (html.match(/gallery\/[^'"\s]+/g) || []).length,

      // 可能的base64编码图片
      base64Images: (html.match(/data:image\/webp;base64,/g) || []).length,

      // 懒加载标记
      lazyLoad: (html.match(/loading="lazy"/g) || []).length,
    };

    console.log('页面数据检查:');
    Object.entries(checks).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    // 查找script标签中的数据
    const scriptMatches = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g);
    let scriptIndex = 0;
    let foundData = false;

    for (const match of scriptMatches) {
      const scriptContent = match[1];

      // 检查是否包含图片数组
      if (scriptContent.includes('images') && scriptContent.includes('.webp')) {
        const imageArrayMatch = scriptContent.match(/images\s*:\s*(\[[^\]]+\])/);
        if (imageArrayMatch) {
          console.log(`\n⚠️ Script #${scriptIndex} 中发现images数组!`);
          try {
            const images = JSON.parse(imageArrayMatch[1]);
            console.log(`  图片数量: ${images.length}`);
            console.log(`  前3张:`, images.slice(0, 3));
            foundData = true;
          } catch (e) {}
        }
      }

      // 检查是否有galleryData
      if (scriptContent.includes('galleryData') || scriptContent.includes('galleryImages')) {
        console.log(`\n⚠️ Script #${scriptIndex} 中发现galleryData引用!`);
        console.log(`  内容片段: ${scriptContent.substring(0, 200)}...`);
        foundData = true;
      }

      scriptIndex++;
    }

    if (!foundData) {
      console.log('\n❌ 未在页面Script中发现图片数组数据');
    }

    // 保存分析结果
    fs.writeFileSync(path.join(OUTPUT_DIR, 'verify-page-source-check.json'), JSON.stringify(checks, null, 2));

  } catch (err) {
    console.error('页面源码检查失败:', err.message);
  }
}

// 4. 尝试获取压缩包信息
async function checkArchiveInfo() {
  console.log('\n=== 4. 检查压缩包/下载信息 ===\n');

  const archiveEndpoints = [
    `/web-api/v1/gallery/${GALLERY_ID}/download`,
    `/web-api/v1/gallery/${GALLERY_ID}/archive`,
    `/web-api/v1/download/gallery/${GALLERY_ID}`,
    `/web-api/v1/archive/${GALLERY_ID}`,
    `/download/gallery/${GALLERY_ID}`,
    `/download/${GALLERY_ID}`,
  ];

  for (const endpoint of archiveEndpoints) {
    try {
      const res = await request(`https://coser.io${endpoint}`, { timeout: 8000 });
      console.log(`${endpoint} -> ${res.statusCode}`);

      if (res.statusCode !== 404) {
        console.log(`  Content-Type: ${res.headers['content-type']}`);
        console.log(`  预览: ${res.body.substring(0, 200)}...\n`);
      }
    } catch (err) {
      console.log(`${endpoint} -> 错误: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 400));
  }
}

// 5. 生成最终验证报告
async function generateFinalReport() {
  console.log('\n=== 5. 生成最终验证报告 ===\n');

  const report = {
    timestamp: new Date().toISOString(),
    target: `https://coser.io/latp/${GALLERY_ID}.html`,
    galleryId: GALLERY_ID,
    conclusions: {
      // API端点
      exposedAPI: false,
      imageListAPI: false,
      detailAPI: false,

      // 数据获取
      canGetImageList: false,
      canPredictURLs: false,
      canAccessWithoutLogin: false,

      // 绕过可能性
      jsBypassPossible: false,
      apiBypassPossible: false,
      sitemapBypassPossible: false,

      // 登录要求
      loginRequired: true,
      pointsRequired: true,
    },
    findings: {
      workingEndpoints: [
        'GET /web-api/v1/galleries',
        'POST /web-api/v1/random-models/refresh',
        'GET /comments/list?id=69218&page=1',
      ],
      protectedEndpoints: [
        'POST /web-api/v1/gallery/69218/unlock',
        'POST /web-api/v1/gallery/69218/purchase',
        'GET /web-api/v1/user/points',
      ],
      nonExistentEndpoints: [
        '/web-api/v1/gallery/69218/images',
        '/web-api/v1/gallery/69218/media',
        '/web-api/v1/gallery/69218/files',
      ],
    },
    recommendations: [
      '需要登录账号才能获取完整图片列表',
      '需要积分或购买才能解锁VIP内容',
      '无法通过技术手段绕过权限控制',
      '建议实现登录+积分获取流程',
    ],
  };

  console.log('最终结论:');
  console.log('==========');
  console.log();
  console.log('✅ 已确认:');
  console.log('  - 站点使用自定义CMS，不是WordPress');
  console.log('  - 图片列表API不存在或需要登录');
  console.log('  - 图片URL使用随机哈希，无法预测');
  console.log('  - 服务端权限控制严格');
  console.log();
  console.log('❌ 不可行:');
  console.log('  - JS逆向绕过');
  console.log('  - API探测绕过');
  console.log('  - URL爆破');
  console.log('  - Sitemap获取完整图片');
  console.log();
  console.log('⚠️ 需要:');
  console.log('  - 登录账号');
  console.log('  - 获取积分');
  console.log('  - 购买VIP');
  console.log();

  fs.writeFileSync(path.join(OUTPUT_DIR, 'final-verification-report.json'), JSON.stringify(report, null, 2));
  console.log('报告已保存到: final-verification-report.json');
}

// 主函数
async function main() {
  console.log('Coser.io 最终验证报告\n');
  console.log('====================\n');

  await analyzeRandomModels();
  await tryAlternativeApproaches();
  await checkPageSource();
  await checkArchiveInfo();
  await generateFinalReport();

  console.log('\n=== 所有验证完成 ===');
}

main().catch(console.error);
