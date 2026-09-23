/**
 * Coser.io image URL extraction and download script.
 * Target: fetch all 85 images.
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data';
const IMAGES_DIR = 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\downloads\\downloaded-images';
const GALLERY_ID = '69218';
const CDN_BASE = 'https://coserbox.static.iloli.io';

// Ensure directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
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

// Download image
function downloadImage(url, filename) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const filepath = path.join(IMAGES_DIR, filename);

    // Skip if file already exists
    if (fs.existsSync(filepath)) {
      console.log(`  跳过已存在: ${filename}`);
      resolve({ skipped: true, filename });
      return;
    }

    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': 'https://coser.io/',
        'Connection': 'keep-alive'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(filepath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        const stats = fs.statSync(filepath);
        resolve({
          filename,
          size: stats.size,
          path: filepath
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
    req.end();
  });
}

// Probe image detail API
async function probeImageDetailAPI() {
  console.log('=== 探测图片详情API ===\n');

  const endpoints = [
    // Possible image list endpoints
    `/web-api/v1/gallery/${GALLERY_ID}/images`,
    `/web-api/v1/gallery/${GALLERY_ID}/media`,
    `/web-api/v1/gallery/${GALLERY_ID}/files`,
    `/web-api/v1/gallery/${GALLERY_ID}/content`,
    `/web-api/v1/images?gallery_id=${GALLERY_ID}`,
    `/web-api/v1/media?gallery_id=${GALLERY_ID}`,
    `/web-api/v1/files?gallery_id=${GALLERY_ID}`,

    // With different params
    `/web-api/v1/gallery/detail?id=${GALLERY_ID}`,
    `/web-api/v1/gallery/detail?id=${GALLERY_ID}&with_images=1`,
    `/web-api/v1/gallery/detail?id=${GALLERY_ID}&include=images`,
    `/web-api/v1/gallery/view?id=${GALLERY_ID}`,
    `/web-api/v1/gallery/content?id=${GALLERY_ID}`,

    // Other possible paths
    `/api/gallery/${GALLERY_ID}/images`,
    `/api/gallery/${GALLERY_ID}/media`,
    `/api/v1/gallery/${GALLERY_ID}/images`,
  ];

  const results = [];
  for (const endpoint of endpoints) {
    const url = `https://coser.io${endpoint}`;
    try {
      const res = await request(url, { timeout: 8000 });
      results.push({
        endpoint,
        statusCode: res.statusCode,
        hasBody: res.body.length > 0,
        bodyPreview: res.body.substring(0, 200)
      });

      if (res.statusCode === 200) {
        console.log(`✅ ${endpoint} -> ${res.statusCode}`);
        console.log(`   预览: ${res.body.substring(0, 300)}...\n`);

        // Save response
        const safeName = endpoint.replace(/[\/=?&]/g, '_');
        fs.writeFileSync(path.join(OUTPUT_DIR, `image-api-${safeName}.json`), res.body);

        // Try parsing JSON
        try {
          const json = JSON.parse(res.body);
          console.log(`   JSON结构:`, Object.keys(json));
          if (json.data) {
            console.log(`   data结构:`, Object.keys(json.data));
          }
        } catch (e) {}
      } else {
        console.log(`❌ ${endpoint} -> ${res.statusCode}`);
      }
    } catch (err) {
      console.log(`⚠️  ${endpoint} -> 错误: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 600));
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'image-api-probe-results.json'), JSON.stringify(results, null, 2));
}

// Try extracting all image URLs from the page HTML
async function extractImagesFromPage() {
  console.log('\n=== 从页面HTML提取图片信息 ===\n');

  try {
    const res = await request(`https://coser.io/latp/${GALLERY_ID}.html`);

    // Find all image URLs
    const imgRegex = /https:\/\/coserbox\.static\.iloli\.io\/gallery\/[^"'\s<>]+/g;
    const matches = res.body.matchAll(imgRegex);
    const uniqueUrls = [...new Set([...matches].map(m => m[0]))];

    console.log(`找到 ${uniqueUrls.length} 个唯一图片URL`);

    // Find images in data attributes
    const dataImgRegex = /data-[a-z-]+="([^"]*gallery[^"]*)"/g;
    const dataMatches = res.body.matchAll(dataImgRegex);
    const dataUrls = [...new Set([...dataMatches].map(m => m[1]))];

    console.log(`找到 ${dataUrls.length} 个data属性图片URL`);

    // Find JSON data
    const jsonMatches = res.body.matchAll(/\{[^}]*"url"[^}]*gallery[^}]*\}/g);
    const jsonData = [...jsonMatches].map(m => {
      try {
        return JSON.parse(m[0]);
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    console.log(`找到 ${jsonData.length} 个JSON图片数据`);

    // Save results
    const result = {
      pageUrls: uniqueUrls,
      dataUrls: dataUrls,
      jsonData: jsonData,
      totalFound: uniqueUrls.length + dataUrls.length + jsonData.length
    };

    fs.writeFileSync(path.join(OUTPUT_DIR, 'extracted-images.json'), JSON.stringify(result, null, 2));

    return result;
  } catch (err) {
    console.error('提取失败:', err.message);
    return { pageUrls: [], dataUrls: [], jsonData: [], totalFound: 0 };
  }
}

// Try generating the image list from URL patterns
async function generateImageUrls() {
  console.log('\n=== 基于URL规律生成图片列表 ===\n');

  // Build from known info
  const baseInfo = {
    folderHash: '0535b46d1a0d72b1036970bc489c739b',
    datePath: '2026/07/30',
    knownFiles: ['971d16b7a4c8', 'de25d42733b0'],
    extension: '.webp',
    cdnDomain: CDN_BASE
  };

  // Analyze known filename patterns
  console.log('已知文件名:');
  baseInfo.knownFiles.forEach(f => {
    console.log(`  - ${f} (长度: ${f.length})`);
  });

  // Note: other filenames cannot be generated directly — they are random hashes
  // Need an API to get the full list

  return baseInfo;
}

// Try fetching via R2 Archive ID
async function tryR2ArchiveAccess() {
  console.log('\n=== 尝试R2 Archive访问 ===\n');

  // From earlier API responses we know r2ArchiveId: 22154
  const r2ArchiveId = 22154;

  const endpoints = [
    `/web-api/v1/archive/${r2ArchiveId}`,
    `/web-api/v1/archive/${r2ArchiveId}/files`,
    `/web-api/v1/r2/${r2ArchiveId}`,
    `/web-api/v1/r2/${r2ArchiveId}/files`,
    `/web-api/v1/download/${r2ArchiveId}`,
  ];

  for (const endpoint of endpoints) {
    const url = `https://coser.io${endpoint}`;
    try {
      const res = await request(url, { timeout: 8000 });
      console.log(`${endpoint} -> ${res.statusCode}`);

      if (res.statusCode === 200) {
        console.log(`   响应: ${res.body.substring(0, 300)}...\n`);
        const safeName = endpoint.replace(/[\/=?&]/g, '_');
        fs.writeFileSync(path.join(OUTPUT_DIR, `r2-${safeName}.json`), res.body);
      }
    } catch (err) {
      console.log(`${endpoint} -> 错误: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 600));
  }
}

// Main function
async function main() {
  console.log('Coser.io 图片提取器');
  console.log('====================\n');

  await probeImageDetailAPI();
  await extractImagesFromPage();
  await generateImageUrls();
  await tryR2ArchiveAccess();

  console.log('\n=== 分析完成 ===');
  console.log(`所有结果保存在: ${OUTPUT_DIR}`);
}

main().catch(console.error);
