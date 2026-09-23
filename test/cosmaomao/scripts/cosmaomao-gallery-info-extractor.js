/**
 * COSMaomao gallery pack info extractor.
 * Fields: model name, title, publish time, image count.
 */

const https = require('https');

// Gallery URLs to extract
const galleryUrls = [
  'https://cosmaomao.com/cos-online/371946.html',
  'https://cosmaomao.com/cos-online/487022.html'
];

// Send HTTP request
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// Extract gallery info
function extractGalleryInfo(html, url) {
  // Extract title
  const titleMatch = html.match(/<h1[^>]*>(.+?)<\/h1>/i);
  const h1Title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
  
  // Parse title: model-No.XX – work name [NNp]
  const parsedTitle = h1Title.match(/^(.+?)-No\.(\d+)\s*–\s*(.+?)\s*\[(\d+)P\]$/);
  
  // Extract publish date
  const dateMatch = html.match(/<time[^>]*>(.+?)<\/time>/i) || 
                    html.match(/(\d{4}-\d{2}-\d{2})/);
  const publishDate = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, '').trim() : '';
  
  // Extract view count
  const viewsMatch = html.match(/(\d+\.?\d*K?)\s*次?\s*阅读/) ||
                     html.match(/class=["']views["'][^>]*>(.+?)</i);
  const views = viewsMatch ? viewsMatch[1] : '';
  
  // Extract image count hint text
  const countTextMatch = html.match(/当前作品数量共\s*(\d+)\s*张/);
  const imageCountFromText = countTextMatch ? parseInt(countTextMatch[1]) : null;
  
  // Extract info from the description
  const modelMatch = html.match(/作品模特[：:]\s*([^<\n]+)/);
  const workTitleMatch = html.match(/作品标题[：:]\s*([^<\n]+)/);
  const workNumberMatch = html.match(/作品编号[：:]\s*(\d+)/);
  const workCountMatch = html.match(/图片数量[：:]\s*(\d+)/);
  
  // Post ID
  const postIdMatch = url.match(/(\d+)\.html/);
  
  return {
    // Basic info
    url: url,
    postId: postIdMatch ? postIdMatch[1] : '',
    
    // Title parsing
    title: {
      full: h1Title,
      model: parsedTitle ? parsedTitle[1] : (modelMatch ? modelMatch[1].trim() : ''),
      number: parsedTitle ? parsedTitle[2] : (workNumberMatch ? workNumberMatch[1] : ''),
      name: parsedTitle ? parsedTitle[3] : '',
      imageCount: parsedTitle ? parseInt(parsedTitle[4]) : imageCountFromText
    },
    
    // Metadata
    meta: {
      publishDate: publishDate,
      views: views,
      category: 'COS在线'
    },
    
    // Work details
    details: {
      model: modelMatch ? modelMatch[1].trim() : '',
      workTitle: workTitleMatch ? workTitleMatch[1].trim() : '',
      workNumber: workNumberMatch ? workNumberMatch[1] : '',
      imageCount: workCountMatch ? parseInt(workCountMatch[1]) : imageCountFromText
    }
  };
}

// Main function
async function main() {
  console.log('🚀 COS猫猫图包信息提取器\n');
  
  const results = [];
  
  for (const url of galleryUrls) {
    console.log(`📄 正在分析: ${url}`);
    
    try {
      const html = await fetchHtml(url);
      const info = extractGalleryInfo(html, url);
      results.push(info);
      
      console.log('✅ 提取成功\n');
    } catch (e) {
      console.error(`❌ 提取失败: ${e.message}\n`);
      results.push({ url, error: e.message });
    }
  }
  
  // Print results
  console.log('========================================');
  console.log('提取结果汇总');
  console.log('========================================\n');
  
  results.forEach((result, index) => {
    if (result.error) {
      console.log(`[${index + 1}] ❌ 失败: ${result.error}`);
      return;
    }
    
    console.log(`[${index + 1}] ${result.title.full}`);
    console.log(`    📍 URL: ${result.url}`);
    console.log(`    👤 模特: ${result.title.model}`);
    console.log(`    📝 标题: ${result.title.name}`);
    console.log(`    📅 上架时间: ${result.meta.publishDate}`);
    console.log(`    🖼️  图片数量: ${result.title.imageCount}张`);
    console.log(`    👁️  浏览量: ${result.meta.views}`);
    console.log(`    🆔 Post ID: ${result.postId}`);
    console.log('');
  });
  
  // Save JSON
  const fs = require('fs');
fs.writeFileSync('../data/gallery-info.json', JSON.stringify(results, null, 2));
console.log('✅ 结果已保存: ../data/gallery-info.json');
}

main().catch(console.error);
