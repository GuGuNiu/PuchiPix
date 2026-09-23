/**
 * Coser.io images sitemap analysis.
 * Checks whether it contains image URLs.
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        let body;
        try {
          if (encoding === 'gzip') {
            body = zlib.gunzipSync(buffer).toString('utf-8');
          } else if (encoding === 'deflate') {
            body = zlib.inflateSync(buffer).toString('utf-8');
          } else if (encoding === 'br') {
            body = zlib.brotliDecompressSync(buffer).toString('utf-8');
          } else {
            body = buffer.toString('utf-8');
          }
        } catch (e) {
          body = buffer.toString('utf-8');
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function analyzeImagesSitemap() {
  console.log('=== Images Sitemap 分析 ===\n');

  // Fetch the first images sitemap
  try {
    const res = await request('https://coser.io/sitemap/images.xml');
    console.log(`Status: ${res.statusCode}`);
    console.log(`Content-Type: ${res.headers['content-type']}`);
    console.log(`Size: ${res.body.length} bytes\n`);

    // Save full content
    fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap-images.xml'), res.body);

    // Analyze content
    console.log('前2000字符:');
    console.log(res.body.substring(0, 2000));
    console.log('...\n');

    // Extract all URLs
    const urlMatches = res.body.matchAll(/<loc>([^<]+)<\/loc>/g);
    const urls = [...urlMatches].map(m => m[1]);

    console.log(`总共 ${urls.length} 个URL\n`);

    // Analyze URL types
    const galleryUrls = urls.filter(u => u.includes('/latp/'));
    const imageUrls = urls.filter(u => u.includes('.webp') || u.includes('.jpg') || u.includes('.png'));
    const otherUrls = urls.filter(u => !u.includes('/latp/') && !u.includes('.webp') && !u.includes('.jpg'));

    console.log(`图集页面URL: ${galleryUrls.length} 个`);
    console.log(`直接图片URL: ${imageUrls.length} 个`);
    console.log(`其他URL: ${otherUrls.length} 个`);

    if (galleryUrls.length > 0) {
      console.log('\n图集URL样本:');
      galleryUrls.slice(0, 10).forEach(u => console.log(`  - ${u}`));
    }

    if (imageUrls.length > 0) {
      console.log('\n图片URL样本:');
      imageUrls.slice(0, 10).forEach(u => console.log(`  - ${u}`));
    }

    // Check for the target gallery
    const targetGallery = urls.filter(u => u.includes('69218'));
    if (targetGallery.length > 0) {
      console.log('\n✅ 找到目标图集69218的URL:');
      targetGallery.forEach(u => console.log(`  - ${u}`));
    } else {
      console.log('\n❌ 未在images sitemap中找到目标图集69218');
    }

    // Analyze lastmod times
    const lastmodMatches = res.body.matchAll(/<lastmod>([^<]+)<\/lastmod>/g);
    const lastmods = [...lastmodMatches].map(m => m[1]);
    if (lastmods.length > 0) {
      console.log(`\n最后修改时间范围:`);
      console.log(`  最早: ${lastmods.sort()[0]}`);
      console.log(`  最晚: ${lastmods.sort().reverse()[0]}`);
    }

  } catch (err) {
    console.error('获取images sitemap失败:', err.message);
  }
}

// Check multiple images sitemaps
async function checkMultipleSitemaps() {
  console.log('\n=== 检查多个Images Sitemap ===\n');

  const sitemapUrls = [
    'https://coser.io/sitemap/images.xml',
    'https://coser.io/sitemap/images-2.xml',
    'https://coser.io/sitemap/images-3.xml',
    'https://coser.io/sitemap/images-50.xml',
    'https://coser.io/sitemap/images-100.xml',
  ];

  for (const url of sitemapUrls) {
    try {
      const res = await request(url);
      const urlMatches = res.body.matchAll(/<loc>([^<]+)<\/loc>/g);
      const urls = [...urlMatches].map(m => m[1]);
      const hasTarget = urls.some(u => u.includes('69218'));

      console.log(`${url.split('/').pop()}: ${urls.length} URLs ${hasTarget ? '✅ 包含目标' : ''}`);

      if (hasTarget) {
        const targetUrls = urls.filter(u => u.includes('69218'));
        console.log(`  目标URL: ${targetUrls.join(', ')}`);
      }
    } catch (err) {
      console.log(`${url.split('/').pop()}: 错误 - ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// Analyze main sitemap
async function analyzeMainSitemap() {
  console.log('\n=== Main Sitemap 分析 ===\n');

  try {
    const res = await request('https://coser.io/sitemap/main.xml');
    const urlMatches = res.body.matchAll(/<loc>([^<]+)<\/loc>/g);
    const urls = [...urlMatches].map(m => m[1]);

    console.log(`总共 ${urls.length} 个URL\n`);

    // Check for the target
    const targetUrls = urls.filter(u => u.includes('69218'));
    if (targetUrls.length > 0) {
      console.log('✅ 找到目标图集69218:');
      targetUrls.forEach(u => console.log(`  - ${u}`));
    }

    // Count URL types
    const types = {};
    urls.forEach(u => {
      if (u.includes('/latp/')) types['gallery'] = (types['gallery'] || 0) + 1;
      else if (u.includes('/folder/')) types['folder'] = (types['folder'] || 0) + 1;
      else if (u.includes('/tags/')) types['tag'] = (types['tag'] || 0) + 1;
      else if (u.includes('/detail/')) types['detail'] = (types['detail'] || 0) + 1;
      else types['other'] = (types['other'] || 0) + 1;
    });

    console.log('\nURL类型分布:');
    Object.entries(types).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });

  } catch (err) {
    console.error('获取main sitemap失败:', err.message);
  }
}

// Main function
async function main() {
  await analyzeImagesSitemap();
  await checkMultipleSitemaps();
  await analyzeMainSitemap();

  console.log('\n=== 分析完成 ===');
}

main().catch(console.error);
