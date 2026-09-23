/**
 * tutuotaku.com API test script.
 * Tests various AJAX endpoints and membership features.
 */

const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://tutuotaku.com';
const AJAX_URL = 'https://tutuotaku.com/wp-admin/admin-ajax.php';

// Cookie obtained after login
let cookies = '';

/**
 * Fetch page nonce and basic config
 */
async function getPageConfig() {
  try {
    const response = await axios.get(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = response.data;
    
    // Extract the zb object
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
 * Test check-in
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
 * Test site notifications
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
 * Test liking
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
 * Test favoriting
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
 * Fetch post download info
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
    
    // Extract download info
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
 * Parse download redirect links
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
    // 302 redirects count as errors, but we can capture the redirect URL
    if (error.response && error.response.headers.location) {
      console.log('重定向到:', error.response.headers.location);
      return error.response.headers.location;
    }
    console.error('❌ 解析下载链接失败:', error.message);
    return null;
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 开始 tutuotaku.com API 测试\n');
  
  // 1. Fetch page config
  console.log('=== 1. 获取页面配置 ===');
  const config = await getPageConfig();
  
  if (!config) {
    console.log('无法获取配置，停止测试');
    return;
  }
  
  // 2. Test APIs while logged out
  console.log('\n=== 2. 测试未登录API ===');
  await testGetNotify(config.ajax_nonce);
  
  console.log('\n✅ 基础测试完成');
  console.log('\n注意: 以下测试需要登录Cookie:');
  console.log('- 签到功能');
  console.log('- 点赞/收藏');
  console.log('- 获取下载链接');
}

// Run tests
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
