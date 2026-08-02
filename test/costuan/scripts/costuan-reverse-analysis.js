/**
 * COS团 (costuan.com) WordPress 逆向分析脚本
 * 
 * 目标: https://www.costuan.com/1042.html
 * 主题: B2 Theme
 * 
 * 分析结果:
 * - 站点使用 WordPress + B2 主题
 * - 下载链接通过 REST API: /wp-json/b2/v1/getDownloadPageData 获取
 * - 百度网盘链接隐藏在 API 响应的 button[0].url 字段中
 * - 需要登录并有权限才能获取实际下载链接
 * - 提取码通过正则匹配获取: code:hove
 * 
 * 使用说明:
 * 1. 无登录: 只能获取帖子元数据，无法获取百度网盘链接
 * 2. 有登录: 需要提供 JWT Token 或 Cookie
 */

const https = require('https');
const http = require('http');

// 配置
const CONFIG = {
  baseUrl: 'https://www.costuan.com',
  postId: 1042,
  // 如果需要登录，请提供以下信息
  authToken: process.env.COSTUAN_TOKEN || null,
  cookies: process.env.COSTUAN_COOKIES || null,
};

/**
 * Phase 1: 站点指纹识别
 */
async function fingerprint() {
  console.log('=== Phase 1: 站点指纹识别 ===\n');
  
  const result = {
    isWordPress: false,
    theme: null,
    restApiAvailable: false,
    namespaces: [],
    server: null,
  };
  
  try {
    // 获取 API 根目录
    const apiRoot = await makeRequest('/wp-json/', 'GET');
    
    if (apiRoot && apiRoot.namespaces) {
      result.isWordPress = true;
      result.namespaces = apiRoot.namespaces;
      result.restApiAvailable = true;
      console.log(`✅ WordPress 确认`);
      console.log(`   API 命名空间: ${apiRoot.namespaces.join(', ')}`);
      
      // 检测 B2 主题
      if (apiRoot.namespaces.includes('b2/v1')) {
        result.theme = 'B2';
        console.log(`✅ 主题识别: B2 Theme`);
      }
    }
  } catch (err) {
    console.log(`❌ API 检测失败: ${err.message}`);
  }
  
  return result;
}

/**
 * Phase 2: 获取帖子元数据
 */
async function getPostMeta(postId) {
  console.log(`\n=== Phase 2: 获取帖子 ${postId} 元数据 ===\n`);
  
  try {
    const post = await makeRequest(`/wp-json/wp/v2/posts/${postId}?_embed`, 'GET');
    
    if (post) {
      console.log(`✅ 帖子信息获取成功`);
      console.log(`   标题: ${post.title?.rendered || 'N/A'}`);
      console.log(`   链接: ${post.link || 'N/A'}`);
      console.log(`   作者: ${post.author || 'N/A'}`);
      console.log(`   分类: ${post.categories?.join(', ') || 'N/A'}`);
      
      // 检查元数据
      if (post.meta) {
        console.log(`   元数据:`, JSON.stringify(post.meta, null, 2));
      }
      
      return {
        id: post.id,
        title: post.title?.rendered,
        link: post.link,
        meta: post.meta,
        content: post.content?.rendered?.substring(0, 500),
      };
    }
  } catch (err) {
    console.log(`❌ 获取失败: ${err.message}`);
  }
  
  return null;
}

/**
 * Phase 3: 调用 B2 主题下载 API
 */
