/**
 * tutuotaku.com API 测试脚本
 * 用于测试各种AJAX端点和会员功能
 */

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://tutuotaku.com';
const AJAX_URL = 'https://tutuotaku.com/wp-admin/admin-ajax.php';

// 需要登录后获取的cookie
let cookies = '';

/**
 * 获取页面nonce和基本配置
 */
async function getPageConfig() {
  try {
    const response = await axios.get(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = response.data;
    
    // 提取zb对象
    const zbMatch = html.match(/var zb = ({.+?});/s);
    if (zbMatch) {
      const zb = JSON.parse(zbMatch[1]);
      console.log('✅ 获取到zb配置:', {
        ajax_nonce: zb.ajax_nonce,
        current_user_id: zb.current_user_id,
        singular_id: zb.singular_id
      });
      return zb;
    }
  } catch (error) {
    console.error('❌ 获取配置失败:', error.message);
  }
  return null;
}

/**
 * 测试签到功能
 */
async function testQiandao(nonce) {
  try {
    const response = await axios.post(AJAX_URL, 
      new URLSearchParams({
        action: 'zb_user_qiandao',
        nonce: nonce
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': cookies
        }
      }
    );
    
    console.log('签到结果:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ 签到测试失败:', error.message);
    return null;
  }
}

/**
 * 测试获取站点通知
 */
async function testGetNotify(nonce) {
  try {
    const response = await axios.post(AJAX_URL, 
      new URLSearchParams({
        action: 'zb_get_site_notify',
        nonce: nonce
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': cookies
        }
      }
    );
    
    console.log('通知结果:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ 通知测试失败:', error.message);
    return null;
  }
}

/**
 * 测试点赞功能
 */
async function testLikePost(postId, nonce) {
  try {
    const response = await axios.post(AJAX_URL, 
      new URLSearchParams({
        action: 'zb_add_like_post',
        nonce: nonce,
        post_id: postId
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': cookies
        }
      }
    );
    
    console.log('点赞结果:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ 点赞测试失败:', error.message);
    return null;
  }
}

/**
 * 测试收藏功能
 */
async function testFavPost(postId, nonce, isAdd = 1) {
  try {
    const response = await axios.post(AJAX_URL, 
      new URLSearchParams({
        action: 'zb_add_fav_post',
        nonce: nonce,
        post_id: postId,
        is_add: isAdd
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cookie': cookies
        }
      }
    );
    
    console.log('收藏结果:', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ 收藏测试失败:', error.message);
    return null;
  }
}

/**
 * 获取文章下载信息
 */
async function getPostDownloadInfo(postId) {
  try {
    const response = await axios.get(`${BASE_URL}/${postId}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies
      }
    });
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    // 提取下载信息
    const downloadInfo = {
      postId: postId,
      title: $('h1.entry-title').text().trim(),
      hasDownload: $('.ri-down-warp').length > 0,
      isFree: $('.buy-title').text().includes('免费'),
      password: $('.copy-pwd').data('pwd'),
      gotoLinks: $('.ri-down-warp a[href*="goto?down="]').map((i, el) => ({
        text: $(el).text().trim(),
        href: $(el).attr('href')
      })).get()
    };
    
    console.log('下载信息:', downloadInfo);
    return downloadInfo;
  } catch (error) {
    console.error('❌ 获取下载信息失败:', error.message);
    return null;
  }
}

/**
 * 解析下载跳转链接
 */
async function resolveDownloadLink(gotoUrl) {
  try {
    const response = await axios.get(gotoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookies
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 400
    });
    
    console.log('跳转结果:', {
      finalUrl: response.request.res.responseUrl || gotoUrl,
      status: response.status
    });
    
    return response.request.res.responseUrl;
  } catch (error) {
    // 302重定向会被视为错误，但我们可以获取到重定向URL
    if (error.response && error.response.headers.location) {
      console.log('重定向到:', error.response.headers.location);
      return error.response.headers.location;
    }
    console.error('❌ 解析下载链接失败:', error.message);
    return null;
  }
}

/**
 * 主测试函数
 */
async function runTests() {
  console.log('🚀 开始 tutuotaku.com API 测试\n');
  
  // 1. 获取页面配置
  console.log('=== 1. 获取页面配置 ===');
  const config = await getPageConfig();
  
  if (!config) {
    console.log('无法获取配置，停止测试');
    return;
  }
  
  // 2. 测试未登录状态的API
  console.log('\n=== 2. 测试未登录API ===');
  await testGetNotify(config.ajax_nonce);
  
  console.log('\n✅ 基础测试完成');
  console.log('\n注意: 以下测试需要登录Cookie:');
  console.log('- 签到功能');
  console.log('- 点赞/收藏');
  console.log('- 获取下载链接');
}

// 运行测试
runTests().catch(console.error);

module.exports = {
  getPageConfig,
  testQiandao,
  testGetNotify,
  testLikePost,
  testFavPost,
  getPostDownloadInfo,
  resolveDownloadLink
};
