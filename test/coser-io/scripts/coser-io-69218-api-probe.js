/**
 * Coser.io API深度探测脚本
 * 处理gzip压缩响应，探测更多端点
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';
const GALLERY_ID = '69218';

// 带gzip解压的请求
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
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://coser.io/',
        'Connection': 'keep-alive',
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

        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(options.timeout || 10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// 扩展的API端点列表
const EXTENDED_ENDPOINTS = [
  // 图集相关 - 带参数
  `/web-api/v1/galleries?id=${GALLERY_ID}`,
  `/web-api/v1/galleries?gallery_id=${GALLERY_ID}`,
  `/web-api/v1/galleries?slug=latp/${GALLERY_ID}`,

  // 可能的图片获取端点
  `/web-api/v1/gallery/images?id=${GALLERY_ID}`,
  `/web-api/v1/gallery/images?gallery_id=${GALLERY_ID}`,
  `/web-api/v1/images?gallery_id=${GALLERY_ID}`,
  `/web-api/v1/media?gallery_id=${GALLERY_ID}`,

  // 内容解锁相关
  '/web-api/v1/unlock',
  '/web-api/v1/purchase',
  '/web-api/v1/buy',

  // 用户状态
  '/web-api/v1/user/status',
  '/web-api/v1/user/check',
  '/web-api/v1/auth/check',

  // 其他可能的端点
  '/api/galleries',
  '/api/images',
  '/api/media',
];

async function probeExtended() {
  console.log('=== 扩展API端点探测 ===\n');
  const results = [];

  for (const endpoint of EXTENDED_ENDPOINTS) {
    const url = `https://coser.io${endpoint}`;
    try {
      const res = await request(url, { timeout: 8000 });
      const result = {
        endpoint,
        statusCode: res.statusCode,
        contentType: res.headers['content-type'],
        bodyLength: res.body.length,
        bodyPreview: res.body.substring(0, 300)
      };
      results.push(result);

      if (res.statusCode === 200) {
        console.log(`✅ ${endpoint} -> ${res.statusCode}`);
        console.log(`   Content-Type: ${res.headers['content-type']}`);
        console.log(`   Body: ${res.body.substring(0, 200)}...\n`);

        // 保存响应
        const safeName = endpoint.replace(/[\/=?&]/g, '_');
        fs.writeFileSync(path.join(OUTPUT_DIR, `api-ext-${safeName}.json`), res.body);

        // 尝试解析JSON
        try {
          const json = JSON.parse(res.body);
          console.log(`   JSON解析成功:`, Object.keys(json));
        } catch (e) {
          // 不是JSON
        }
      } else {
        console.log(`❌ ${endpoint} -> ${res.statusCode}`);
      }
    } catch (err) {
      results.push({ endpoint, error: err.message });
      console.log(`⚠️  ${endpoint} -> 错误: ${err.message}`);
    }

    // 延迟
    await new Promise(r => setTimeout(r, 800));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'extended-api-probe.json'), JSON.stringify(results, null, 2));
  console.log('\n=== 探测完成 ===');
}

// 分析已知的galleries端点
async function analyzeGalleriesEndpoint() {
  console.log('\n=== 分析 /web-api/v1/galleries ===\n');

  // 尝试不同的查询参数
  const params = [
    '',
    '?page=1',
    '?limit=100',
    '?per_page=100',
    '?category=586',
    '?folder=586',
    '?tag=性感',
    '?sort=latest',
    '?order=desc',
    `?id=${GALLERY_ID}`,
    `?gallery_id=${GALLERY_ID}`,
    `?slug=latp/${GALLERY_ID}`,
    '?type=image',
    '?format=json'
  ];

  for (const param of params) {
    const url = `https://coser.io/web-api/v1/galleries${param}`;
    try {
      const res = await request(url, { timeout: 10000 });
      console.log(`${param || '(no params)'} -> ${res.statusCode}, length: ${res.body.length}`);

      if (res.statusCode === 200 && res.body.length > 100) {
        const safeName = param.replace(/[\/=?&]/g, '_') || 'default';
        fs.writeFileSync(path.join(OUTPUT_DIR, `galleries-${safeName}.json`), res.body);

        // 尝试解析
        try {
          const json = JSON.parse(res.body);
          console.log(`   数据结构:`, Object.keys(json));
          if (Array.isArray(json)) {
            console.log(`   数组长度: ${json.length}`);
          } else if (json.data && Array.isArray(json.data)) {
            console.log(`   data数组长度: ${json.data.length}`);
          }
        } catch (e) {
          console.log(`   非JSON响应，前200字符: ${res.body.substring(0, 200)}`);
        }
      }
    } catch (err) {
      console.log(`${param} -> 错误: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }
}

// 尝试获取特定图集详情
async function probeGalleryDetail() {
  console.log('\n=== 探测图集详情端点 ===\n');

  const detailEndpoints = [
    `/web-api/v1/gallery/detail?id=${GALLERY_ID}`,
    `/web-api/v1/gallery/info?id=${GALLERY_ID}`,
    `/web-api/v1/gallery/${GALLERY_ID}/detail`,
    `/web-api/v1/gallery/${GALLERY_ID}/info`,
    `/api/gallery/${GALLERY_ID}`,
    `/api/v1/gallery/${GALLERY_ID}`,
    `/api/gallery/detail?id=${GALLERY_ID}`,
  ];

  for (const endpoint of detailEndpoints) {
    const url = `https://coser.io${endpoint}`;
    try {
      const res = await request(url, { timeout: 8000 });
      console.log(`${endpoint} -> ${res.statusCode}`);

      if (res.statusCode === 200) {
        console.log(`   响应长度: ${res.body.length}`);
        console.log(`   预览: ${res.body.substring(0, 300)}...\n`);

        const safeName = endpoint.replace(/[\/=?&]/g, '_');
        fs.writeFileSync(path.join(OUTPUT_DIR, `gallery-detail-${safeName}.json`), res.body);
      }
    } catch (err) {
      console.log(`${endpoint} -> 错误: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 800));
  }
}

// 主函数
async function main() {
  await probeExtended();
  await analyzeGalleriesEndpoint();
  await probeGalleryDetail();
}

main().catch(console.error);
