/**
 * Coser.io MCP verification script — phase 2 deep verification.
 * Verifies API endpoints and potential bypass paths found in JS files.
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';
const GALLERY_ID = '69218';

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
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://coser.io/',
        'Origin': 'https://coser.io',
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
          body: body,
          rawBody: buffer
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

// 1. Verify newly found API endpoints from JS files
async function verifyNewAPIEndpoints() {
  console.log('=== 1. 验证JS文件中发现的API端点 ===\n');

  const endpoints = [
    // Endpoints extracted from JS files
    { url: '/web-api/v1/random-models/refresh', method: 'POST' },
    { url: '/web-api/v1/random-tags/refresh', method: 'POST' },
    { url: '/web-api/v1/favorite', method: 'POST', body: JSON.stringify({ galleryId: GALLERY_ID }) },
    { url: '/web-api/v1/user/points', method: 'GET' },
    { url: '/comments/list?id=69218&page=1', method: 'GET' },
    { url: '/comments/send', method: 'POST', body: JSON.stringify({ galleryId: GALLERY_ID, content: 'test' }) },
    { url: '/user/subscription', method: 'POST' },

    // Other possible endpoints
    { url: `/web-api/v1/gallery/${GALLERY_ID}/unlock`, method: 'POST' },
    { url: `/web-api/v1/gallery/${GALLERY_ID}/purchase`, method: 'POST' },
    { url: '/web-api/v1/pay/create', method: 'POST' },
    { url: '/web-api/v1/order/create', method: 'POST' },
  ];

  const results = [];
  for (const endpoint of endpoints) {
    const fullUrl = `https://coser.io${endpoint.url}`;
    try {
      const options = {
        method: endpoint.method,
        timeout: 8000,
        headers: {}
      };

      if (endpoint.body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = endpoint.body;
      }

      const res = await request(fullUrl, options);
      const result = {
        endpoint: endpoint.url,
        method: endpoint.method,
        statusCode: res.statusCode,
        contentType: res.headers['content-type'],
        bodyLength: res.body.length,
        bodyPreview: res.body.substring(0, 300)
      };
      results.push(result);

      if (res.statusCode !== 404) {
        console.log(`${endpoint.method} ${endpoint.url} -> ${res.statusCode}`);
        if (res.statusCode === 200) {
          console.log(`  ✅ 成功`);
          console.log(`  Content-Type: ${res.headers['content-type']}`);
          console.log(`  Body: ${res.body.substring(0, 200)}...\n`);

          // Save response
          const safeName = endpoint.url.replace(/[\/=?&]/g, '_');
          fs.writeFileSync(path.join(OUTPUT_DIR, `verify-api-${safeName}.json`), res.body);
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          console.log(`  🔒 需要权限\n`);
        } else if (res.statusCode === 302 || res.statusCode === 301) {
          console.log(`  🔁 重定向到: ${res.headers.location}\n`);
        }
      } else {
        console.log(`${endpoint.method} ${endpoint.url} -> 404 ❌`);
      }
    } catch (err) {
      results.push({ endpoint: endpoint.url, method: endpoint.method, error: err.message });
      console.log(`${endpoint.method} ${endpoint.url} -> 错误: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 600));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'mcp-verification-api-results.json'), JSON.stringify(results, null, 2));
}

// 2. Verify dynamic page loading behavior
async function verifyDynamicLoading() {
  console.log('\n=== 2. 验证页面动态加载行为 ===\n');

  try {
    const res = await request(`https://coser.io/latp/${GALLERY_ID}.html`);
    const html = res.body;

    // Check for lazy-loading or dynamic-loading markers
    const checks = {
      lazyImages: (html.match(/loading="lazy"/g) || []).length,
      dataSrc: (html.match(/data-src=/g) || []).length,
      dataOriginal: (html.match(/data-original=/g) || []).length,
      alpineInit: html.includes('x-init'),
      fetchCalls: (html.match(/fetch\(/g) || []).length,
      xhrCalls: (html.match(/XMLHttpRequest/g) || []).length,
      websocket: html.includes('WebSocket') || html.includes('ws://') || html.includes('wss://'),
      sse: html.includes('EventSource'),
    };

    console.log('页面动态加载特征:');
    Object.entries(checks).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });

    // Find possible data loading code
    const dataLoadingPatterns = [
      /loadImages[\s\S]{0,500}/,
      /getGalleryData[\s\S]{0,500}/,
      /fetchGallery[\s\S]{0,500}/,
      /loadMore[\s\S]{0,500}/,
    ];

    console.log('\n数据加载代码片段:');
    dataLoadingPatterns.forEach(pattern => {
      const matches = html.match(pattern);
      if (matches) {
        console.log(`  发现: ${matches[0].substring(0, 100)}...`);
      }
    });

    // Check for hidden image data
    const imageDataMatch = html.match(/"images":\s*(\[[^\]]+\])/);
    if (imageDataMatch) {
      console.log('\n⚠️ 发现页面中包含images数组数据!');
      try {
        const images = JSON.parse(imageDataMatch[1]);
        console.log(`  图片数量: ${images.length}`);
        console.log(`  前3张:`, images.slice(0, 3));
      } catch (e) {
        console.log('  解析失败');
      }
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'mcp-verification-dynamic.json'), JSON.stringify(checks, null, 2));

  } catch (err) {
    console.error('动态加载验证失败:', err.message);
  }
}

// 3. Try fetching full gallery detail
async function verifyGalleryDetail() {
  console.log('\n=== 3. 尝试获取完整图集详情 ===\n');

  const detailEndpoints = [
    `/web-api/v1/gallery/${GALLERY_ID}/detail`,
    `/web-api/v1/gallery/${GALLERY_ID}/full`,
    `/web-api/v1/gallery/${GALLERY_ID}/data`,
    `/web-api/v1/gallery/${GALLERY_ID}/content`,
    `/web-api/v1/gallery/${GALLERY_ID}/media`,
    `/web-api/v1/gallery/${GALLERY_ID}/files`,
    `/web-api/v1/gallery/${GALLERY_ID}/images`,

    // With params
    `/web-api/v1/gallery/${GALLERY_ID}?include=images`,
    `/web-api/v1/gallery/${GALLERY_ID}?with=media`,
    `/web-api/v1/gallery/${GALLERY_ID}?expand=files`,
    `/web-api/v1/gallery/${GALLERY_ID}?full=true`,
  ];

  for (const endpoint of detailEndpoints) {
    try {
      const res = await request(`https://coser.io${endpoint}`, { timeout: 8000 });
      console.log(`${endpoint} -> ${res.statusCode}`);

      if (res.statusCode === 200) {
        console.log(`  ✅ 成功! 响应大小: ${res.body.length}`);
        console.log(`  预览: ${res.body.substring(0, 300)}...\n`);

        // Save
        const safeName = endpoint.replace(/[\/=?&]/g, '_');
        fs.writeFileSync(path.join(OUTPUT_DIR, `verify-detail-${safeName}.json`), res.body);

        // Check whether an image list is included
        if (res.body.includes('.webp') || res.body.includes('image')) {
          console.log('  ⚠️ 响应中包含图片相关数据!');
        }
      } else if (res.statusCode === 401) {
        console.log(`  🔒 需要认证\n`);
      } else if (res.statusCode === 403) {
        console.log(`  🚫 禁止访问\n`);
      }
    } catch (err) {
      console.log(`${endpoint} -> 错误: ${err.message}\n`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// 4. Verify login-related endpoints
async function verifyAuthEndpoints() {
  console.log('\n=== 4. 验证登录/认证相关端点 ===\n');

  const authEndpoints = [
    { url: '/login', method: 'GET' },
    { url: '/login.html', method: 'GET' },
    { url: '/web-api/v1/auth/login', method: 'POST', body: JSON.stringify({ email: 'test@test.com', password: 'test' }) },
    { url: '/web-api/v1/auth/register', method: 'POST' },
    { url: '/web-api/v1/auth/check', method: 'GET' },
    { url: '/web-api/v1/auth/status', method: 'GET' },
    { url: '/web-api/v1/user/me', method: 'GET' },
    { url: '/web-api/v1/user/profile', method: 'GET' },
  ];

  for (const endpoint of authEndpoints) {
    try {
      const options = { method: endpoint.method, timeout: 8000 };
      if (endpoint.body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = endpoint.body;
      }

      const res = await request(`https://coser.io${endpoint.url}`, options);
      console.log(`${endpoint.method} ${endpoint.url} -> ${res.statusCode}`);

      if (res.statusCode !== 404) {
        console.log(`  Content-Type: ${res.headers['content-type'] || 'N/A'}`);
        if (res.headers['set-cookie']) {
          console.log(`  Set-Cookie: ${res.headers['set-cookie'].length}个`);
        }
        console.log(`  预览: ${res.body.substring(0, 200)}...\n`);
      }
    } catch (err) {
      console.log(`${endpoint.method} ${endpoint.url} -> 错误: ${err.message}\n`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// 5. Check for a GraphQL endpoint
async function verifyGraphQL() {
  console.log('\n=== 5. 检查GraphQL端点 ===\n');

  const graphqlEndpoints = [
    '/graphql',
    '/api/graphql',
    '/web-api/graphql',
    '/query',
    '/api/query',
  ];

  const query = JSON.stringify({
    query: `{
      gallery(id: "${GALLERY_ID}") {
        id
        title
        images {
          url
          filename
        }
      }
    }`
  });

  for (const endpoint of graphqlEndpoints) {
    try {
      const res = await request(`https://coser.io${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: query,
        timeout: 5000
      });

      console.log(`POST ${endpoint} -> ${res.statusCode}`);
      if (res.statusCode !== 404) {
        console.log(`  响应: ${res.body.substring(0, 200)}...\n`);
      }
    } catch (err) {
      console.log(`POST ${endpoint} -> 错误: ${err.message}\n`);
    }

    await new Promise(r => setTimeout(r, 400));
  }
}

// Main function
async function main() {
  console.log('Coser.io MCP验证 - 第二阶段深度验证\n');
  console.log('=====================================\n');

  await verifyNewAPIEndpoints();
  await verifyDynamicLoading();
  await verifyGalleryDetail();
  await verifyAuthEndpoints();
  await verifyGraphQL();

  console.log('\n=== MCP验证完成 ===');
  console.log(`所有结果保存在: ${OUTPUT_DIR}`);
}

main().catch(console.error);
