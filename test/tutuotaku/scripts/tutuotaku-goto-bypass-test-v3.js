// tutuotaku.com goto bypass test v3 - full bypass verification
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
        location: res.headers.location
      }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function main() {
  console.log('=== tutuotaku goto bypass v3 ===\n');

  // Step 1: Get nonce & login
  const r1 = await req({ url: 'https://tutuotaku.com/' });
  const nonce = (r1.body.match(/"ajax_nonce":"([a-f0-9]+)"/) || [])[1] || '';
  
  const loginBody = `action=zb_user_login&user_name=${encodeURIComponent('TLpA9fLLzy@duckmail.sbs')}&user_password=123weaxzcefwe2A&remember=on&nonce=${nonce}`;
  await req({ url: 'https://tutuotaku.com/wp-admin/admin-ajax.php', method: 'POST', body: loginBody });

  // Step 2: Check download count BEFORE
  console.log('Step 2: 检查初始下载次数...');
  // Use the full URL with trailing slash
  const before1 = await req({ url: 'https://tutuotaku.com/user/down/' });
  let beforeBody = before1.body;
  
  // If still redirected, try with Referer
  if (before1.status >= 300 && before1.location) {
    console.log(`  重定向到: ${before1.location}`);
    const before2 = await req({ url: before1.location.startsWith('http') ? before1.location : 'https://tutuotaku.com' + before1.location });
    beforeBody = before2.body;
  }
  
  if (beforeBody.includes('登录') || beforeBody.includes('login')) {
    console.log('  ⚠️ 下载页需要登录（Cookie可能未正确携带）');
    console.log(`  Cookies: ${Object.keys(cookies).join(',')}`);
    return;
  }

  const beforeMatches = [...beforeBody.matchAll(/下载次数[：:](\d+)/g)];
  const beforeCounts = beforeMatches.map(m => parseInt(m[1]));
  const beforeTotal = beforeCounts.reduce((a,b)=>a+b, 0);
  console.log(`  下载记录: ${beforeCounts.join(', ')}`);
  console.log(`  当前总次数: ${beforeTotal}`);

  // Step 3: Get goto links from article
  console.log('\nStep 3: 获取 goto 链接...');
  const articleRes = await req({ url: 'https://tutuotaku.com/2570/' });
  const gotoMatches = [...articleRes.body.matchAll(/href="(https:\/\/tutuotaku\.com\/goto\?down=[^"]+)"/g)];
  const gotoUrls = gotoMatches.map(m => m[1]);
  console.log(`  找到 ${gotoUrls.length} 个链接`);

  // Step 4: Direct access goto links (BYPASS TEST)
  console.log('\nStep 4: 🔑 直接 HTTP 访问 goto 链接（绕过测试）...');
  for (const gotoUrl of gotoUrls) {
    console.log(`  访问: ${gotoUrl.substring(0, 70)}...`);
    const gotoRes = await req({ url: gotoUrl });
    console.log(`    状态: ${gotoRes.status}`);
    
    if (gotoRes.location) {
      console.log(`    Location: ${gotoRes.location.substring(0, 100)}`);
      if (gotoRes.location.includes('pan.baidu.com') || gotoRes.location.includes('pan.xunlei.com')) {
        console.log(`    ✅ 成功获取网盘链接！`);
      }
    } else {
      console.log(`    页面代码: ${gotoRes.status} (非重定向)`);
      // Check if it's the article page (meaning redirect didn't work)
      if (gotoRes.body.includes('百度网盘') || gotoRes.body.includes('pan.baidu')) {
        console.log(`    ✅ 页面包含网盘链接！`);
      }
    }
  }

  // Step 5: Check download count AFTER
  console.log('\nStep 5: 重新检查下载次数...');
  const after1 = await req({ url: 'https://tutuotaku.com/user/down/' });
  let afterBody = after1.body;
  
  const afterMatches = [...afterBody.matchAll(/下载次数[：:](\d+)/g)];
  const afterCounts = afterMatches.map(m => parseInt(m[1]));
  const afterTotal = afterCounts.reduce((a,b)=>a+b, 0);
  console.log(`  下载记录: ${afterCounts.join(', ')}`);
  console.log(`  当前总次数: ${afterTotal}`);

  // Conclusion
  console.log('\n========================================');
  console.log('  测试结论');
  console.log('========================================');
  console.log(`  访问前: ${beforeTotal} 次`);
  console.log(`  访问后: ${afterTotal} 次`);
  console.log(`  新增: ${afterTotal - beforeTotal} 次`);
  if (afterTotal === beforeTotal && gotoUrls.length > 0) {
    console.log('\n  ✅✅✅ 绕过成功！直接 HTTP 访问 goto 不触发计数');
  } else if (afterTotal > beforeTotal) {
    console.log(`\n  ⚠️ 部分触发 — 增加了 ${afterTotal - beforeTotal} 次`);
  } else {
    console.log('\n  ℹ️ 无法确定（下载页未正常加载）');
  }
  console.log('========================================');
}

main().catch(e => console.error('Error:', e));