async function getDownloadData(postId, index = 0, i = 0) {
  console.log('\n=== Phase 3: 调用 B2 下载 API ===\n');
  
  const params = `post_id=${postId}&index=${index}&i=${i}&guest=`;
  
  try {
    const data = await makeRequest('/wp-json/b2/v1/getDownloadPageData', 'POST', params);
    
    if (data) {
      console.log(`✅ API 调用成功`);
      
      if (data.button && data.button.length > 0) {
        const btn = data.button[0];
        console.log(`   按钮名称: ${btn.name}`);
        console.log(`   下载链接: ${btn.link || 'N/A'}`);
        console.log(`   直接URL: ${btn.url || '(空 - 需要权限)'}`);
        console.log(`   属性:`, JSON.stringify(btn.attr, null, 2));
      }
      
      if (data.current_user) {
        const user = data.current_user;
        console.log(`   当前用户等级: ${user.lv?.lv?.name || 'N/A'}`);
        console.log(`   下载权限: ${user.can?.allow ? '✅ 允许' : '❌ 禁止'}`);
        console.log(`   权限类型: ${user.can?.type || 'N/A'}`);
        
        if (user.can?.type === 'credit') {
          console.log(`   所需积分: ${user.can?.value || 'N/A'}`);
        } else if (user.can?.type === 'money') {
          console.log(`   所需金额: ¥${user.can?.value || 'N/A'}`);
        }
      }
      
      // 关键: 检查是否有直接的百度网盘链接
      const baiduLink = extractBaiduLink(data);
      if (baiduLink) {
        console.log(`\n🎉 发现百度网盘链接: ${baiduLink}`);
      } else {
        console.log(`\n⚠️ 未发现百度网盘链接（需要登录或付费）`);
      }
      
      return data;
    }
  } catch (err) {
    console.log(`❌ API 调用失败: ${err.message}`);
  }
  
  return null;
}

/**
 * 提取百度网盘链接
 */
function extractBaiduLink(data) {
  const baiduPattern = /https?:\/\/pan\.baidu\.com\/s\/[a-zA-Z0-9_\-]+/;
  
  // 检查按钮 URL
  if (data.button) {
    for (const btn of data.button) {
      if (btn.url && baiduPattern.test(btn.url)) {
        return btn.url;
      }
      if (btn.link && baiduPattern.test(btn.link)) {
        return btn.link;
      }
    }
  }
  
  // 检查整个响应
  const jsonStr = JSON.stringify(data);
  const match = jsonStr.match(baiduPattern);
  return match ? match[0] : null;
}

/**
 * Phase 4: 分析 REST API 端点
 */
async function enumerateEndpoints() {
  console.log(`\n=== Phase 4: REST API 端点枚举 ===\n`);
  
  try {
    const apiRoot = await makeRequest('/wp-json/', 'GET');
    
    if (apiRoot?.routes) {
      const routes = apiRoot.routes;
      const downloadRoutes = Object.keys(routes).filter(r => 
        r.toLowerCase().includes('download') || 
        r.toLowerCase().includes('post') ||
        r.toLowerCase().includes('media')
      );
      
      console.log(`发现 ${Object.keys(routes).length} 个路由`);
      console.log(`\n下载相关路由:`);
      downloadRoutes.forEach(route => {
        const methods = routes[route]?.endpoints?.map(e => e.methods).flat();
        console.log(`   ${route} [${methods?.join(', ') || 'N/A'}]`);
      });
      
      return routes;
    }
  } catch (err) {
    console.log(`❌ 枚举失败: ${err.message}`);
  }
  
  return null;
}

/**
 * Phase 5: 尝试获取帖子图片
 */
async function getPostImages(postId) {
  console.log(`\n=== Phase 5: 获取帖子图片 ===\n`);
  
  try {
    const media = await makeRequest(`/wp-json/wp/v2/media?parent=${postId}&per_page=100`, 'GET');
    
    if (media && Array.isArray(media)) {
      console.log(`✅ 找到 ${media.length} 个媒体文件`);
      media.slice(0, 5).forEach((m, i) => {
        console.log(`   [${i+1}] ${m.source_url || m.link || 'N/A'}`);
      });
      return media;
    }
  } catch (err) {
    console.log(`❌ 获取失败: ${err.message}`);
  }
  
  return [];
}

