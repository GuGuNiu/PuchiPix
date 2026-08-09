/**
 * KanAV 站点数据获取脚本
 * 目标: 获取全站按"最新发布"排序的视频流数据
 * 作者: PuchiPix 逆向分析
 * 日期: 2026-08-03
 */

const axios = require('axios');
const cheerio = require('cheerio');

// 站点配置
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
  requestDelay: 1000, // 请求间隔(ms)
  maxPagesPerCategory: 5 // 每个分类最大页数
};

// 请求头配置
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://v1.kanav.work/'
};

/**
 * 解析视频列表页
 * @param {string} url - 页面URL
 * @returns {Promise<Array>} 视频列表
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
        
        // 提取视频ID
        const href = $link.attr('href') || '';
        const idMatch = href.match(/\/id\/(\d+)\//);
        const videoId = idMatch ? idMatch[1] : null;
        
        // 提取日期
        const titleText = $entryTitle.text() || '';
        const dateMatch = titleText.match(/(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
        const publishDate = dateMatch ? 
          `${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}` : 
          null;
        
        // 解析播放量
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
 * 获取单个分类的视频数据
 * @param {number} categoryId - 分类ID
 * @param {string} sortBy - 排序方式
 * @param {number} maxPages - 最大页数
 * @returns {Promise<Array>} 视频列表
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
    
    // 请求间隔，避免触发反爬
    if (page < maxPages) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
    }
  }
  
  return allVideos;
}

/**
 * 获取全站最新视频（聚合所有分类）
 * @param {number} maxPagesPerCategory - 每个分类最大页数
 * @returns {Promise<Array>} 按时间排序的全站视频
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
    
    // 添加分类信息
    videos.forEach(video => {
      video.categoryId = category.id;
      video.categoryName = category.name;
    });
    
    allVideos.push(...videos);
    
    // 分类间请求间隔
    await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay * 2));
  }
  
  // 去重（按视频ID）
  const uniqueVideos = Array.from(
    new Map(allVideos.map(v => [v.id, v])).values()
  );
  
  // 按发布日期降序排序
  uniqueVideos.sort((a, b) => b.publishTimestamp - a.publishTimestamp);
  
  return uniqueVideos;
}

/**
 * 保存数据到JSON文件
 * @param {Array} videos - 视频列表
 * @param {string} filename - 文件名
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

// 主函数
async function main() {
  console.log('=== KanAV 全站视频数据获取脚本 ===\n');
  
  try {
    // 获取全站最新视频
    const videos = await fetchAllSiteLatestVideos(3);
    
    console.log(`\n=== 获取完成 ===`);
    console.log(`总视频数: ${videos.length}`);
    console.log(`\n前10条最新视频:`);
    videos.slice(0, 10).forEach((v, i) => {
      console.log(`${i + 1}. [${v.publishDate}] ${v.title}`);
      console.log(`   播放量: ${v.viewsText}, 分类: ${v.categoryName}`);
    });
    
    // 保存数据
    saveToJson(videos, 'kanav-latest-videos.json');
    
  } catch (error) {
    console.error('脚本执行失败:', error);
  }
}

// 导出模块
module.exports = {
  CONFIG,
  parseVideoList,
  fetchCategoryVideos,
  fetchAllSiteLatestVideos,
  saveToJson
};

// 直接运行
if (require.main === module) {
  main();
}
