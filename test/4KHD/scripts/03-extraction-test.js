/**
 * 4KHD — Data extraction verification script.
 * Fetches the target page over HTTP and verifies:
 * 1. Title extraction (protagonist, description, file size, image count)
 * 2. Image URL extraction (all pages)
 * 3. Pagination parsing
 * 4. Download link + extraction code
 * 5. Metadata (publish time, author, JSON-LD)
 * 6. Related recommendations
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RESULT_PATH = path.join(DATA_DIR, 'extraction-result.json');

const TARGET_URL = 'https://qbep.uuss.uk/content/02/island-fish-prince-eugen-bunny-girl.html';
const BASE_URL = 'https://www.4khd.com';
const FRONTEND_URL = 'https://qbep.uuss.uk';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fetch(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      }
    };
    https.get(url, options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

// Simple HTML parser (regex-based, mimics goquery selectors)
function extractImages(html) {
  const images = [];
  // Match <a href="...bunny-girl-4khd.com-NNN.webp"><img src="..."></a>
  // Image URLs contain pic.4khd.com or 4khd.com in the path
  const pattern = /<a\s+href="([^"]*4khd\.com[^"]*\.(?:webp|jpg|png|jpeg)[^"]*)"[^>]*>\s*<img\s+[^>]*?src="([^"]*)"[^>]*>/gi;
  let match;
  let idx = 0;
  while ((match = pattern.exec(html)) !== null) {
    const linkHref = match[1];
    const imgSrc = match[2];
    // Exclude related-recommendation thumbnails (usually 4KHD-beautifulGirls.webp)
    if (imgSrc.includes('4KHD-beautifulGirls') || imgSrc.includes('wp-post-image')) {
      continue;
    }
    if (imgSrc && !images.find(i => i.src === imgSrc)) {
      images.push({
        idx: idx++,
        src: imgSrc,
        href: linkHref,
      });
    }
  }
  return images;
}

function extractGalleryImages(html) {
  // 4KHD images live in <a><img></a> structures inside <p> tags
  // Find the content area before page-link-box first
  const pageBoxIdx = html.indexOf('page-link-box');
  let contentArea = html;
  if (pageBoxIdx > 0) {
    contentArea = html.substring(0, pageBoxIdx);
  }
  
  // Find the part after entry-content within contentArea
  const entryIdx = contentArea.indexOf('entry-content');
  if (entryIdx > 0) {
    contentArea = contentArea.substring(entryIdx);
  }
  
  return extractImages(contentArea);
}

function extractPagination(html) {
  const pageLinks = [];
  const pattern = /<a[^>]*href="([^"]*\.html\/(\d+))"[^>]*>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const url = match[1];
    const pageNum = parseInt(match[2]);
    if (!pageLinks.find(p => p.page === pageNum)) {
      pageLinks.push({ page: pageNum, url });
    }
  }

  // Also check the current page
  const currentMatch = html.match(/<li class="numpages current"><span>(\d+)<\/span>/);
  const currentPage = currentMatch ? parseInt(currentMatch[1]) : 1;

  // Max page number
  const maxPage = pageLinks.length > 0 ? Math.max(...pageLinks.map(p => p.page)) : 1;

  return { currentPage, totalPages: maxPage, pageLinks };
}

function extractDownloadInfo(html) {
  // Extraction code — 4KHD format: <p>Extracting passwords: </p><p>4KHD</p>
  // Match the whole block first
  const passwordBlockMatch = html.match(/Extracting passwords:\s*<\/p>\s*<p[^>]*>(.+?)<\/p>/);
  const password = passwordBlockMatch ? passwordBlockMatch[1].trim() : '';

  // Download link
  const downloadMatch = html.match(/href="(https:\/\/m\.4khd\.com\/[^"]+)"/);
  const downloadURL = downloadMatch ? downloadMatch[1] : '';

  // File size and count (extracted from title)
  const titleMatch = html.match(/<h3[^>]*class="[^"]*wp-block-post-title[^"]*"[^>]*>(.+?)<\/h3>/);
  const fullTitle = titleMatch ? titleMatch[1].trim() : '';

  const sizeMatch = fullTitle.match(/\[(\d+(?:\.\d+)?(?:MB|GB))-(\d+)photos\]/);
  const fileSize = sizeMatch ? sizeMatch[1] : '';
  const photoCount = sizeMatch ? parseInt(sizeMatch[2]) : 0;

  return { password, downloadURL, fileSize, photoCount, fullTitle };
}

function extractMetadata(html) {
  // Title
  const titleMatch = html.match(/<title>(.+?)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Publish time
  const pubMatch = html.match(/<meta property="article:published_time" content="([^"]+)"/);
  const publishTime = pubMatch ? pubMatch[1] : '';

  // Author
  const authorMatch = html.match(/<meta name="author" content="([^"]+)"/);
  const author = authorMatch ? authorMatch[1] : '';

  // Canonical URL
  const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/);
  const canonicalURL = canonicalMatch ? canonicalMatch[1] : '';

  // OpenGraph data
  const ogTypeMatch = html.match(/<meta property="og:type" content="([^"]+)"/);
  const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
  const ogDescMatch = html.match(/<meta property="og:description" content="([^"]+)"/);

  // JSON-LD
  const jsonLdList = [];
  const jsonLdPattern = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdPattern.exec(html)) !== null) {
    try {
      jsonLdList.push(JSON.parse(jsonLdMatch[1].trim()));
    } catch (e) {
      // ignore parse errors
    }
  }

  return {
    title,
    publishTime,
    author,
    canonicalURL,
    ogType: ogTypeMatch ? ogTypeMatch[1] : '',
    ogTitle: ogTitleMatch ? ogTitleMatch[1] : '',
    ogDescription: ogDescMatch ? ogDescMatch[1] : '',
    jsonLd: jsonLdList,
  };
}

function extractRelatedGalleries(html) {
  const related = [];
  const pattern = /<a href="(https:\/\/www\.4khd\.com\/content\/[^"]+)"><img[^>]*src="([^"]*)"[^>]*><p>(.+?)<\/p><\/a>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    related.push({
      url: match[1],
      coverURL: match[2],
      title: match[3].replace(/&#\d+;/g, '').trim(),
    });
  }
  return related;
}

function extractProtagonist(title) {
  // Title format: "<protagonist>  <work name>[258MB-81photos]"
  // Or: "Bunny Ayumi – Polka Dot Bikini(46MB)(15photos)"
  
  // Strip size/count from brackets/parentheses first
  const cleanTitle = title.replace(/\[.+?\]$/, '').replace(/\(.+?\)$/, '').trim();
  
  // Try splitting by spaces
  const parts = cleanTitle.split(/\s{2,}|\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return parts[0].trim();
  }
  
  // If no clear separator, take the first word
  const firstWord = cleanTitle.split(/\s/)[0];
  return firstWord || '';
}

function extractDescription(title, protagonist) {
  let desc = title;
  // Strip the protagonist name
  if (protagonist && desc.startsWith(protagonist)) {
    desc = desc.substring(protagonist.length);
  }
  // Strip bracketed/parenthesized content
  desc = desc.replace(/\[.+?\]$/, '').replace(/\(.+?\)$/, '').trim();
  // Strip leading spaces and hyphens
  desc = desc.replace(/^[\s\-–—]+/, '').trim();
  return desc;
}

function extractCategory(url) {
  const match = url.match(/\/content\/(\d+)\//);
  return match ? match[1] : '';
}

async function main() {
  console.log('=== 4KHD 数据提取验证 ===\n');
  console.log('[1] 抓取首页:', TARGET_URL);

  const firstResponse = await fetch(TARGET_URL);
  console.log('    状态码:', firstResponse.statusCode);
  console.log('    HTML 长度:', firstResponse.body.length);

  const html = firstResponse.body;
  const canonicalURL = extractMetadata(html).canonicalURL || TARGET_URL.replace(FRONTEND_URL, BASE_URL);

  // Extract first-page data
  console.log('\n[2] 提取首页数据...');
  const metadata = extractMetadata(html);
  const downloadInfo = extractDownloadInfo(html);
  const pagination = extractPagination(html);
  const firstPageImages = extractGalleryImages(html);
  const related = extractRelatedGalleries(html);

  console.log('    标题:', metadata.title);
  console.log('    发布时间:', metadata.publishTime);
  console.log('    作者:', metadata.author);
  console.log('    Canonical:', metadata.canonicalURL);
  console.log('    下载链接:', downloadInfo.downloadURL);
  console.log('    提取码:', downloadInfo.password);
  console.log('    文件大小:', downloadInfo.fileSize);
  console.log('    预计图片数:', downloadInfo.photoCount);
  console.log('    当前页:', pagination.currentPage);
  console.log('    总页数:', pagination.totalPages);
  console.log('    首页图片数:', firstPageImages.length);
  console.log('    相关推荐数:', related.length);

  // Extract protagonist and description
  const protagonist = extractProtagonist(downloadInfo.fullTitle);
  const description = extractDescription(downloadInfo.fullTitle, protagonist);
  const category = extractCategory(canonicalURL);
  console.log('    主角:', protagonist);
  console.log('    描述:', description);
  console.log('    分类ID:', category);

  // Fetch remaining pages (use qbep.uuss.uk to avoid www.4khd.com 302 redirects)
  console.log('\n[3] 抓取分页...');
  const allImages = [...firstPageImages];
  const imageUrlSet = new Set(firstPageImages.map(i => i.src));

  for (let page = 2; page <= pagination.totalPages; page++) {
    // Build paginated URLs with the frontend domain
    const pageURL = `${FRONTEND_URL}/content/${category}/${canonicalURL.split('/').pop().split('.')[0]}.html/${page}`;
    console.log(`    [${page}/${pagination.totalPages}] 抓取:`, pageURL);

    const pageResponse = await fetch(pageURL);
    if (pageResponse.statusCode !== 200) {
      console.log(`    [${page}] 状态码 ${pageResponse.statusCode}, 跳过`);
      continue;
    }

    const pageImages = extractGalleryImages(pageResponse.body);
    let newCount = 0;
    for (const img of pageImages) {
      if (!imageUrlSet.has(img.src)) {
        imageUrlSet.add(img.src);
        allImages.push({
          idx: allImages.length,
          src: img.src,
          href: img.href,
          page,
        });
        newCount++;
      }
    }
    console.log(`    [${page}] 图片数: ${pageImages.length}, 新增: ${newCount}`);
  }

  console.log('\n[4] 汇总结果:');
  console.log('    总图片数:', allImages.length);
  console.log('    预计图片数:', downloadInfo.photoCount);
  console.log('    匹配:', allImages.length === downloadInfo.photoCount ? '✅ 一致' : '⚠️ 不一致');

  // Build GalleryScrapeResult
  const result = {
    sourceURL: canonicalURL,
    title: downloadInfo.fullTitle.replace(/\[.+?\]$/, '').replace(/\(.+?\)$/, '').trim(),
    protagonist,
    description,
    category,
    tags: [protagonist, '4KHD', description].filter(Boolean),
    coverURL: allImages.length > 0 ? allImages[0].src : '',
    publishTime: metadata.publishTime.substring(0, 10),
    images: allImages,
    videos: [],
    pageCount: pagination.totalPages,
    imageCount: allImages.length,
    videoCount: 0,
    scrapedDomain: BASE_URL,
    zipInfo: {
      downloadURL: downloadInfo.downloadURL,
      password: downloadInfo.password,
      fileSizeText: downloadInfo.fileSize,
      fileCount: downloadInfo.photoCount,
      provider: 'TeraBox',
    },
    related,
    metadata: {
      author: metadata.author,
      ogType: metadata.ogType,
      ogTitle: metadata.ogTitle,
      ogDescription: metadata.ogDescription,
      jsonLd: metadata.jsonLd,
    },
  };

  // Save results
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf-8');

  // Output image URL list
  const imgListPath = path.join(DATA_DIR, 'all-image-urls.json');
  fs.writeFileSync(imgListPath, JSON.stringify(allImages.map(i => i.src), null, 2), 'utf-8');

  console.log('\n[5] 文件已保存:');
  console.log('    提取结果:', RESULT_PATH);
  console.log('    图片列表:', imgListPath);

  // Verification
  console.log('\n=== 验证报告 ===');
  const checks = [
    { name: '标题非空', pass: result.title.length > 0 },
    { name: '主角提取', pass: result.protagonist.length > 0 },
    { name: '描述提取', pass: result.description.length > 0 },
    { name: '图片数 > 0', pass: result.imageCount > 0 },
    { name: '图片数 = 预期数', pass: result.imageCount === downloadInfo.photoCount },
    { name: '下载链接提取', pass: !!result.zipInfo.downloadURL },
    { name: '提取码提取', pass: !!result.zipInfo.password },
    { name: '发布时间提取', pass: !!result.publishTime },
    { name: 'JSON-LD 解析', pass: result.metadata.jsonLd.length > 0 },
    { name: '相关推荐提取', pass: result.related.length > 0 },
    { name: '多页抓取', pass: result.pageCount > 1 },
  ];

  let passed = 0;
  for (const check of checks) {
    console.log(`  ${check.pass ? '✅' : '❌'} ${check.name}`);
    if (check.pass) passed++;
  }
  console.log(`\n通过: ${passed}/${checks.length}`);

  // Output first 5 image URLs as examples
  console.log('\n前5张图片 URL:');
  for (let i = 0; i < Math.min(5, allImages.length); i++) {
    console.log(`  [${i}] ${allImages[i].src.substring(0, 120)}...`);
  }
  console.log(`  ...`);
  console.log(`  [${allImages.length - 1}] ${allImages[allImages.length - 1].src.substring(0, 120)}...`);

  console.log('\n=== 提取完成 ===');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
