/**
 * Coser.io site reverse analysis script.
 * Target: https://coser.io/latp/69218.html
 * Task: analyze the VIP paywall mechanism and try to fetch all 85 images.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const TARGET_URL = 'https://coser.io/latp/69218.html';
const GALLERY_ID = '69218';
const CDN_DOMAIN = 'https://coserbox.static.iloli.io';
const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Logger
const logFile = path.join(OUTPUT_DIR, 'analysis-log.json');
const logs = [];

function log(type, message, data = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    message,
    data
  };
  logs.push(entry);
  console.log(`[${type}] ${message}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

// HTTP request helper
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: data
      }));
    });
    req.on('error', reject);
    req.setTimeout(options.timeout || 10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// API endpoint probe list
const API_ENDPOINTS = [
  // User related
  '/web-api/v1/user/info',
  '/web-api/v1/user/profile',
  '/web-api/v1/user/points',

  // Gallery related
  `/web-api/v1/gallery/${GALLERY_ID}`,
  `/web-api/v1/gallery/${GALLERY_ID}/info`,
  `/web-api/v1/gallery/${GALLERY_ID}/detail`,
  `/web-api/v1/gallery/${GALLERY_ID}/images`,
  `/web-api/v1/gallery/${GALLERY_ID}/media`,
  `/web-api/v1/gallery/${GALLERY_ID}/content`,

  // Generic gallery APIs
  '/web-api/v1/galleries',
  '/web-api/v1/gallery/list',
  '/web-api/v1/images',
  '/web-api/v1/media',

  // Possible other endpoints
  `/api/gallery/${GALLERY_ID}`,
  `/api/v1/gallery/${GALLERY_ID}`,
  `/api/gallery/${GALLERY_ID}/images`,

  // Folder/collection related
  '/web-api/v1/folder/586',
  '/web-api/v1/folder/586/galleries',
];

// Main analysis flow
async function runAnalysis() {
  log('INFO', '开始Coser.io站点逆向分析', { target: TARGET_URL, galleryId: GALLERY_ID });

  // 1. Fetch basic page info
  log('INFO', '步骤1: 获取页面基础信息');
  try {
    const pageRes = await request(TARGET_URL);
    log('INFO', `页面状态: ${pageRes.statusCode}`, { contentLength: pageRes.body.length });

    // Extract key info
    const titleMatch = pageRes.body.match(/<title>(.*?)<\/title>/);
    const configMatch = pageRes.body.match(/window\.__latpConfig = ({.*?});/s);

    if (titleMatch) {
      log('INFO', `页面标题: ${titleMatch[1]}`);
    }

    if (configMatch) {
      try {
        const config = JSON.parse(configMatch[1]);
        log('SUCCESS', '提取到页面配置', config);
        fs.writeFileSync(path.join(OUTPUT_DIR, 'page-config.json'), JSON.stringify(config, null, 2));
      } catch (e) {
        log('ERROR', '解析配置失败', e.message);
      }
    }

    // Extract image URLs
    const imgMatches = pageRes.body.matchAll(/https:\/\/coserbox\.static\.iloli\.io\/gallery\/[^"'\s]+/g);
    const uniqueImages = [...new Set([...imgMatches].map(m => m[0]))];
    log('INFO', `页面中找到 ${uniqueImages.length} 个图片URL`, uniqueImages.slice(0, 5));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'page-images.json'), JSON.stringify(uniqueImages, null, 2));

  } catch (err) {
    log('ERROR', '获取页面失败', err.message);
  }

  // 2. API endpoint probing
  log('INFO', '步骤2: 开始API端点探测');
  const apiResults = [];

  for (const endpoint of API_ENDPOINTS) {
    const url = `https://coser.io${endpoint}`;
    try {
      const res = await request(url, { timeout: 5000 });
      const result = {
        endpoint,
        statusCode: res.statusCode,
        contentType: res.headers['content-type'],
        hasBody: res.body.length > 0,
        bodyPreview: res.body.substring(0, 200)
      };
      apiResults.push(result);

      if (res.statusCode === 200) {
        log('SUCCESS', `API端点 ${endpoint} 返回 200`, result);
        // Save response content
        const safeName = endpoint.replace(/\//g, '_').replace(/^_/, '');
        fs.writeFileSync(path.join(OUTPUT_DIR, `api-${safeName}-response.json`), res.body);
      } else {
        log('INFO', `API端点 ${endpoint} 返回 ${res.statusCode}`);
      }
    } catch (err) {
      apiResults.push({ endpoint, error: err.message });
      log('WARN', `API端点 ${endpoint} 请求失败`, err.message);
    }

    // Delay to avoid triggering rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'api-probe-results.json'), JSON.stringify(apiResults, null, 2));

  // 3. Analyze image URL patterns
  log('INFO', '步骤3: 分析图片URL规律');
  const imagePattern = {
    cdnDomain: 'coserbox.static.iloli.io',
    basePath: '/gallery/2026/07/30/',
    folderHash: '0535b46d1a0d72b1036970bc489c739b',
    filePattern: '[hash16].webp',
    queryParams: ['class=normalvip', 'class=original'],
    observedFiles: [
      '971d16b7a4c8.webp',
      'de25d42733b0.webp'
    ]
  };
  log('INFO', '图片URL结构分析', imagePattern);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'image-pattern-analysis.json'), JSON.stringify(imagePattern, null, 2));

  // 4. Try fetching JS files for analysis
  log('INFO', '步骤4: 获取并分析JS文件');
  try {
    const jsRes = await request('https://coser.io/js/latp.js?v=4.4.4');
    log('INFO', `JS文件大小: ${jsRes.body.length} 字节`);

    // Search for API endpoints
    const apiMatches = jsRes.body.matchAll(/['"`]\/(web-api|api)\/[^'"`]+['"`]/g);
    const foundApis = [...new Set([...apiMatches].map(m => m[0].replace(/['"`]/g, '')))];
    log('INFO', `JS中发现 ${foundApis.length} 个API端点`, foundApis.slice(0, 20));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'js-api-endpoints.json'), JSON.stringify(foundApis, null, 2));

    // Search for image loading related code
    const imageCodeMatches = jsRes.body.match(/(loadImages|getImages|fetchGallery|imageList|galleryData)[^{]*{[^}]*}/g);
    if (imageCodeMatches) {
      log('INFO', '发现图片加载相关代码', imageCodeMatches.slice(0, 3));
    }

  } catch (err) {
    log('ERROR', '获取JS文件失败', err.message);
  }

  // 5. Save full log
  fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
  log('INFO', `分析完成，日志保存至: ${logFile}`);
}

// Run analysis
runAnalysis().catch(err => {
  console.error('分析脚本出错:', err);
  process.exit(1);
});
