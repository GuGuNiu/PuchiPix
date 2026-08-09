// tutuotaku.com goto bypass test v2 - with detailed cookie debugging
const https = require('https');
const http = require('http');
const url = require('url');

let cookies = {};

function getCookieStr() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function req(opts) {
  return new Promise((resolve, reject) => {
    const p = url.parse(opts.url);
    const r = (p.protocol === 'https:' ? https : http).request({
      hostname: p.hostname, port: p.port, path: p.path,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 Chrome/123',
        'Cookie': getCookieStr(),
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(opts.headers || {})
      },
      rejectUnauthorized: false
    }, (res) => {
      // Parse Set-Cookie
      (res.headers['set-cookie'] || []).forEach(h => {
        const parts = h.split(';')[0].trim().split('=');
        if (parts.length >= 2) cookies[parts[0]] = parts.slice(1).join('=');
      });
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body,
        cookies: {...cookies}
      }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function main() {
  console.log('=== tutuotaku goto bypass v2 ===\n');

  // Step 1: Visit home page to get initial cookies
  console.log('Step 1: 访问首页获取初始 Cookie...');
  const r1 = await req({ url: 'https://tutuotaku.com/' });
  console.log(`  Cookies: ${Object.keys(cookies).join(', ')}`);
  
  // Extract nonce
  const nonceMatch = r1.body.match(/"ajax_nonce":"([a-f0-9]+)"/);
  const nonce = nonceMatch?.[1] || '';
  console.log(`  nonce: ${nonce}`);

  // Step 2: Login via AJAX
  console.log('\nStep 2: AJAX 登录...');
  const loginBody = `action=zb_user_login&user_name=${encodeURIComponent('TLpA9fLLzy@duckmail.sbs')}&user_password=123weaxzcefwe2A&remember=on&nonce=${nonce}`;
  const loginRes = await req({
    url: 'https://tutuotaku.com/wp-admin/admin-ajax.php',
    method: 'POST',
    body: loginBody,
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  console.log(`  Response: ${loginRes.body}`);
  console.log(`  New Cookies: ${Object.keys(cookies).join(', ')}`);
  
  const loginOk = loginRes.body.includes('"status":1');
  
  // Step 3: If login via AJAX doesn't set enough cookies, try also visiting homepage
  console.log('\nStep 3: 刷新首页验证登录态...');
  const homePage = await req({ url: 'https://tutuotaku.com/' });
  const loggedIn = homePage.body.includes('个人中心') || homePage.body.includes('退出');
  console.log(`  登录态: ${loggedIn ? '✅ 已登录' : '❌ 未登录'}`);
  
  // Step 4: Check download history
  console.log('\nStep 4: 访问下载记录页...');
  const downPage = await req({ url: 'https://tutuotaku.com/user/down' });
  console.log(`  状态码: ${downPage.status}`);
  const downloadTitle = (downPage.body.match(/<title>(.*?)<\/title>/) || [])[1];
  console.log(`  页面标题: ${downloadTitle}`);
  
  // Extract download counts
  const downMatches = [...downPage.body.matchAll(/下载次数[：:](\d+)/g)];
  console.log(`  下载次数匹配: ${downMatches.length} 条`);
  downMatches.forEach((m, i) => console.log(`    #${i+1}: ${m[0]}`));
  
  // Step 5: Visit article page
  console.log('\nStep 5: 访问文章页面 2570...');
  const articlePage = await req({ url: 'https://tutuotaku.com/2570/' });
  console.log(`  状态码: ${articlePage.status}`);
  const articleTitle = (articlePage.body.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1];
  console.log(`  文章标题: ${articleTitle || 'NOT FOUND'}`);
  
  // Try different patterns for goto links
  const patterns = [
    /href="([^"]*goto[^"]*down=[^"]*)"/gi,
    /href='([^']*goto[^']*down=[^']*)'/gi,
    /goto\?down=([A-Za-z0-9_\-]+)/gi,
  ];
  
  for (const pat of patterns) {
    const matches = [...articlePage.body.matchAll(pat)];
    if (matches.length > 0) {
      console.log(`  模式 ${pat}: 找到 ${matches.length} 个匹配`);
      matches.forEach((m, i) => console.log(`    #${i+1}: ${m[0].substring(0, 100)}`));
    }
  }
  
  // Also check if the article content has hidden paid section
  const hasHideWarp = articlePage.body.includes('ri-hide-warp');
  const hasPayButton = articlePage.body.includes('js-pay-action');
  const hasGotoBtn = articlePage.body.includes('goto-down');
  console.log(`  隐藏内容: ${hasHideWarp ? 'YES' : 'NO'}`);
  console.log(`  付费按钮: ${hasPayButton ? 'YES' : 'NO'}`);
  console.log(`  Goto按钮: ${hasGotoBtn ? 'YES' : 'NO'}`);
  
  // Dump a snippet of the relevant section
  const riHideIdx = articlePage.body.indexOf('ri-hide-warp');
  if (riHideIdx > 0) {
    console.log(`\n  ri-hide-warp 附近内容:`);
    console.log(`  ${articlePage.body.substring(riHideIdx - 50, riHideIdx + 500).replace(/\n/g, ' ')}`);
  }
}

main().catch(e => console.error('Error:', e));
