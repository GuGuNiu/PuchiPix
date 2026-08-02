/**
 * Coser.io API 端点探测脚本
 * 登录后探测签到、用户信息、VIP 等 API 端点
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  email: 'atlascrfat@outlook.com',
  password: 'YH86JzhrSBd4nP3',
  outputDir: 'E:\\data\\Github\\PuchiPix\\test\\coser-io\\data',
};

async function main() {
  console.log('=== API 端点探测 ===\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });

  const page = await ctx.newPage();

  // 登录
  await page.goto('https://coser.io/login.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });

  const loginResult = await page.evaluate(async (creds) => {
    const csrf = window.__csrfToken || '';
    const res = await fetch('/web-api/v1/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'csrf-token': csrf },
      body: JSON.stringify(creds),
      credentials: 'include',
    });
    return res.json();
  }, { email: CONFIG.email, password: CONFIG.password });

  console.log('登录结果:', JSON.stringify(loginResult));

  if (!loginResult.success) {
    console.log('登录失败，退出');
    await browser.close();
    return;
  }

  // 探测各种 API 端点
  const endpoints = [
    // 用户信息
    { url: '/web-api/v1/user/info', method: 'GET' },
    { url: '/web-api/v1/user/profile', method: 'GET' },
    { url: '/web-api/v1/user/me', method: 'GET' },
    { url: '/web-api/v1/user/points', method: 'GET' },
    
    // VIP/会员
    { url: '/web-api/v1/user/vip', method: 'GET' },
    { url: '/web-api/v1/user/membership', method: 'GET' },
    { url: '/web-api/v1/user/subscription', method: 'GET' },
    
    // 签到
    { url: '/web-api/v1/user/checkin', method: 'GET' },
    { url: '/web-api/v1/user/checkin', method: 'POST' },
    { url: '/web-api/v1/user/sign-in', method: 'GET' },
    { url: '/web-api/v1/user/sign-in', method: 'POST' },
    { url: '/web-api/v1/user/sign', method: 'GET' },
    { url: '/web-api/v1/user/sign', method: 'POST' },
    { url: '/web-api/v1/checkin', method: 'GET' },
    { url: '/web-api/v1/checkin', method: 'POST' },
    { url: '/web-api/v1/daily-checkin', method: 'GET' },
    { url: '/web-api/v1/daily-checkin', method: 'POST' },
    { url: '/web-api/v1/user/daily', method: 'GET' },
    { url: '/web-api/v1/user/daily', method: 'POST' },
    
    // 邀请/奖励
    { url: '/web-api/v1/user/invite', method: 'GET' },
    { url: '/web-api/v1/user/invitations', method: 'GET' },
    { url: '/web-api/v1/user/rewards', method: 'GET' },
    { url: '/web-api/v1/user/tasks', method: 'GET' },
    
    // 图集相关
    { url: '/web-api/v1/galleries/69218', method: 'GET' },
    { url: '/web-api/v1/gallery/69218', method: 'GET' },
    { url: '/web-api/v1/gallery/69218/detail', method: 'GET' },
    { url: '/web-api/v1/gallery/69218/images', method: 'GET' },
    { url: '/web-api/v1/gallery/69218/files', method: 'GET' },
    
    // 购买相关
    { url: '/web-api/v1/user/purchases', method: 'GET' },
    { url: '/web-api/v1/user/orders', method: 'GET' },
    { url: '/web-api/v1/purchases', method: 'GET' },
    { url: '/web-api/v1/orders', method: 'GET' },
    
    // 其他
    { url: '/web-api/v1/user/favorites', method: 'GET' },
    { url: '/web-api/v1/user/history', method: 'GET' },
    { url: '/web-api/v1/user/downloads', method: 'GET' },
  ];

  const results = [];

  for (const ep of endpoints) {
    try {
      const result = await page.evaluate(async ({ url, method }) => {
        try {
          const opts = { method, credentials: 'include' };
          if (method === 'POST') {
            opts.headers = { 'Content-Type': 'application/json', 'csrf-token': window.__csrfToken || '' };
            opts.body = JSON.stringify({});
          }
          const r = await fetch(url, opts);
          const ct = r.headers.get('content-type') || '';
          let body;
          if (ct.includes('json')) {
            body = await r.json();
          } else {
            body = (await r.text()).substring(0, 200);
          }
          return { url, method, status: r.status, contentType: ct, body };
        } catch (e) {
          return { url, method, error: e.message };
        }
      }, ep);

      if (result.status !== 404) {
        console.log(`${ep.method} ${ep.url} -> ${result.status} ${JSON.stringify(result.body).substring(0, 200)}`);
      }
      results.push(result);
    } catch (e) {
      results.push({ url: ep.url, method: ep.method, error: e.message });
    }
  }

  // 保存结果
  fs.writeFileSync(
    path.join(CONFIG.outputDir, 'auth-api-exploration.json'),
    JSON.stringify(results.filter(r => r.status !== 404), null, 2)
  );

  // 也尝试访问会员页面，查看 VIP 信息
  console.log('\n--- 访问会员页面 ---');
  await page.goto('https://coser.io/member.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const memberInfo = await page.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      bodyText: document.body.innerText.substring(0, 1000),
      vipStatus: window.__vipStatus || null,
    };
  });
  console.log('会员页面:', JSON.stringify(memberInfo, null, 2));

  // 尝试访问用户中心
  console.log('\n--- 访问用户中心 ---');
  await page.goto('https://coser.io/user.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const userInfo = await page.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      bodyText: document.body.innerText.substring(0, 1000),
    };
  });
  console.log('用户中心:', JSON.stringify(userInfo, null, 2));

  // 下载用户中心页面 JS
  const userJsLinks = await page.evaluate(() => {
    return [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => s.includes('/js/'));
  });
  console.log('\n用户中心 JS 文件:', userJsLinks);

  // 下载并分析每个 JS 文件
  for (const jsUrl of userJsLinks) {
    if (!jsUrl.includes('login-page') && !jsUrl.includes('frontend/global') && !jsUrl.includes('frontend/comment') && !jsUrl.includes('frontend/share') && !jsUrl.includes('latp-page')) {
      try {
        const jsContent = await page.evaluate(async (url) => {
          const res = await fetch(url);
          return await res.text();
        }, jsUrl);

        const filename = jsUrl.split('/').pop().split('?')[0];
        fs.writeFileSync(path.join(CONFIG.outputDir, `auth-js-${filename}`), jsContent);
        console.log(`  下载: ${filename} (${jsContent.length} bytes)`);

        // 搜索签到/checkin/point 相关代码
        if (jsContent.includes('checkin') || jsContent.includes('sign') || jsContent.includes('point') || jsContent.includes('积分')) {
          console.log(`    ⚠️ 包含签到/积分相关代码!`);
          // 提取相关行
          const lines = jsContent.split('\n');
          const relevantLines = lines.filter(l =>
            l.includes('checkin') || l.includes('sign-in') || l.includes('签到') ||
            l.includes('/point') || l.includes('/reward') || l.includes('/task') ||
            l.includes('fetch(') && (l.includes('point') || l.includes('checkin') || l.includes('sign'))
          );
          relevantLines.forEach(l => console.log(`    ${l.trim()}`));
        }
      } catch (e) {
        console.log(`  下载失败: ${jsUrl} - ${e.message}`);
      }
    }
  }

  await browser.close();
  console.log('\n=== 探测完成 ===');
}

main().catch(console.error);