/**
 * HTTP 请求辅助函数
 */
function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CONFIG.baseUrl);
    const client = url.protocol === 'https:' ? https : http;
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Origin': CONFIG.baseUrl,
      'Referer': CONFIG.baseUrl + '/',
    };
    
    if (CONFIG.authToken) {
      headers['Authorization'] = 'Bearer ' + CONFIG.authToken;
    }
    
    if (CONFIG.cookies) {
      headers['Cookie'] = CONFIG.cookies;
    }
    
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: headers,
      rejectUnauthorized: false,
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, CONFIG.baseUrl).toString();
        console.log(`   重定向: ${redirectUrl}`);
        makeRequest(new URL(redirectUrl).pathname, method, body)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            resolve(JSON.parse(data) || { error: `HTTP ${res.statusCode}` });
          }
        } catch (e) {
          resolve(data || null);
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(body);
    }
    
    req.end();
  });
}

/**
 * 主分析流程
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   COS团 (costuan.com) WordPress 逆向分析               ║');
  console.log('║   目标: /1042.html - 水淼aqua COS写真                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  const results = {
    timestamp: new Date().toISOString(),
    target: `${CONFIG.baseUrl}/1042.html`,
    phases: {},
  };
  
  // Phase 1: 指纹识别
  results.phases.fingerprint = await fingerprint();
  
  // Phase 2: 获取帖子元数据
  results.phases.postMeta = await getPostMeta(CONFIG.postId);
  
  // Phase 3: 调用下载 API
  results.phases.downloadData = await getDownloadData(CONFIG.postId);
  
  // Phase 4: 枚举 API 端点
  results.phases.endpoints = await enumerateEndpoints();
  
  // Phase 5: 获取帖子图片
  results.phases.images = await getPostImages(CONFIG.postId);
  
  // 最终报告
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   分析总结                                              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  
  console.log(`📊 站点信息:`);
  console.log(`   - WordPress: ${results.phases.fingerprint?.isWordPress ? '✅' : '❌'}`);
  console.log(`   - 主题: ${results.phases.fingerprint?.theme || '未知'}`);
  console.log(`   - REST API: ${results.phases.fingerprint?.restApiAvailable ? '✅' : '❌'}`);
  
  console.log(`\n📥 下载机制分析:`);
  console.log(`   - 下载端点: /wp-json/b2/v1/getDownloadPageData`);
  console.log(`   - 网盘类型: 百度网盘 (从页面获取)`);
  console.log(`   - 提取码: code:hove (从页面源码正则匹配)`);
  console.log(`   - 认证方式: JWT Bearer Token 或 Cookie`);
  
  const downloadData = results.phases.downloadData;
  if (downloadData) {
    const hasDirectUrl = downloadData.button?.[0]?.url;
    console.log(`   - 直接下载链接: ${hasDirectUrl ? '✅ 已获取' : '❌ 需要权限'}`);
    
    if (!hasDirectUrl && downloadData.current_user) {
      console.log(`   - 用户等级: ${downloadData.current_user.lv?.lv?.name || 'N/A'}`);
      console.log(`   - 权限类型: ${downloadData.current_user.can?.type || 'N/A'}`);
    }
  }
  
  console.log(`\n🔧 后续操作建议:`);
  console.log(`   1. 注册账号并登录获取 JWT Token`);
  console.log(`   2. 设置环境变量 COSTUAN_TOKEN 后重新运行脚本`);
  console.log(`   3. 积分/付费下载需要用户有足够的积分或余额`);
  
  // 保存结果到文件
  const fs = require('fs');
  const resultFile = `${__dirname}/costuan-analysis-result.json`;
  fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 分析结果已保存到: ${resultFile}`);
  
  return results;
}

// 运行分析
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  fingerprint,
  getPostMeta,
  getDownloadData,
  extractBaiduLink,
  enumerateEndpoints,
  getPostImages,
  main,
};
