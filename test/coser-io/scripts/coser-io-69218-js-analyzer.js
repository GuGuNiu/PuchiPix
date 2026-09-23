/**
 * Coser.io JS file analysis and API endpoint extraction.
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';

// Fetch and decompress JS file
function fetchAndDecompress(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://coser.io/'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];

        try {
          let body;
          if (encoding === 'gzip') {
            body = zlib.gunzipSync(buffer).toString('utf-8');
          } else if (encoding === 'deflate') {
            body = zlib.inflateSync(buffer).toString('utf-8');
          } else if (encoding === 'br') {
            body = zlib.brotliDecompressSync(buffer).toString('utf-8');
          } else {
            body = buffer.toString('utf-8');
          }
          resolve(body);
        } catch (e) {
          resolve(buffer.toString('utf-8'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Analyze JS content
function analyzeJS(content) {
  console.log(`JS文件大小: ${content.length} 字节\n`);

  // Save full JS
  fs.writeFileSync(path.join(OUTPUT_DIR, 'latp-decompressed.js'), content);

  // 1. Extract all API endpoints
  const apiPatterns = [
    /['"`](\/web-api\/[^'"`]+)['"`]/g,
    /['"`](\/api\/[^'"`]+)['"`]/g,
    /fetch\(['"`]([^'"`]+)['"`]/g,
    /axios\.[a-z]+\(['"`]([^'"`]+)['"`]/g,
    /url:\s*['"`]([^'"`]+)['"`]/g,
    /endpoint:\s*['"`]([^'"`]+)['"`]/g,
  ];

  const allEndpoints = new Set();
  apiPatterns.forEach(pattern => {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && (match[1].startsWith('/') || match[1].includes('api'))) {
        allEndpoints.add(match[1]);
      }
    }
  });

  console.log(`发现 ${allEndpoints.size} 个API端点:`);
  const endpoints = [...allEndpoints].sort();
  endpoints.forEach(e => console.log(`  - ${e}`));

  // 2. Extract image-related functions
  const imageFunctionPatterns = [
    /function\s+(\w*[Ii]mage\w*)\s*\(/g,
    /function\s+(\w*[Gg]allery\w*)\s*\(/g,
    /function\s+(\w*[Ll]oad\w*)\s*\(/g,
    /function\s+(\w*[Ff]etch\w*)\s*\(/g,
    /function\s+(\w*[Uu]nlock\w*)\s*\(/g,
    /function\s+(\w*[Vv]iew\w*)\s*\(/g,
    /const\s+(\w*[Ii]mage\w*)\s*=/g,
    /const\s+(\w*[Gg]allery\w*)\s*=/g,
    /let\s+(\w*[Ii]mage\w*)\s*=/g,
    /let\s+(\w*[Gg]allery\w*)\s*=/g,
  ];

  const imageFunctions = new Set();
  imageFunctionPatterns.forEach(pattern => {
    const matches = content.matchAll(pattern);
    for (const match of matches) {
      imageFunctions.add(match[1]);
    }
  });

  console.log(`\n发现 ${imageFunctions.size} 个图片/图集相关函数:`);
  [...imageFunctions].sort().slice(0, 30).forEach(f => console.log(`  - ${f}`));

  // 3. Extract key code snippets
  console.log('\n=== 关键代码片段 ===\n');

  // Find image loading related code
  const loadImageMatches = content.match(/[\w$]+\.loadImages[\s\S]{0,500}/g);
  if (loadImageMatches) {
    console.log('loadImages 相关代码:');
    loadImageMatches.slice(0, 2).forEach(m => console.log(m.substring(0, 300)));
  }

  // Find unlock related code
  const unlockMatches = content.match(/[\w$]+\.unlock[\s\S]{0,500}/g);
  if (unlockMatches) {
    console.log('\nunlock 相关代码:');
    unlockMatches.slice(0, 2).forEach(m => console.log(m.substring(0, 300)));
  }

  // Find API call related code
  const apiCallMatches = content.match(/fetch\([\s\S]{0,300}/g);
  if (apiCallMatches) {
    console.log('\nFetch API调用:');
    apiCallMatches.slice(0, 5).forEach(m => console.log(m.substring(0, 200)));
  }

  // 4. Extract URL building patterns
  const urlPatterns = content.match(/https?:\/\/[^\s"'`]+/g);
  if (urlPatterns) {
    const uniqueUrls = [...new Set(urlPatterns)].filter(u =>
      u.includes('coser') || u.includes('iloli') || u.includes('api')
    );
    console.log(`\n发现 ${uniqueUrls.length} 个相关URL模式:`);
    uniqueUrls.slice(0, 20).forEach(u => console.log(`  - ${u}`));
  }

  // Save analysis results
  const analysis = {
    endpoints: endpoints,
    functions: [...imageFunctions],
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'js-analysis.json'), JSON.stringify(analysis, null, 2));

  return analysis;
}

// Try fetching more JS files
async function fetchAdditionalJS() {
  console.log('\n=== 获取其他JS文件 ===\n');

  const jsFiles = [
    'https://coser.io/js/theme.js?v=4.4.4',
    'https://coser.io/js/app.js?v=4.4.4',
    'https://coser.io/js/common.js?v=4.4.4',
    'https://coser.io/js/utils.js?v=4.4.4',
  ];

  for (const url of jsFiles) {
    try {
      const content = await fetchAndDecompress(url);
      console.log(`${url}: ${content.length} 字节`);

      // Find API endpoints
      const apiMatches = content.matchAll(/['"`](\/web-api\/[^'"`]+)['"`]/g);
      const apis = [...new Set([...apiMatches].map(m => m[1]))];
      if (apis.length > 0) {
        console.log(`  发现API端点: ${apis.join(', ')}`);
      }
    } catch (err) {
      console.log(`${url}: 获取失败 - ${err.message}`);
    }
  }
}

// Main function
async function main() {
  console.log('Coser.io JS分析器\n');

  try {
    console.log('正在获取 latp.js...');
    const jsContent = await fetchAndDecompress('https://coser.io/js/latp.js?v=4.4.4');
    analyzeJS(jsContent);
    await fetchAdditionalJS();
  } catch (err) {
    console.error('分析失败:', err.message);
  }
}

main().catch(console.error);
