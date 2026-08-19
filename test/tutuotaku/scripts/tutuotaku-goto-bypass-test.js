// tutuotaku.com goto download count bypass verification
// Test: Does direct HTTP access to goto links trigger the daily 5-download limit?

const https = require('https');
const http = require('http');
const url = require('url');
const crypto = require('crypto');

// Cookie jar
let cookieJar = {};

function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return;
  for (const h of (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders])) {
    const parts = h.split(';')[0].trim().split('=');
    if (parts.length >= 2) {
      cookieJar[parts[0]] = parts.slice(1).join('=');
    }
  }
}

function getCookieHeader() {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function fetchReq(opts) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(opts.url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Cookie': getCookieHeader(),
        ...(opts.headers || {})
      },
      rejectUnauthorized: false
    };

    if (opts.body) {
      reqOpts.headers['Content-Type'] = reqOpts.headers['Content-Type'] || 'application/x-www-form-urlencoded';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(opts.body);
    }

    const req = mod.request(reqOpts, (res) => {
      parseCookies(res.headers['set-cookie']);
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const isRedirect = res.statusCode >= 300 && res.statusCode < 400;
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          isRedirect,
          location: res.headers.location
        });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  console.log('=== tutuotaku.com goto 下载计数绕过验证 ===\n');

  const account = { email: 'TLpA9fLLzy@duckmail.sbs', password: '123weaxzcefwe2A' };

  // Step 1: Get login page and extract nonce
  console.log('Step 1: 获取登录页 nonce...');
  const loginPage = await fetchReq({ url: 'https://tutuotaku.com/' });
  const nonceMatch = loginPage.body.match(/"ajax_nonce":"([a-f0-9]+)"/);
  const nonce = nonceMatch ? nonceMatch[1] : null;
  console.log(`  nonce: ${nonce || 'NOT FOUND'}`);

  // Step 2: Login
  console.log('Step 2: 登录...');
  const loginBody = new URLSearchParams({
    action: 'zb_user_login',
    user_name: account.email,
    user_password: account.password,
    remember: 'on',
    nonce: nonce || ''
  }).toString();

  const loginRes = await fetchReq({
    url: 'https://tutuotaku.com/wp-admin/admin-ajax.php',
    method: 'POST',
    body: loginBody
  });
  console.log(`  Login response: ${loginRes.body}`);
  let loginData;
  try { loginData = JSON.parse(loginRes.body); } catch(e) { loginData = {}; }
  const loginOk = loginData.status === 1;
  console.log(`  登录状态: ${loginOk ? '✅ 成功' : '❌ 失败'} (status: ${loginData.status})`);

  if (!loginOk) {
    console.log('\n❌ 登录失败，退出');
    return;
  }

  // Step 3: Check current download count
  console.log('\nStep 3: 检查当前下载记录...');
  const downPage = await fetchReq({ url: 'https://tutuotaku.com/user/down' });
  const downCount = (downPage.body.match(/下载次数：(\d+)/g) || []).map(s => parseInt(s.match(/\d+/)[0]));
  const totalBefore = downCount.reduce((a, b) => a + b, 0);
  console.log(`  下载记录: ${downCount.join(', ')}`);
  console.log(`  当前总下载次数: ${totalBefore}`);

  // Step 4: Visit article page to get goto links
  console.log('\nStep 4: 访问文章页面获取 goto 链接...');
  const articleRes = await fetchReq({ url: 'https://tutuotaku.com/2570/' });
  const gotoMatches = [...articleRes.body.matchAll(/href="(\/goto\?down=[^"]+)"/g)];
  const gotoTokens = gotoMatches.map(m => 'https://tutuotaku.com' + m[1]);
  console.log(`  找到 ${gotoTokens.length} 个 goto 链接`);

  if (gotoTokens.length === 0) {
    console.log('  ⚠️ 未找到 goto 链接（可能需要 VIP）');
    return;
  }

  // Step 5: Directly access goto links (the bypass test!)
  console.log('\nStep 5: 🔑 关键测试 — 直接 HTTP 访问 goto 链接...');
  for (let i = 0; i < Math.min(gotoTokens.length, 2); i++) {
    const gotoUrl = gotoTokens[i];
    console.log(`  访问 goto #${i+1}: ${gotoUrl.substring(0, 60)}...`);
    
    const gotoRes = await fetchReq({ url: gotoUrl });
    console.log(`    状态: ${gotoRes.status} | Location: ${(gotoRes.location || 'N/A').substring(0, 80)}`);
    
    if (gotoRes.isRedirect && gotoRes.location?.includes('pan.baidu.com')) {
      console.log(`    ✅ 成功获取百度网盘链接！`);
    } else if (gotoRes.isRedirect) {
      console.log(`    ⚠️ 重定向到: ${gotoRes.location?.substring(0, 60)}`);
    } else {
      console.log(`    ⚠️ 非重定向响应，可能需要登录态`);
    }
    await new Promise(r => setTimeout(r, 1000)); // delay
  }

  // Step 6: Check download count again
  console.log('\nStep 6: 重新检查下载记录（验证计数是否增加）...');
  const downPage2 = await fetchReq({ url: 'https://tutuotaku.com/user/down' });
  const downCount2 = (downPage2.body.match(/下载次数：(\d+)/g) || []).map(s => parseInt(s.match(/\d+/)[0]));
  const totalAfter = downCount2.reduce((a, b) => a + b, 0);
  console.log(`  下载记录: ${downCount2.join(', ')}`);
  console.log(`  当前总下载次数: ${totalAfter}`);

  // Step 7: Conclusion
  console.log('\n========================================');
  console.log('  测试结论');
  console.log('========================================');
  console.log(`  访问前下载次数: ${totalBefore}`);
  console.log(`  访问后下载次数: ${totalAfter}`);
  console.log(`  差值: ${totalAfter - totalBefore}`);
  
  if (totalAfter === totalBefore) {
    console.log(`\n  ✅ 绕过成功！直接 HTTP 访问 goto 链接不触发下载计数`);
    console.log(`  可用 goto token: ${gotoTokens.length} 个`);
  } else {
    console.log(`\n  ❌ 绕过失败 — goto 访问增加了 ${totalAfter - totalBefore} 次计数`);
  }
  console.log('========================================');
}

main().catch(e => console.error('Error:', e));
