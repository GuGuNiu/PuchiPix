/**
 * KanAV site data fetching script.
 * Target: fetch the site-wide video feed sorted by "latest published".
 */

const axios = require('axios');
const cheerio = require('cheerio');

// Site config
const CONFIG = {
  baseUrl: 'https://v1.kanav.work',
  categories: [
    { id: 1, name: '中文字幕' },
    { id: 2, name: '日韩有码' },
    { id: 3, name: '日韩无码' },
    { id: 4, name: '国产AV' },
    { id: 22, name: '流出自拍' },
    { id: 20, name: '动漫番剧' }
  ],
  sortTypes: {
    time: '最新发布',
    hits: '最多观看',
    hits_week: '本周热榜'
  },
  requestDelay: 1000, // Request delay (ms)
  maxPagesPerCategory: 5 // Max pages per category
};

// Request headers config
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://v1.kanav.work/'
};

/**
 * Parse a video list page
 * @param {string} url - page URL
 * @returns {Promise<Array>} video list
 */
async function parseVideoList(url) {
  try {
    const response = await axios.get(url, { headers, timeout: 30000 });
    const $ = cheerio.load(response.data);
    
    const videos = [];
    $('.col-md-3.col-sm-6.col-xs-6').each((index, element) => {
      const $el = $(element);
      const $videoItem = $el.find('.video-item');
      const $entryTitle = $el.find('.entry-title');
      
      if ($videoItem.length && $entryTitle.length) {
        const $link = $videoItem.find('a');
        const $img = $videoItem.find('img');
        const $views = $videoItem.find('.model-view-left');
        const $duration = $videoItem.find('.model-view');
        
        // Extract video ID
        const href = $link.attr('href') || '';
        const idMatch = href.match(/\/id\/(\d+)\//);
        const videoId = idMatch ? idMatch[1] : null;
        
        // Extract date
        const titleText = $entryTitle.text() || '';
        const dateMatch = titleText.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
        const publishDate = dateMatch ? 
          `${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}` : 
          null;
        
        // Parse view count
        const viewsText = $views.text().trim();
        const viewsMatch = viewsText.match(/([\d,]+)\s*Views/i);
        const views = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, '')) : 0;
        
        if (videoId) {
          videos.push({
            id: videoId,
            title: $img.attr('alt') || '',
            href: href.startsWith('http') ? href : CONFIG.baseUrl + href,
            thumbnail: $img.attr('src') || $img.attr('data-original') || '',
            views: views,
            viewsText: viewsText,
            duration: $duration.text().trim(),
            publishDate: publishDate,
            publishTimestamp: publishDate ? new Date(publishDate).getTime() : 0
          });
        }
      }
    });
    
    return videos;
  } catch (error) {
    console.error(`解析页面失败: ${url}`, error.message);
    return [];
  }
}

/**
 * Fetch video data for one category
 * @param {number} categoryId - category ID
 * @param {string} sortBy - sort order
 * @param {number} maxPages - max pages
 * @returns {Promise<Array>} video list
 */
async function fetchCategoryVideos(categoryId, sortBy = 'time', maxPages = 5) {
  const allVideos = [];
  
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 
      ? `${CONFIG.baseUrl}/index.php/vod/show/by/${sortBy}/id/${categoryId}.html`
      : `${CONFIG.baseUrl}/index.php/vod/show/by/${sortBy}/id/${categoryId}/page/${page}.html`;
    
    console.log(`正在获取: 分类=${categoryId}, 页码=${page}, URL=${url}`);
    
    const videos = await parseVideoList(url);
    if (videos.length === 0) break;
    
    allVideos.push(...videos);
    
    // Request delay to avoid anti-bot triggers
    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
    }
  }
  
  return allVideos;
}

/**
 * Fetch site-wide latest videos (all categories)
 * @param {number} maxPagesPerCategory - max pages per category
 * @returns {Promise<Array>} site-wide videos sorted by time
 */
async function fetchAllSiteLatestVideos(maxPagesPerCategory = 3) {
  const allVideos = [];
  
  for (const category of CONFIG.categories) {
    console.log(`\n=== 正在获取分类: ${category.name} (ID=${category.id}) ===`);
    
    const videos = await fetchCategoryVideos(
      category.id, 
      'time', 
      maxPagesPerCategory
    );
    
    // Add category info
    videos.forEach(video => {
      video.categoryId = category.id;
      video.categoryName = category.name;
    });
    
    allVideos.push(...videos);
    
    // Delay between categories
    await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay * 2));
  }
  
  // Deduplicate (by video ID)
  const uniqueVideos = Array.from(
    new Map(allVideos.map(v => [v.id, v])).values()
  );
  
  // Sort by publish date descending
  uniqueVideos.sort((a, b) => b.publishTimestamp - a.publishTimestamp);
  
  return uniqueVideos;
}

/**
 * Save data to a JSON file
 * @param {Array} videos - video list
 * @param {string} filename - filename
 */
function saveToJson(videos, filename) {
  const fs = require('fs');
  const data = {
    fetchTime: new Date().toISOString(),
    totalCount: videos.length,
    videos: videos
  };
  fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n数据已保存到: ${filename}`);
}

// Main function
async function main() {
  console.log('=== KanAV 全站视频数据获取脚本 ===\n');
  
  try {
    // Fetch site-wide latest videos
    const videos = await fetchAllSiteLatestVideos(3);
    
    console.log(`\n=== 获取完成 ===`);
    console.log(`总视频数: ${videos.length}`);
    console.log(`\n前10条最新视频:`);
    videos.slice(0, 10).forEach((v, i) => {
      console.log(`${i + 1}. [${v.publishDate}] ${v.title}`);
      console.log(`   播放量: ${v.viewsText}, 分类: ${v.categoryName}`);
    });
    
    // Save data
    saveToJson(videos, 'kanav-latest-videos.json');
    
  } catch (error) {
    console.error('脚本执行失败:', error);
  }
}

// Export module
module.exports = {
  CONFIG,
  parseVideoList,
  fetchCategoryVideos,
  fetchAllSiteLatestVideos,
  saveToJson
};

// Run directly
if (require.main === module) {
  main();
}
