/**
 * Coser.io deep probing script.
 * Analyzes robots.txt, sitemap, and newly found JS files.
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

// 1. Analyze robots.txt
async function analyzeRobots() {
  console.log('=== 1. Robots.txt 分析 ===\n');

  try {
    const res = await request('https://coser.io/robots.txt');
    console.log('robots.txt 内容:');
    console.log(res.body);
    console.log();

    // Parse Disallow paths
    const disallowMatches = res.body.matchAll(/Disallow:\s*(.+)/g);
    const disallowed = [...disallowMatches].map(m => m[1].trim());

    console.log('禁止爬虫访问的路径:');
    disallowed.forEach(p => console.log(`  - ${p}`));
    console.log();

    fs.writeFileSync(path.join(OUTPUT_DIR, 'robots.txt'), res.body);

    return disallowed;
  } catch (err) {
    console.error('获取robots.txt失败:', err.message);
    return [];
  }
}

// 2. Analyze sitemap
async function analyzeSitemap() {
  console.log('=== 2. Sitemap 分析 ===\n');

  try {
    const res = await request('https://coser.io/sitemap.xml');
    console.log('Sitemap前1000字符:');
    console.log(res.body.substring(0, 1000));
    console.log('...\n');

    // Extract all sitemap links
    const sitemapMatches = res.body.matchAll(/<loc>([^<]+)<\/loc>/g);
    const sitemaps = [...sitemapMatches].map(m => m[1]);

    console.log(`发现 ${sitemaps.length} 个sitemap文件:`);
    sitemaps.forEach(s => console.log(`  - ${s}`));
    console.log();

    fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap-index.xml'), res.body);

    // Fetch the first sitemap content
    if (sitemaps.length > 0) {
      const mainSitemap = await request(sitemaps[0]);
      console.log(`主sitemap (${sitemaps[0]}) 大小: ${mainSitemap.body.length} 字节`);

      // Count URLs
      const urlMatches = mainSitemap.body.matchAll(/<url>/g);
      const urlCount = [...urlMatches].length;
      console.log(`包含约 ${urlCount} 个URL`);

      // Sample gallery URLs
      const galleryMatches = mainSitemap.body.matchAll(/<loc>([^<]*\/latp\/[^<]+)<\/loc>/g);
      const galleries = [...galleryMatches].map(m => m[1]).slice(0, 10);
      console.log('\n图集URL样本:');
      galleries.forEach(g => console.log(`  - ${g}`));

      fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap-main.xml'), mainSitemap.body);
    }
  } catch (err) {
    console.error('Sitemap分析失败:', err.message);
  }
}

// 3. Analyze newly found JS files
async function analyzeNewJSFiles() {
  console.log('\n=== 3. 新发现JS文件分析 ===\n');

  const jsFiles = [
    '/js/latp-page.js?v=4.4.4',
    '/js/frontend/global.js?v=4.4.4',
    '/js/frontend/clipboard.js?v=4.4.4',
    '/js/frontend/share-modal.js?v=4.4.4',
    '/js/comment.js?v=4.4.4',
  ];

  for (const jsPath of jsFiles) {
    try {
      const res = await request(`https://coser.io${jsPath}`);
      const content = res.body;

      console.log(`${jsPath}:`);
      console.log(`  大小: ${content.length} 字节`);

      // Save JS file
      const filename = jsPath.replace(/\//g, '_').replace('?v=', '-');
      fs.writeFileSync(path.join(OUTPUT_DIR, `js-${filename}`), content);

      // Analyze content
      const analysis = {
        hasFetch: content.includes('fetch('),
        hasAxios: content.includes('axios'),
        hasAlpine: content.includes('Alpine') || content.includes('alpine'),
        hasEventListeners: content.includes('addEventListener'),
        hasDOM: content.includes('document.') || content.includes('window.'),
        hasAPI: content.match(/['"`]\/(web-api|api)\/[^'"`]+['"`]/g),
        functions: content.match(/function\s+\w+\s*\(/g)?.length || 0,
        arrowFunctions: content.match(/\(\s*\)\s*=>/g)?.length || 0,
      };

      Object.entries(analysis).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          console.log(`  ${key}: ${value.slice(0, 5).join(', ')}${value.length > 5 ? '...' : ''}`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      });

      // Find key code snippets
      if (content.includes('fetch')) {
        const fetchMatches = content.match(/fetch\([^)]+\)[^;]*/g);
        if (fetchMatches) {
          console.log('  Fetch调用:');
          fetchMatches.slice(0, 3).forEach(f => console.log(`    ${f.substring(0, 80)}...`));
        }
      }

      console.log();
    } catch (err) {
      console.log(`${jsPath}: 获取失败 - ${err.message}\n`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// 4. Probe more API endpoints
async function probeMoreAPIs() {
  console.log('=== 4. 扩展API端点探测 ===\n');

  const endpoints = [
    // Found via robots.txt
    '/admin',
    '/pay',
    '/pay/',

    // Possible gallery detail APIs
    '/web-api/v1/gallery/detail',
    '/web-api/v1/gallery/view',
    '/web-api/v1/gallery/content',
    '/web-api/v1/gallery/media',
    '/web-api/v1/gallery/files',

    // With different params
    '/web-api/v1/galleries?include=images',
    '/web-api/v1/galleries?with=media',
    '/web-api/v1/galleries?expand=files',

    // Others
    '/web-api/v2/galleries',
    '/api/v2/galleries',
    '/api/v1/galleries',

    // User related
    '/web-api/v1/auth/login',
    '/web-api/v1/auth/register',
    '/web-api/v1/user/me',
    '/web-api/v1/user/profile',

    // Search
    '/web-api/v1/search',
    '/web-api/v1/search/galleries',

    // Categories
    '/web-api/v1/categories',
    '/web-api/v1/folders',
    '/web-api/v1/tags',

    // Comments
    '/web-api/v1/comments',
    '/web-api/v1/comments?gallery_id=69218',
  ];

  const results = [];
  for (const endpoint of endpoints) {
    try {
      const res = await request(`https://coser.io${endpoint}`, { timeout: 5000 });
      results.push({
        endpoint,
        statusCode: res.statusCode,
        contentType: res.headers['content-type'],
        hasBody: res.body.length > 0 && res.body.length < 10000,
        bodyPreview: res.body.substring(0, 200)
      });

      if (res.statusCode !== 404) {
        console.log(`${endpoint} -> ${res.statusCode}`);
        if (res.statusCode === 200) {
          console.log(`  Content-Type: ${res.headers['content-type']}`);
          console.log(`  Body: ${res.body.substring(0, 300)}...\n`);

          // Save response
          const safeName = endpoint.replace(/[\/=?&]/g, '_');
          fs.writeFileSync(path.join(OUTPUT_DIR, `api-more-${safeName}.json`), res.body);
        }
      }
    } catch (err) {
      results.push({ endpoint, error: err.message });
    }

    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'extended-api-probe-v2.json'), JSON.stringify(results, null, 2));
}

// 5. Analyze data injection in HTML
async function analyzeDataInjection() {
  console.log('\n=== 5. HTML数据注入分析 ===\n');

  try {
    const res = await request('https://coser.io/latp/69218.html');
    const html = res.body;

    // Find all window.__ data
    const windowDataMatches = html.matchAll(/window\.__(\w+)\s*=\s*({[^;]+});/g);
    const windowData = {};

    console.log('Window数据对象:');
    for (const match of windowDataMatches) {
      const name = match[1];
      const jsonStr = match[2];
      try {
        const data = JSON.parse(jsonStr);
        windowData[name] = data;
        console.log(`  __${name}:`, Object.keys(data).join(', '));
      } catch (e) {
        windowData[name] = jsonStr.substring(0, 100);
        console.log(`  __${name}: [无法解析JSON]`);
      }
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'window-data-injection.json'), JSON.stringify(windowData, null, 2));

    // Find JSON data in script tags
    const jsonScriptMatches = html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
    let jsonIndex = 0;
    for (const match of jsonScriptMatches) {
      try {
        const data = JSON.parse(match[1]);
        fs.writeFileSync(path.join(OUTPUT_DIR, `json-script-${jsonIndex++}.json`), JSON.stringify(data, null, 2));
        console.log(`\n发现JSON Script #${jsonIndex}:`, Object.keys(data).join(', '));
      } catch (e) {}
    }

  } catch (err) {
    console.error('数据注入分析失败:', err.message);
  }
}

// Main function
async function main() {
  console.log('Coser.io 深度探测分析\n');
  console.log('=====================\n');

  const disallowed = await analyzeRobots();
  await analyzeSitemap();
  await analyzeNewJSFiles();
  await probeMoreAPIs();
  await analyzeDataInjection();

  console.log('\n=== 深度分析完成 ===');
}

main().catch(console.error);
